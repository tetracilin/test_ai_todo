#!/bin/sh
# K17 QA — authorization + secret-redaction tests against live staging (127.0.0.1:33120).
# Independent of K16; creates disposable users/keys in the isolated t3-staging DB only.
set -eu
BASE="${1:-http://127.0.0.1:33120}"
COMPOSE_DIR="${2:-/root/projects/t3-paperclip-Aitodo/.worktrees/t_661d88a3/deploy-staging}"
COMPANY_A="2588c455-47ca-4b0f-ba96-b5bf63a9c796"   # scheduling smoke company
COMPANY_B="73f27949-7ac6-41bb-a9c3-a79c547fe227"   # hermes_gateway company
AGENT_B="24c36c90-a6f8-4a58-ac67-b143eaa142dc"      # hermes_gateway agent in B

fail=0
note() { printf '%s\n' "$*"; }
check() { # check <desc> <actual> <expected-substr>
  if printf '%s' "$2" | grep -qF "$3"; then note "PASS: $1"; else note "FAIL: $1 (got: $(printf '%s' "$2" | head -c 160))"; fail=1; fi
}

make_user() { # make_user <company> <tag> -> sets COOKIE,USER_ID,KEY (board token)
  COOKIE="/tmp/k17-qa-$2.cookies"
  rm -f "$COOKIE"
  curl -sS -m 15 -c "$COOKIE" -H 'Content-Type: application/json' \
    -d "{\"email\":\"k17-qa-$2-$(date +%s)@t3-staging.invalid\",\"password\":\"k17qa-$(date +%s)\",\"name\":\"K17 QA $2\"}" \
    "$BASE/api/auth/sign-up/email" >/dev/null
  USER_ID=$(curl -sS -m 15 -b "$COOKIE" "$BASE/api/auth/get-session" | sed -E 's/.*"userId":"([^"]+)".*/\1/')
  KEY="k17-$(openssl rand -hex 24)"
  KEY_HASH=$(printf '%s' "$KEY" | sha256sum | awk '{print $1}')
  (
    cd "$COMPOSE_DIR"
    docker compose exec -T db psql -U paperclip -d paperclip -v ON_ERROR_STOP=1 -qc "
      insert into company_memberships (company_id, principal_type, principal_id, status, membership_role)
      values ('$1', 'user', '$USER_ID', 'active', 'owner')
      on conflict (company_id, principal_type, principal_id) do update set status='active', membership_role='owner';
      insert into instance_user_roles (user_id, role) values ('$USER_ID', 'instance_admin')
      on conflict (user_id, role) do nothing;
      insert into board_api_keys (user_id, name, key_hash, expires_at)
      values ('$USER_ID', 'k17-qa-$2', '$KEY_HASH', now() + interval '1 day');" >/dev/null
  )
}

make_user "$COMPANY_A" "authz-a"
A_KEY="$KEY"; A_USER="$USER_ID"
make_user "$COMPANY_B" "authz-b"
B_KEY="$KEY"; B_USER="$USER_ID"

note "== authz: cross-company read (A key -> company B issues) =="
R=$(curl -sS -m 15 -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $A_KEY" "$BASE/api/companies/$COMPANY_B/issues")
[ "$R" = "403" ] && note "PASS: cross-company GET -> 403 (got $R)" || { note "FAIL: cross-company GET -> $R (expected 403)"; fail=1; }

note "== authz: cross-company write (A key -> create issue in B) =="
R=$(curl -sS -m 15 -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $A_KEY" -H 'Content-Type: application/json' \
  -d '{"title":"K17 authz cross-write","status":"todo"}' "$BASE/api/companies/$COMPANY_B/issues")
[ "$R" = "403" ] && note "PASS: cross-company POST -> 403 (got $R)" || { note "FAIL: cross-company POST -> $R (expected 403)"; fail=1; }

note "== authz: B key reads own company (control) =="
R=$(curl -sS -m 15 -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $B_KEY" "$BASE/api/companies/$COMPANY_B/issues")
[ "$R" = "200" ] && note "PASS: own-company GET -> 200 (got $R)" || { note "FAIL: own-company GET -> $R (expected 200)"; fail=1; }

note "== authz: existence-oracle guard (A key fetches B issue by id -> 404 not 403) =="
BID=$(curl -sS -m 15 -H "Authorization: Bearer $B_KEY" "$BASE/api/companies/$COMPANY_B/issues" | sed -E 's/.*"id":"([^"]+)".*/\1/')
R=$(curl -sS -m 15 -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $A_KEY" "$BASE/api/issues/$BID")
[ "$R" = "404" ] && note "PASS: cross-tenant issue fetch -> 404 (got $R)" || { note "FAIL: cross-tenant issue fetch -> $R (expected 404, no existence leak)"; fail=1; }

note "== authz: viewer write is read-only (viewer membership, NOT instance admin) =="
VCOOKIE="/tmp/k17-qa-viewer.cookies"
rm -f "$VCOOKIE"
curl -sS -m 15 -c "$VCOOKIE" -H 'Content-Type: application/json' \
  -d "{\"email\":\"k17-qa-viewer-$(date +%s)@t3-staging.invalid\",\"password\":\"k17qa-$(date +%s)\",\"name\":\"K17 QA viewer\"}" \
  "$BASE/api/auth/sign-up/email" >/dev/null
V_USER=$(curl -sS -m 15 -b "$VCOOKIE" "$BASE/api/auth/get-session" | sed -E 's/.*"userId":"([^"]+)".*/\1/')
V_KEY="k17-$(openssl rand -hex 24)"
V_KEY_HASH=$(printf '%s' "$V_KEY" | sha256sum | awk '{print $1}')
(
  cd "$COMPOSE_DIR"
  docker compose exec -T db psql -U paperclip -d paperclip -v ON_ERROR_STOP=1 -qc "
    insert into company_memberships (company_id, principal_type, principal_id, status, membership_role)
    values ('$COMPANY_A', 'user', '$V_USER', 'active', 'viewer')
    on conflict (company_id, principal_type, principal_id) do update set status='active', membership_role='viewer';
    insert into board_api_keys (user_id, name, key_hash, expires_at)
    values ('$V_USER', 'k17-qa-viewer', '$V_KEY_HASH', now() + interval '1 day');" >/dev/null
)
R=$(curl -sS -m 15 -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $V_KEY" -H 'Content-Type: application/json' \
  -d '{"title":"K17 viewer write","status":"todo"}' "$BASE/api/companies/$COMPANY_A/issues")
[ "$R" = "403" ] && note "PASS: viewer write -> 403 (got $R)" || { note "FAIL: viewer write -> $R (expected 403)"; fail=1; }

note "== secret redaction: agent detail must not leak resolved secret =="
AG=$(curl -sS -m 15 -H "Authorization: Bearer $B_KEY" "$BASE/api/agents/$AGENT_B")
if printf '%s' "$AG" | grep -qE 'hsk_[A-Za-z0-9_-]{10,}'; then note "FAIL: agent detail leaked an hsk_ token"; fail=1; else note "PASS: agent detail has no hsk_ token"; fi
note "== secret redaction: agent configuration endpoint =="
CFG=$(curl -sS -m 15 -H "Authorization: Bearer $B_KEY" "$BASE/api/agents/$AGENT_B/configuration")
if printf '%s' "$CFG" | grep -qE 'hsk_[A-Za-z0-9_-]{10,}'; then note "FAIL: agent configuration leaked an hsk_ token"; fail=1; else note "PASS: agent configuration has no hsk_ token"; fi
note "== secret redaction: config keeps secret_ref shape (not plaintext) =="
if printf '%s' "$AG$CFG" | grep -qF '"type":"secret_ref"'; then note "PASS: apiKey serialized as secret_ref"; else note "NOTE: secret_ref not visible in restricted view (acceptable)"; fi

if [ "$fail" = "0" ]; then note "K17_AUTHZ_REDACTION_PASS"; else note "K17_AUTHZ_REDACTION_FAIL"; fi
exit $fail
