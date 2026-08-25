#!/bin/sh
# K17 QA — scheduling timezone / DST offset resolution (live staging).
# Creates routines via the scheduling API in DST-observing and fixed-offset
# timezones, then checks the computed next_run_at UTC instant in routine_triggers.
set -eu
BASE="${1:-http://127.0.0.1:33120}"
COMPOSE_DIR="${2:-/root/projects/t3-paperclip-Aitodo/.worktrees/t_661d88a3/deploy-staging}"
COMPANY="2588c455-47ca-4b0f-ba96-b5bf63a9c796"
q() { docker compose -f "$COMPOSE_DIR/compose.yaml" exec -T db psql -U paperclip -d paperclip -v ON_ERROR_STOP=1 -qtA -c "$1"; }

EMAIL="k17-tz-$(date +%s)@t3-staging.invalid"
COOKIE="/tmp/k17-tz.cookies"; rm -f "$COOKIE"
curl -sS -m 15 -c "$COOKIE" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"k17tz-$(date +%s)\",\"name\":\"K17 TZ\"}" "$BASE/api/auth/sign-up/email" >/dev/null
UID=$(curl -sS -m 15 -b "$COOKIE" "$BASE/api/auth/get-session" | sed -E 's/.*"userId":"([^"]+)".*/\1/')
KEY="k17-$(openssl rand -hex 24)"; KH=$(printf '%s' "$KEY" | sha256sum | awk '{print $1}')
q "insert into company_memberships (company_id, principal_type, principal_id, status, membership_role) values ('$COMPANY','user','$UID','active','owner') on conflict (company_id,principal_type,principal_id) do update set status='active',membership_role='owner';
   insert into instance_user_roles (user_id, role) values ('$UID','instance_admin') on conflict do nothing;
   insert into board_api_keys (user_id, name, key_hash, expires_at) values ('$UID','k17-tz','$KH', now()+interval '1 day');" >/dev/null

mkroutine() { # mkroutine <timezone> <scheduledTime> <kind> <days> -> routine id
  curl -sS -m 15 -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
    -d "{\"title\":\"K17 TZ $1 $2\",\"status\":\"active\",\"timezone\":\"$1\",\"scheduledTime\":\"$2\",\"recurrenceRule\":{\"kind\":\"$3\",\"daysOfWeek\":$4}}" \
    "$BASE/api/companies/$COMPANY/scheduling-routines" | sed -E 's/.*"id":"([^"]+)".*/\1/'
}

R_NY=$(mkroutine "America/New_York" "09:00" "daily" "[1,2,3,4,5]")
R_HCM=$(mkroutine "Asia/Ho_Chi_Minh" "09:30" "daily" "[1,2,3,4,5]")
echo "routine_ny=$R_NY routine_hcm=$R_HCM"
sleep 2
echo "== computed next_run_at (UTC) =="
q "select r.timezone, r.scheduled_time, t.next_run_at from routines r join routine_triggers t on t.routine_id=r.id where r.id in ('$R_NY','$R_HCM') order by r.timezone;"

echo "== expected offsets (August 2026): America/New_York = UTC-4 (EDT), Asia/Ho_Chi_Minh = UTC+7 (no DST) =="
q "select 'NY_09:00_expects_13:00Z' as check, t.next_run_at at time zone 'UTC' = (date_trunc('day', t.next_run_at at time zone 'America/New_York') + interval '9 hours') at time zone 'America/New_York' at time zone 'UTC' as ok from routine_triggers t join routines r on r.id=t.routine_id where r.id='$R_NY';"
q "select 'HCM_09:30_expects_02:30Z' as check, t.next_run_at at time zone 'UTC' = (date_trunc('day', t.next_run_at at time zone 'Asia/Ho_Chi_Minh') + interval '9 hours 30 minutes') at time zone 'Asia/Ho_Chi_Minh' at time zone 'UTC' as ok from routine_triggers t join routines r on r.id=t.routine_id where r.id='$R_HCM';"

echo "== idempotency / concurrency guard fields on the new routines =="
q "select concurrency_policy, catch_up_policy from routines where id in ('$R_NY','$R_HCM');"

echo "== cleanup test routines =="
q "delete from routines where id in ('$R_NY','$R_HCM');"
echo "K17_TZ_DONE"
