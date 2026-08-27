#!/bin/sh
# K19: trigger the Hermes run for the temp agent (issue create + wait + verify),
# then clean up issue and temp agent. Secrets never printed.
set -eu

DB="docker exec t3-prod-db-1 psql -U paperclip -d paperclip -tAc"
BASE="http://127.0.0.1:3100"
COMPANY_ID="ca743e8c-e414-49c8-9134-890ea933a3f6"
PROJECT_ID="85a7284b-a13b-48e5-879c-79d935f570f8"
AGENT_ID=$(cat /tmp/k19-agent-id.txt)
echo "using temp agent: $AGENT_ID"

USER_ID=$($DB "select id from \"user\" where email='admin@tecotec.tech'")
TOKEN="k19-$(openssl rand -hex 24)"
KEY_HASH=$(printf '%s' "$TOKEN" | sha256sum | awk '{print $1}')
$DB "insert into board_api_keys (user_id, name, key_hash, expires_at) values ('$USER_ID', 'k19-hermes-run-temp', '$KEY_HASH', now() + interval '2 hours')" >/dev/null
AUTH="Authorization: Bearer $TOKEN"
JSON='Content-Type: application/json'
ISSUE_FILE=/tmp/k19-issue-id.txt

cleanup_all() {
  if [ -f "$ISSUE_FILE" ]; then
    IID=$(cat "$ISSUE_FILE")
    curl -sS -m 10 -X DELETE -H "$AUTH" "$BASE/api/companies/$COMPANY_ID/issues/$IID" >/dev/null 2>&1 || true
  fi
  $DB "delete from agents where id='$AGENT_ID'" >/dev/null 2>&1 || true
  $DB "delete from board_api_keys where key_hash='$KEY_HASH'" >/dev/null 2>&1 || true
}
trap cleanup_all EXIT

echo "== create issue assigned to temp hermes_gateway agent =="
RESP=$(curl -sS -m 15 -H "$AUTH" -H "$JSON" \
  -d "{\"title\":\"K19 Hermes gateway acceptance $(date +%s)\",\"description\":\"Automated acceptance test. Reply with exactly: K19-HERMES-RUN-OK\",\"status\":\"todo\",\"assigneeAgentId\":\"$AGENT_ID\",\"priority\":\"low\",\"projectId\":\"$PROJECT_ID\"}" \
  "$BASE/api/companies/$COMPANY_ID/issues")
ISSUE=$(printf '%s' "$RESP" | sed -E 's/.*"id":"([^"]+)".*/\1/')
[ -n "$ISSUE" ] && [ "$ISSUE" != "$RESP" ] || { echo "CREATE_ISSUE_FAIL: $(printf '%s' "$RESP" | head -c 200)"; exit 1; }
echo "$ISSUE" | tee "$ISSUE_FILE"

echo "== wait for run to appear and complete =="
for i in $(seq 1 55); do
  sleep 10
  RUN=$($DB "select id::text || '|' || status from heartbeat_runs where agent_id='$AGENT_ID' order by started_at desc nulls last limit 1")
  echo "poll $i: latest=${RUN:-none}"
  case "${RUN##*|}" in
    succeeded|completed|failed|interrupted) break ;;
  esac
done
echo "== final run state =="
docker exec t3-prod-db-1 psql -U paperclip -d paperclip -c "select id, status, started_at, completed_at from heartbeat_runs where agent_id='$AGENT_ID' order by created_at desc limit 3"
echo "== issue comments (agent reply) =="
curl -sS -m 10 -H "$AUTH" "$BASE/api/companies/$COMPANY_ID/issues/$ISSUE/comments" | head -c 600; echo
