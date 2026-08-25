#!/bin/sh
# K16 staging Hermes run trigger: create an issue assigned to the hermes_gateway
# agent (24c36c90) in company 73f27949, using a staging board API key.
set -eu
BASE="${1:-http://127.0.0.1:33120}"
COMPANY_ID="73f27949-7ac6-41bb-a9c3-a79c547fe227"
AGENT_ID="24c36c90-a6f8-4a58-ac67-b143eaa142dc"
STAGING_DB_COMPOSE="${2:-/root/projects/t3-paperclip-Aitodo/.worktrees/t_661d88a3/deploy-staging}"

# Create a staging user + board key for this company (staging-only)
EMAIL="k16-run-$(date +%s)@t3-staging.invalid"
PASS="k16run-$(date +%s)"
COOKIE_JAR="/tmp/k16-run.cookies"
rm -f "$COOKIE_JAR"
curl -sS -m 15 -c "$COOKIE_JAR" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"K16 Run Smoke\"}" \
  "$BASE/api/auth/sign-up/email" >/dev/null
USER_ID=$(curl -sS -m 15 -b "$COOKIE_JAR" "$BASE/api/auth/get-session" | sed -E 's/.*"userId":"([^"]+)".*/\1/')
BOARD_TOKEN="k16-$(openssl rand -hex 24)"
KEY_HASH=$(printf '%s' "$BOARD_TOKEN" | sha256sum | awk '{print $1}')
(
  cd "$STAGING_DB_COMPOSE"
  docker compose exec -T db psql -U paperclip -d paperclip -v ON_ERROR_STOP=1 -c "
    insert into company_memberships (company_id, principal_type, principal_id, status, membership_role)
    values ('$COMPANY_ID', 'user', '$USER_ID', 'active', 'owner')
    on conflict (company_id, principal_type, principal_id) do update set status='active', membership_role='owner';
    insert into instance_user_roles (user_id, role) values ('$USER_ID', 'instance_admin')
    on conflict (user_id, role) do nothing;
    insert into board_api_keys (user_id, name, key_hash, expires_at)
    values ('$USER_ID', 'k16-run-smoke', '$KEY_HASH', now() + interval '1 day');
  "
)
AUTH="Authorization: Bearer $BOARD_TOKEN"

echo "== create issue assigned to hermes_gateway agent =="
ISSUE=$(curl -sS -m 15 -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"title\":\"K16 Hermes run smoke $(date +%s)\",\"description\":\"Reply with exactly: K16-STAGING-HERMES-RUN-OK\",\"status\":\"todo\",\"assigneeAgentId\":\"$AGENT_ID\",\"priority\":\"medium\"}" \
  "$BASE/api/companies/$COMPANY_ID/issues")
echo "$ISSUE" | head -c 500
echo ""
ISSUE_ID=$(echo "$ISSUE" | sed -E 's/.*"id":"([^"]+)".*/\1/')
echo "ISSUE_ID=$ISSUE_ID"
[ -n "$ISSUE_ID" ] && [ "$ISSUE_ID" != "$ISSUE" ] || { echo "CREATE_ISSUE_FAIL"; exit 1; }
echo "$ISSUE_ID" > /tmp/k16-issue-id.txt
echo "TRIGGER_ISSUE=$ISSUE_ID agent=$AGENT_ID company=$COMPANY_ID"
