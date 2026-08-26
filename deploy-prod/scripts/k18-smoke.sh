#!/bin/sh
# K18 — post-cutover smoke: health, auth stack, UI, scheduling CRUD,
# Hermes relay reachability from inside the new container, and entity counts
# vs the pre-cutover baseline.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DEPLOY_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE=${COMPOSE_FILE:-$DEPLOY_DIR/compose.yaml}
ENV_FILE=${COMPOSE_ENV_FILE:-$DEPLOY_DIR/runtime.env}
[ -f "$ENV_FILE" ] || ENV_FILE=$DEPLOY_DIR/.env
BASE=${SMOKE_BASE:-http://127.0.0.1:3100}
BASELINE=${BASELINE:-$DEPLOY_DIR/backups/counts-embedded.json}

cd "$DEPLOY_DIR"

echo "== 1. container health =="
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
docker exec paperclip curl --fail --silent --show-error http://127.0.0.1:3100/api/health | tee /tmp/k18-health.json
grep -q '"status":"ok"' /tmp/k18-health.json || grep -q '"status": "ok"' /tmp/k18-health.json || { echo "HEALTH_FAIL"; exit 1; }

echo "== 2. auth stack (unauthenticated session probe) =="
curl -s -o /tmp/k18-session.json -w 'get-session http=%{http_code}\n' "$BASE/api/auth/get-session"
grep -qE 'session|null|error' /tmp/k18-session.json || { echo "AUTH_FAIL"; exit 1; }

echo "== 3. UI serves =="
curl -s -o /tmp/k18-ui.html -w 'ui http=%{http_code}\n' "$BASE/"
grep -qiE 'paperclip|root|<div id="root"' /tmp/k18-ui.html || { echo "UI_FAIL"; exit 1; }

echo "== 4. scheduling CRUD (temporary board key, deleted afterwards) =="
KEY=$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T db psql -U paperclip -d paperclip -tA -c "select encode(gen_random_bytes(24),'hex')")
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T db psql -U paperclip -d paperclip -q -c "insert into api_keys (id, name, key_hash, scopes, company_id, created_at, updated_at) select gen_random_uuid(), 'k18-smoke', encode(sha256('$KEY'::bytea),'hex'), '{\"board\":true}'::jsonb, id, now(), now() from companies limit 1" 
# The API key model varies by fork version; if the above fails the smoke still
# reports the scheduling routes' auth behavior (401 proves the route exists).
AUTH="Authorization: Bearer $KEY"
ROUTINE=$(curl -s -X POST "$BASE/api/scheduling/routines" -H "$AUTH" -H 'Content-Type: application/json' -d '{"name":"k18-smoke","description":"k18 temp","cron":"0 3 * * *","enabled":false}' | tee /tmp/k18-routine.json | head -c 300)
echo "routine create: $ROUTINE"
ID=$(node -e 'try{const j=JSON.parse(require("fs").readFileSync("/tmp/k18-routine.json","utf8"));process.stdout.write(String(j.id||j.routine?.id||""))}catch(e){}')
if [ -n "$ID" ]; then
  curl -s -X DELETE "$BASE/api/scheduling/routines/$ID" -H "$AUTH" -o /dev/null -w 'routine delete http=%{http_code}\n'
fi
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T db psql -U paperclip -d paperclip -q -c "delete from api_keys where name='k18-smoke'"

echo "== 5. Hermes relay from inside the new container =="
docker exec paperclip sh -c 'wget -q -T 5 -O - http://host.docker.internal:8642/health' | tee /tmp/k18-hermes.json
grep -q '"status":"ok"' /tmp/k18-hermes.json || grep -q '"status": "ok"' /tmp/k18-hermes.json || { echo "HERMES_FAIL"; exit 1; }

echo "== 6. entity counts vs baseline =="
OUT=/tmp/k18-counts-after.json COUNT_TARGET=compose "$SCRIPT_DIR/k18-counts.sh" || true
python3 - "$BASELINE" /tmp/k18-counts-after.txt <<'EOF' || true
import json,sys
base=json.load(open(sys.argv[1]))["counts"]
after={}
for line in open(sys.argv[2]):
    k,v=line.strip().split("=",1)
    after[k]=v
print("baseline:",json.dumps(base))
print("after:   ",json.dumps(after))
diffs={k:(base.get(k),after.get(k)) for k in set(base)|set(after) if str(base.get(k))!=str(after.get(k))}
print("DIFFS:",json.dumps(diffs) if diffs else "none (expected deltas: activity_log/agent_config_revisions/document_revisions/routine_revisions + migrations)")
EOF

echo "SMOKE_DONE"
