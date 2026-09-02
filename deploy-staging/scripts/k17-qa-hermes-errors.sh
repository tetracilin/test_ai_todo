#!/bin/sh
# K17 QA — Hermes gateway error paths (auth/429/5xx/timeout/cancel) against live staging.
# Uses a mock gateway container (k17-mock on the t3-staging_gateway network) for
# 429/500/timeout/cancel and the REAL Hermes relay for auth-failure (bogus key).
# All agents/issues are disposable and scoped to the isolated t3-staging DB.
set -eu
BASE="${1:-http://127.0.0.1:33120}"
COMPOSE_DIR="${2:-/root/projects/t3-paperclip-Aitodo/.worktrees/t_661d88a3/deploy-staging}"
COMPANY="73f27949-7ac6-41bb-a9c3-a79c547fe227"

q() { docker compose -f "$COMPOSE_DIR/compose.yaml" exec -T db psql -U paperclip -d paperclip -v ON_ERROR_STOP=1 -qtA -c "$1"; }
setmode() { curl -sS -m 5 -X POST http://127.0.0.1:8137/__mode -d "{\"mode\":\"$1\"}" >/dev/null; }

mkagent() { # mkagent <name> <apiBaseUrl> <apiKeyJson> <extraJson>
  local extra="$4"
  [ -n "$extra" ] && extra=",$extra"
  local cfg="{\"apiBaseUrl\":\"$2\",\"apiKey\":$3,\"paperclipApiUrl\":\"http://127.0.0.1:33120/api\",\"dangerouslyAllowInsecureRemoteHttp\":true${extra}}"
  q "insert into agents (company_id, name, role, adapter_type, adapter_config, status)
     values ('$COMPANY', '$1', 'general', 'hermes_gateway', '$cfg'::jsonb, 'idle')
     returning id;"
}

trigger() { # trigger <agentId> <tag> -> creates issue, returns issue id
  curl -sS -m 15 -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
    -d "{\"title\":\"K17 err $2 $(date +%s)\",\"description\":\"error-path probe\",\"status\":\"todo\",\"assigneeAgentId\":\"$1\",\"priority\":\"medium\"}" \
    "$BASE/api/companies/$COMPANY/issues" | sed -E 's/.*"id":"([^"]+)".*/\1/'
}

wait_run() { # wait_run <agentId> <seconds> -> prints latest run id/status/error_code for agent
  local a="$1" s="$2" i=0
  while [ "$i" -lt "$s" ]; do
    ROW=$(q "select id||'|'||status||'|'||coalesce(error_code,'')||'|'||coalesce(exit_code::text,'') from heartbeat_runs where agent_id='$a' order by created_at desc limit 1;")
    ST=$(printf '%s' "$ROW" | cut -d'|' -f2)
    if [ "$ST" != "queued" ] && [ "$ST" != "running" ] && [ -n "$ROW" ]; then echo "$ROW"; return 0; fi
    i=$((i+2)); sleep 2
  done
  echo "$ROW"
}

# board key for company B (member + instance_admin)
EMAIL="k17-err-$(date +%s)@t3-staging.invalid"
COOKIE="/tmp/k17-err.cookies"; rm -f "$COOKIE"
curl -sS -m 15 -c "$COOKIE" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"k17err-$(date +%s)\",\"name\":\"K17 Err\"}" "$BASE/api/auth/sign-up/email" >/dev/null
UID=$(curl -sS -m 15 -b "$COOKIE" "$BASE/api/auth/get-session" | sed -E 's/.*"userId":"([^"]+)".*/\1/')
KEY="k17-$(openssl rand -hex 24)"; KH=$(printf '%s' "$KEY" | sha256sum | awk '{print $1}')
q "insert into company_memberships (company_id, principal_type, principal_id, status, membership_role) values ('$COMPANY','user','$UID','active','owner') on conflict (company_id,principal_type,principal_id) do update set status='active',membership_role='owner';
   insert into instance_user_roles (user_id, role) values ('$UID','instance_admin') on conflict do nothing;
   insert into board_api_keys (user_id, name, key_hash, expires_at) values ('$UID','k17-err','$KH', now()+interval '1 day');" >/dev/null

echo "== auth-failure (real Hermes relay, bogus key) =="
A1=$(mkagent "k17-authfail" "http://host.docker.internal:8642" '"hsk_k17qa_invalid_0000000000000000"' '')
I1=$(trigger "$A1" "authfail"); echo "issue=$I1 agent=$A1"
R1=$(wait_run "$A1" 60); echo "run=$R1"
printf '%s' "$R1" | grep -qF "hermes_gateway_auth_failed" && echo "PASS: auth-failure -> hermes_gateway_auth_failed" || echo "CHECK: auth-failure row=$R1"

echo "== 429 rate-limit (mock) =="
A2=$(mkagent "k17-mock429" "http://k17-mock:8137" '"test"' '')
setmode ratelimit429
I2=$(trigger "$A2" "mock429"); echo "issue=$I2 agent=$A2"
R2=$(wait_run "$A2" 60); echo "run=$R2"
printf '%s' "$R2" | grep -qF "hermes_gateway_rate_limited" && echo "PASS: 429 -> hermes_gateway_rate_limited" || echo "CHECK: 429 row=$R2"

echo "== 500 upstream error (mock) =="
A3=$(mkagent "k17-mock500" "http://k17-mock:8137" '"test"' '')
setmode server500
I3=$(trigger "$A3" "mock500"); echo "issue=$I3 agent=$A3"
R3=$(wait_run "$A3" 60); echo "run=$R3"
printf '%s' "$R3" | grep -qF "hermes_gateway_upstream_error" && echo "PASS: 500 -> hermes_gateway_upstream_error" || echo "CHECK: 500 row=$R3"

echo "== timeout (mock hang, timeoutSec=5) =="
A4=$(mkagent "k17-hang" "http://k17-mock:8137" '"test"' '"timeoutSec":5')
setmode hang
I4=$(trigger "$A4" "hang"); echo "issue=$I4 agent=$A4"
R4=$(wait_run "$A4" 40); echo "run=$R4"
printf '%s' "$R4" | grep -qF "hermes_gateway_timeout" && echo "PASS: hang -> hermes_gateway_timeout" || echo "CHECK: timeout row=$R4"

echo "== cancel mid-run (mock hang, timeoutSec=180) =="
A5=$(mkagent "k17-cancel" "http://k17-mock:8137" '"test"' '"timeoutSec":180')
setmode hang
I5=$(trigger "$A5" "cancel"); echo "issue=$I5 agent=$A5"
sleep 12
RUN5=$(q "select id from heartbeat_runs where agent_id='$A5' order by created_at desc limit 1;")
echo "cancelling run=$RUN5"
CRESP=$(curl -sS -m 15 -H "Authorization: Bearer $KEY" -X POST "$BASE/api/heartbeat-runs/$RUN5/cancel")
echo "cancel_resp=$(printf '%s' "$CRESP" | head -c 200)"
sleep 5
R5=$(q "select id||'|'||status||'|'||coalesce(error_code,'')||'|'||coalesce(result_json::text,'') from heartbeat_runs where id='$RUN5';")
echo "post-cancel=$R5"
printf '%s' "$R5" | grep -qF "cancelled" && echo "PASS: cancel -> status cancelled" || echo "CHECK: cancel row=$R5"
printf '%s' "$R5" | grep -qF "cancelledByActorType" && echo "PASS: operator-initiated stamp present" || echo "NOTE: operator stamp not in result_json"

echo "== container stability across all error injections =="
docker inspect t3-staging-paperclip-1 --format 'restarts={{.RestartCount}} health={{.State.Health.Status}}'
echo "K17_HERMES_ERRORS_DONE"
