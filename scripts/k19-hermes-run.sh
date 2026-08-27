#!/bin/sh
# K19 acceptance: one Paperclip-triggered Hermes gateway run.
# Creates a TEMPORARY hermes_gateway agent in the active company by cloning the
# paused legacy agent's adapter_config (secrets never printed), creates an issue
# assigned to it, waits for the run, then deletes the temp agent + issue.
# The relay (172.21.0.1:8642 -> host Hermes 127.0.0.1:8642) is exercised.
set -eu

DB="docker exec t3-prod-db-1 psql -U paperclip -d paperclip -tAc"
BASE="http://127.0.0.1:3100"
COMPANY_ID="ca743e8c-e414-49c8-9134-890ea933a3f6"
SRC_AGENT="c011ce22-90da-4896-b4aa-cea167023111"   # paused hermes_gateway (manual pause)
PROJECT_ID="85a7284b-a13b-48e5-879c-79d935f570f8"

USER_ID=$($DB "select id from \"user\" where email='admin@tecotec.tech'")
TOKEN="k19-$(openssl rand -hex 24)"
KEY_HASH=$(printf '%s' "$TOKEN" | sha256sum | awk '{print $1}')
$DB "insert into board_api_keys (user_id, name, key_hash, expires_at) values ('$USER_ID', 'k19-hermes-run-temp', '$KEY_HASH', now() + interval '2 hours')" >/dev/null
cleanup() {
  $DB "delete from board_api_keys where key_hash='$KEY_HASH'" >/dev/null || true
}
trap cleanup EXIT
AUTH="Authorization: Bearer $TOKEN"
JSON='Content-Type: application/json'

echo "== create temp hermes_gateway agent =="
NEW_AGENT=$($DB "select gen_random_uuid()::text")
$DB "insert into agents (id, company_id, name, role, title, status, adapter_type, adapter_config)
     select '$NEW_AGENT', company_id, 'K19 Hermes acceptance', role, 'acceptance temp agent', 'idle',
            adapter_type, adapter_config from agents where id='$SRC_AGENT'" >/dev/null
echo "temp agent created: $NEW_AGENT"

remove_agent() {
  $DB "delete from agents where id='$NEW_AGENT'" >/dev/null || true
}
trap 'cleanup; remove_agent' EXIT

echo "== create issue assigned to temp agent =="
RESP=$(curl -sS -m 15 -H "$AUTH" -H "$JSON" \
  -d "{\"title\":\"K19 Hermes gateway acceptance $(date +%s)\",\"description\":\"This is an automated acceptance test. Reply with exactly: K19-HERMES-RUN-OK\",\"status\":\"todo\",\"assigneeAgentId\":\"$NEW_AGENT\",\"priority\":\"low\",\"projectId\":\"$PROJECT_ID\"}" \
  "$BASE/api/companies/$COMPANY_ID/issues")
ISSUE=$(printf '%s' "$RESP" | sed -E 's/.*"id":"([^"]+)".*/\1/')
[ -n "$ISSUE" ] && [ "$ISSUE" != "$RESP" ] || { echo "CREATE_ISSUE_FAIL: $(printf '%s' "$RESP" | head -c 300)"; exit 1; }
echo "issue created: $ISSUE"
echo "$ISSUE" > /tmp/k19-hermes-issue-id.txt
echo "$NEW_AGENT" > /tmp/k19-hermes-agent-id.txt
