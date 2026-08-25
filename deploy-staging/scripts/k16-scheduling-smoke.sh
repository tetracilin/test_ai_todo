#!/bin/sh
# K16 staging scheduling CRUD smoke (authenticated via board API key).
# Creates a staging-scoped board API key for a disposable user, grants staging-only
# membership, then exercises: create routine -> list -> get -> patch -> delete,
# plus per-issue scheduling upsert -> get -> clear.
# All mutations are against the isolated t3-staging stack only.
set -eu
BASE="${1:-http://127.0.0.1:33120}"
COMPANY_ID="${2:-2588c455-47ca-4b0f-ba96-b5bf63a9c796}"
STAGING_DB_COMPOSE="${3:-/root/projects/t3-paperclip-Aitodo/.worktrees/t_661d88a3/deploy-staging}"

EMAIL="k16-sched-$(date +%s)@t3-staging.invalid"
PASS="k16sched-$(date +%s)"
COOKIE_JAR="/tmp/k16-sched.cookies"
rm -f "$COOKIE_JAR"

echo "== sign-up (for user identity only) =="
curl -sS -m 15 -c "$COOKIE_JAR" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"K16 Scheduling Smoke\"}" \
  "$BASE/api/auth/sign-up/email" >/dev/null
USER_ID=$(curl -sS -m 15 -b "$COOKIE_JAR" "$BASE/api/auth/get-session" | sed -E 's/.*"userId":"([^"]+)".*/\1/')
echo "USER_ID=$USER_ID"
[ -n "$USER_ID" ] || { echo "SIGNUP_FAIL"; exit 1; }

# Generate a board API token and its SHA-256 hex hash.
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
    values ('$USER_ID', 'k16-staging-smoke', '$KEY_HASH', now() + interval '1 day');
  "
)

AUTH="Authorization: Bearer $BOARD_TOKEN"

echo "== create routine (POST, board_key) =="
ROUTINE=$(curl -sS -m 15 -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"title\":\"K16 Staging Routine $(date +%s)\",\"description\":\"scheduling CRUD smoke\",\"recurrenceRule\":{\"kind\":\"weekly\",\"daysOfWeek\":[1,3]},\"timezone\":\"Asia/Ho_Chi_Minh\",\"scheduledTime\":\"09:30\",\"priority\":\"medium\"}" \
  "$BASE/api/companies/$COMPANY_ID/scheduling-routines")
echo "$ROUTINE" | head -c 400
echo ""
ROUTINE_ID=$(echo "$ROUTINE" | sed -E 's/.*"id":"([^"]+)".*/\1/')
echo "ROUTINE_ID=$ROUTINE_ID"
[ -n "$ROUTINE_ID" ] && [ "$ROUTINE_ID" != "$ROUTINE" ] || { echo "CREATE_FAIL"; exit 1; }

echo "== list routines (GET) =="
curl -sS -m 15 -H "$AUTH" "$BASE/api/companies/$COMPANY_ID/scheduling-routines" | grep -o "\"id\":\"$ROUTINE_ID\"" | head -1 && echo "LIST_CONTAINS_ROUTINE"

echo "== get routine (GET) =="
curl -sS -m 15 -H "$AUTH" "$BASE/api/companies/$COMPANY_ID/scheduling-routines/$ROUTINE_ID" | head -c 200
echo ""

echo "== patch routine (PATCH) =="
curl -sS -m 15 -H "$AUTH" -X PATCH -H 'Content-Type: application/json' \
  -d '{"title":"K16 Staging Routine PATCHED","status":"paused"}' \
  "$BASE/api/companies/$COMPANY_ID/scheduling-routines/$ROUTINE_ID" | head -c 300
echo ""

echo "== delete routine (DELETE) =="
curl -sS -m 15 -H "$AUTH" -X DELETE "$BASE/api/companies/$COMPANY_ID/scheduling-routines/$ROUTINE_ID" | head -c 200
echo ""

echo "== issue scheduling upsert (PUT) =="
TARGET_ISSUE=$(docker compose -f "$STAGING_DB_COMPOSE/compose.yaml" exec -T db psql -U paperclip -d paperclip -tAc "select id from issues where company_id='$COMPANY_ID' limit 1")
echo "TARGET_ISSUE=$TARGET_ISSUE"
SCHED_TS=$(date -u -d '+1 hour' +%Y-%m-%dT%H:%M:%SZ)
curl -sS -m 15 -H "$AUTH" -X PUT -H 'Content-Type: application/json' \
  -d "{\"scheduledAt\":\"$SCHED_TS\",\"scheduledDurationMinutes\":60}" \
  "$BASE/api/companies/$COMPANY_ID/issues/$TARGET_ISSUE/scheduling" | head -c 300
echo ""

echo "== get issue scheduling (GET) =="
curl -sS -m 15 -H "$AUTH" "$BASE/api/companies/$COMPANY_ID/issues/$TARGET_ISSUE/scheduling" | head -c 300
echo ""

echo "== clear issue scheduling (DELETE) =="
curl -sS -m 15 -H "$AUTH" -X DELETE "$BASE/api/companies/$COMPANY_ID/issues/$TARGET_ISSUE/scheduling" | head -c 200
echo ""
echo "SCHEDULING_CRUD_PASS user=$EMAIL company=$COMPANY_ID"
