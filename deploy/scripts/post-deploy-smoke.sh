#!/usr/bin/env bash
# usage: post-deploy-smoke.sh <base-url>
#   env: SEED_TESTER_EMAIL, SEED_TESTER_PASSWORD (same account seed-staging-tester.sh seeds)
#
# healthcheck.sh only proves the process is up and on the right commit.
# seed-staging-tester.sh already re-verifies sign-in on every deploy (added
# after PR #99, where a green health check stayed green for four days while
# every real sign-in returned 403). This goes one step further: it proves an
# authenticated request reaches real application data through the same
# session a browser would carry, so a route-level or auth-middleware
# regression that health/sign-in checks alone cannot see still fails the
# deploy.
#
# Read-only. Never creates, modifies, or deletes anything. A missing
# credential skips rather than fails, matching seed-staging-tester.sh: the
# stack is still usable without this extra check running.
set -euo pipefail

BASE_URL="${1:?usage: post-deploy-smoke.sh <base-url>}"
BASE_URL="${BASE_URL%/}"

if [[ -z "${SEED_TESTER_EMAIL:-}" || -z "${SEED_TESTER_PASSWORD:-}" ]]; then
  echo "SEED_TESTER_EMAIL/SEED_TESTER_PASSWORD unset; skipping post-deploy smoke check" >&2
  exit 0
fi

cookie_jar="$(mktemp)"
companies_out="$(mktemp)"
cleanup() { rm -f "$cookie_jar" "$companies_out"; }
trap cleanup EXIT

echo "==> Signing in as $SEED_TESTER_EMAIL to capture a session"
# jq-encoded, not raw string interpolation: a password containing a quote or
# backslash would otherwise produce a malformed request body and fail this
# check on an otherwise-healthy deploy (seed-staging-tester.sh's own
# json_escape does the same for its sign-up/sign-in bodies).
signin_body="$(jq -cn --arg email "$SEED_TESTER_EMAIL" --arg password "$SEED_TESTER_PASSWORD" \
  '{email: $email, password: $password}')"
signin_status="$(
  printf '%s' "$signin_body" | curl -sS -o /dev/null -w '%{http_code}' \
    -c "$cookie_jar" \
    -X POST "$BASE_URL/api/auth/sign-in/email" \
    -H "Origin: $BASE_URL" \
    -H "Content-Type: application/json" \
    --data-binary @- || echo 000
)"
if [[ "$signin_status" != "200" ]]; then
  echo "post-deploy smoke: sign-in failed with HTTP $signin_status" >&2
  exit 1
fi

echo "==> GET $BASE_URL/api/companies with the session"
companies_status="$(
  curl -sS -o "$companies_out" -w '%{http_code}' \
    -b "$cookie_jar" \
    "$BASE_URL/api/companies" || echo 000
)"
if [[ "$companies_status" != "200" ]]; then
  echo "post-deploy smoke: GET /api/companies failed with HTTP $companies_status" >&2
  sed -e 's/^/    /' "$companies_out" >&2 || true
  exit 1
fi

if ! jq -e 'type == "array"' "$companies_out" >/dev/null 2>&1; then
  echo "post-deploy smoke: /api/companies did not return a JSON array" >&2
  sed -e 's/^/    /' "$companies_out" >&2 || true
  exit 1
fi

echo "==> OK: authenticated GET /api/companies on $BASE_URL returned a valid list"
