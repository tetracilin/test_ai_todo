#!/bin/sh
# K17 QA — cancellation of in-flight heartbeat runs (board operator path).
# Cancels the k17-* error-probe runs that are still in-flight (429/500 retry loop,
# mock-hang), verifies operator-initiated stamp, and confirms no agent re-wake.
set -eu
BASE="${1:-http://127.0.0.1:33120}"
COMPOSE_DIR="${2:-/root/projects/t3-paperclip-Aitodo/.worktrees/t_661d88a3/deploy-staging}"
COMPANY="73f27949-7ac6-41bb-a9c3-a79c547fe227"
q() { docker compose -f "$COMPOSE_DIR/compose.yaml" exec -T db psql -U paperclip -d paperclip -v ON_ERROR_STOP=1 -qtA -c "$1"; }

EMAIL="k17-cancel-$(date +%s)@t3-staging.invalid"
COOKIE="/tmp/k17-cancel.cookies"; rm -f "$COOKIE"
curl -sS -m 15 -c "$COOKIE" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"k17cancel-$(date +%s)\",\"name\":\"K17 Cancel\"}" "$BASE/api/auth/sign-up/email" >/dev/null
UID=$(curl -sS -m 15 -b "$COOKIE" "$BASE/api/auth/get-session" | sed -E 's/.*"userId":"([^"]+)".*/\1/')
KEY="k17-$(openssl rand -hex 24)"; KH=$(printf '%s' "$KEY" | sha256sum | awk '{print $1}')
q "insert into company_memberships (company_id, principal_type, principal_id, status, membership_role) values ('$COMPANY','user','$UID','active','owner') on conflict (company_id,principal_type,principal_id) do update set status='active',membership_role='owner';
   insert into instance_user_roles (user_id, role) values ('$UID','instance_admin') on conflict do nothing;
   insert into board_api_keys (user_id, name, key_hash, expires_at) values ('$UID','k17-cancel','$KH', now()+interval '1 day');" >/dev/null

echo "== running k17-* runs before cancel =="
q "select r.id, a.name, r.status, coalesce(r.error_code,'') from heartbeat_runs r join agents a on a.id=r.agent_id where a.name like 'k17-%' and r.status='running' order by r.created_at;"

for RUN in $(q "select r.id from heartbeat_runs r join agents a on a.id=r.agent_id where a.name like 'k17-%' and r.status='running' order by r.created_at;"); do
  echo "== cancel $RUN =="
  CODE=$(curl -sS -m 15 -o /tmp/k17-cancel-resp.json -w '%{http_code}' -H "Authorization: Bearer $KEY" -X POST "$BASE/api/heartbeat-runs/$RUN/cancel")
  echo "http=$CODE resp=$(head -c 260 /tmp/k17-cancel-resp.json)"
done

sleep 4
echo "== status after cancel =="
q "select r.id, a.name, r.status, coalesce(r.error_code,''), coalesce(r.signal,'') from heartbeat_runs r join agents a on a.id=r.agent_id where a.name like 'k17-%' order by r.created_at;"

echo "== operator stamp check =="
q "select r.id, r.result_json->>'cancelledByActorType' as by_type, r.result_json->>'cancelledByUserId' is not null as has_user from heartbeat_runs r join agents a on a.id=r.agent_id where a.name like 'k17-%' and r.status='cancelled' order by r.created_at;"

echo "== no re-wake within 20s (new runs for cancelled agents) =="
BEFORE=$(q "select count(*) from heartbeat_runs r join agents a on a.id=r.agent_id where a.name like 'k17-%';")
sleep 20
AFTER=$(q "select count(*) from heartbeat_runs r join agents a on a.id=r.agent_id where a.name like 'k17-%';")
echo "run_count before=$BEFORE after=$AFTER"
[ "$BEFORE" = "$AFTER" ] && echo "PASS: no new runs after cancel (no re-wake)" || echo "CHECK: run count changed $BEFORE -> $AFTER"

echo "== container stability =="
docker inspect t3-staging-paperclip-1 --format 'restarts={{.RestartCount}} health={{.State.Health.Status}}'
echo "K17_CANCEL_DONE"
