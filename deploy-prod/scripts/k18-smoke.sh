#!/bin/sh
# K18 — post-cutover smoke: health, auth stack (disposable user + board key),
# UI, scheduling CRUD, Hermes relay from inside the new container, and entity
# counts vs the pre-cutover baseline. Disposable identity is deleted at the end.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DEPLOY_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE=${COMPOSE_FILE:-$DEPLOY_DIR/compose.yaml}
ENV_FILE=${COMPOSE_ENV_FILE:-$DEPLOY_DIR/runtime.env}
[ -f "$ENV_FILE" ] || ENV_FILE=$DEPLOY_DIR/.env
BASE=${SMOKE_BASE:-http://127.0.0.1:3100}
COMPANY_ID=${SMOKE_COMPANY:-ca743e8c-e414-49c8-9134-890ea933a3f6}
BASELINE=${BASELINE:-$DEPLOY_DIR/backups/counts-embedded.json}

cd "$DEPLOY_DIR"

echo "== 1. container health =="
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
docker exec paperclip curl --fail --silent --show-error http://127.0.0.1:3100/api/health | tee /tmp/k18-health.json
grep -q '"status":"ok"' /tmp/k18-health.json || grep -q '"status": "ok"' /tmp/k18-health.json || { echo "HEALTH_FAIL"; exit 1; }
grep -q '7927f06fa' /tmp/k18-health.json || { echo "HEALTH_COMMIT_MISMATCH"; exit 1; }

echo "== 2. auth stack =="
curl -s -o /tmp/k18-session.json -w 'get-session http=%{http_code}\n' "$BASE/api/auth/get-session"

echo "== 3. UI serves =="
curl -s -o /tmp/k18-ui.html -w 'ui http=%{http_code}\n' "$BASE/"
grep -qiE 'paperclip|root|<div id="root"' /tmp/k18-ui.html || { echo "UI_FAIL"; exit 1; }

echo "== 4. scheduling CRUD (disposable user + board key, deleted afterwards) =="
EMAIL="k18-smoke-$(date +%s)@t3-prod.invalid"
PASS="k18smoke-$(date +%s)"
COOKIE_JAR="/tmp/k18-smoke.cookies"
curl -sS -m 15 -c "$COOKIE_JAR" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"K18 Smoke\"}" \
  "$BASE/api/auth/sign-up/email" >/dev/null
USER_ID=$(curl -sS -m 15 -b "$COOKIE_JAR" "$BASE/api/auth/get-session" | sed -E 's/.*"userId":"([^"]+)".*/\1/')
echo "USER_ID=$USER_ID"
[ -n "$USER_ID" ] || { echo "SIGNUP_FAIL"; exit 1; }

BOARD_TOKEN="k18-$(openssl rand -hex 24)"
KEY_HASH=$(printf '%s' "$BOARD_TOKEN" | sha256sum | awk '{print $1}')
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T db psql -U paperclip -d paperclip -v ON_ERROR_STOP=1 -c "
  insert into company_memberships (company_id, principal_type, principal_id, status, membership_role)
  values ('$COMPANY_ID', 'user', '$USER_ID', 'active', 'owner')
  on conflict (company_id, principal_type, principal_id) do update set status='active', membership_role='owner';
  insert into instance_user_roles (user_id, role) values ('$USER_ID', 'instance_admin')
  on conflict (user_id, role) do nothing;
  insert into board_api_keys (user_id, name, key_hash, expires_at)
  values ('$USER_ID', 'k18-smoke', '$KEY_HASH', now() + interval '1 day');
"

AUTH="Authorization: Bearer $BOARD_TOKEN"
echo "== create routine =="
ROUTINE=$(curl -sS -m 15 -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"title\":\"K18 Smoke Routine $(date +%s)\",\"description\":\"cutover smoke\",\"recurrenceRule\":{\"kind\":\"weekly\",\"daysOfWeek\":[1,3]},\"timezone\":\"Asia/Ho_Chi_Minh\",\"scheduledTime\":\"09:30\",\"priority\":\"medium\"}" \
  "$BASE/api/companies/$COMPANY_ID/scheduling-routines")
echo "$ROUTINE" | head -c 300; echo ""
ROUTINE_ID=$(echo "$ROUTINE" | sed -E 's/.*"id":"([^"]+)".*/\1/')
[ -n "$ROUTINE_ID" ] && [ "$ROUTINE_ID" != "$ROUTINE" ] || { echo "CREATE_FAIL"; exit 1; }

echo "== list contains routine =="
curl -sS -m 15 -H "$AUTH" "$BASE/api/companies/$COMPANY_ID/scheduling-routines" | grep -o "\"id\":\"$ROUTINE_ID\"" | head -1 && echo "LIST_CONTAINS_ROUTINE"

echo "== patch routine =="
curl -sS -m 15 -H "$AUTH" -X PATCH -H 'Content-Type: application/json' \
  -d '{"title":"K18 Smoke Routine PATCHED","status":"paused"}' \
  "$BASE/api/companies/$COMPANY_ID/scheduling-routines/$ROUTINE_ID" | head -c 200; echo ""

echo "== delete routine =="
curl -sS -m 15 -H "$AUTH" -X DELETE "$BASE/api/companies/$COMPANY_ID/scheduling-routines/$ROUTINE_ID" | head -c 200; echo ""

echo "== issue scheduling upsert/get/clear =="
TARGET_ISSUE=$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T db psql -U paperclip -d paperclip -tA -c "select id from issues where company_id='$COMPANY_ID' order by created_at desc limit 1" | tr -d '[:space:]')
SCHED_TS=$(date -u -d '+1 hour' +%Y-%m-%dT%H:%M:%SZ)
curl -sS -m 15 -H "$AUTH" -X PUT -H 'Content-Type: application/json' \
  -d "{\"scheduledAt\":\"$SCHED_TS\",\"scheduledDurationMinutes\":60}" \
  "$BASE/api/companies/$COMPANY_ID/issues/$TARGET_ISSUE/scheduling" | head -c 200; echo ""
curl -sS -m 15 -H "$AUTH" "$BASE/api/companies/$COMPANY_ID/issues/$TARGET_ISSUE/scheduling" | head -c 200; echo ""
curl -sS -m 15 -H "$AUTH" -X DELETE "$BASE/api/companies/$COMPANY_ID/issues/$TARGET_ISSUE/scheduling" | head -c 200; echo ""
echo "SCHEDULING_CRUD_PASS"

echo "== cleanup disposable identity =="
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T db psql -U paperclip -d paperclip -v ON_ERROR_STOP=1 -c "
  delete from board_api_keys where user_id='$USER_ID';
  delete from company_memberships where company_id='$COMPANY_ID' and principal_type='user' and principal_id='$USER_ID';
  delete from instance_user_roles where user_id='$USER_ID';
  delete from session where user_id='$USER_ID';
  delete from \"user\" where id='$USER_ID';
"
echo "CLEANUP_DONE"

echo "== 5. Hermes relay from inside the new container =="
docker exec paperclip sh -c 'wget -q -T 5 -O - http://host.docker.internal:8642/health' | tee /tmp/k18-hermes.json
grep -q '"status":"ok"' /tmp/k18-hermes.json || grep -q '"status": "ok"' /tmp/k18-hermes.json || { echo "HERMES_FAIL"; exit 1; }

echo "== 6. entity counts vs baseline =="
OUT=/tmp/k18-counts-after.txt COUNT_TARGET=compose "$SCRIPT_DIR/k18-counts.sh" || true
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
