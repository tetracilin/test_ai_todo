#!/usr/bin/env bash
# Seed the persistent staging tester account on the t3-nightly stack.
#
# Why this exists: staging is login-gated (PAPERCLIP_DEPLOYMENT_MODE=authenticated),
# so QA needs a known account. Creating one by hand does not survive a volume
# reset, and nightly data is explicitly disposable -- so the account is re-asserted
# on every deploy instead of being a one-time manual act.
#
# Idempotent by construction. Safe to re-run on every deploy:
#   * the user is created only when absent;
#   * the instance_admin grant and company memberships are ON CONFLICT no-ops;
#   * an existing account is never modified, so a password rotated by hand on the
#     box is not silently reverted (see PASSWORD DRIFT below).
#
# NEVER run this against production. It is wired into t3-nightly.yml only, and
# the guard below refuses any compose project other than the nightly one.
#
# Usage: seed-staging-tester.sh <base-url> <compose-project>
#   env: SEED_TESTER_EMAIL, SEED_TESTER_PASSWORD, [SEED_TESTER_NAME],
#        [COMPOSE_FILE], [POSTGRES_USER], [POSTGRES_DB]

set -euo pipefail

BASE_URL="${1:?usage: seed-staging-tester.sh <base-url> <compose-project>}"
COMPOSE_PROJECT="${2:?usage: seed-staging-tester.sh <base-url> <compose-project>}"

COMPOSE_FILE="${COMPOSE_FILE:-deploy/compose.yaml}"
POSTGRES_USER="${POSTGRES_USER:-paperclip}"
POSTGRES_DB="${POSTGRES_DB:-paperclip}"
TESTER_NAME="${SEED_TESTER_NAME:-Staging Tester}"

BASE_URL="${BASE_URL%/}"

# Refuse to touch anything but the nightly stack. t3-prod shares this compose
# file, and an accidental project name here would seed a known-password admin
# into production.
if [[ "$COMPOSE_PROJECT" != "t3-nightly" ]]; then
  echo "refusing to seed a tester account into compose project '$COMPOSE_PROJECT' (nightly only)" >&2
  exit 1
fi

if [[ -z "${SEED_TESTER_EMAIL:-}" ]]; then
  echo "SEED_TESTER_EMAIL is unset; skipping tester seed" >&2
  exit 0
fi

# A missing secret must not break the staging deploy -- the stack is still
# perfectly usable, just without the shared QA login. Say so loudly instead.
if [[ -z "${SEED_TESTER_PASSWORD:-}" ]]; then
  echo "::warning title=Staging tester not seeded::STAGING_TESTER_PASSWORD is unset on the 'staging' environment. The stack deployed fine, but $SEED_TESTER_EMAIL was not created or verified."
  exit 0
fi

# The email is interpolated into SQL below. Constrain it to a conservative
# address charset so it cannot carry a quote out of workflow configuration.
if [[ ! "$SEED_TESTER_EMAIL" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
  echo "SEED_TESTER_EMAIL is not a plain email address: $SEED_TESTER_EMAIL" >&2
  exit 1
fi

psql_q() {
  docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" exec -T db \
    psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -v ON_ERROR_STOP=1 -c "$1"
}

# Minimal JSON string escaping. Enough for a credential: the password reaches us
# from a GitHub secret and only backslash and double-quote can break the literal.
json_escape() {
  local s=$1
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  printf '%s' "$s"
}

lookup_user_id() {
  psql_q "select id from \"user\" where lower(email) = lower('${SEED_TESTER_EMAIL}') limit 1"
}

echo "==> Seeding staging tester: $SEED_TESTER_EMAIL"

user_id="$(lookup_user_id)"

if [[ -n "$user_id" ]]; then
  echo "    user already exists (id=$user_id) -- leaving credentials untouched"
else
  echo "    user absent; creating via the app's own sign-up endpoint"
  # Deliberately NOT a direct INSERT: Better Auth owns the password hashing
  # format (server/src/auth/better-auth.ts), and reimplementing it here would
  # rot the first time that changes. The Origin header must be a trusted origin
  # -- PAPERCLIP_PUBLIC_URL makes BASE_URL one.
  signup_body="{\"name\":\"$(json_escape "$TESTER_NAME")\",\"email\":\"$(json_escape "$SEED_TESTER_EMAIL")\",\"password\":\"$(json_escape "$SEED_TESTER_PASSWORD")\"}"

  signup_status="$(
    printf '%s' "$signup_body" | curl -sS -o /tmp/seed-signup.out -w '%{http_code}' \
      -X POST "$BASE_URL/api/auth/sign-up/email" \
      -H "Origin: $BASE_URL" \
      -H "Content-Type: application/json" \
      --data-binary @- || echo 000
  )"

  if [[ "$signup_status" != "200" && "$signup_status" != "201" ]]; then
    echo "sign-up failed with HTTP $signup_status" >&2
    # The response body describes the failure (disabled sign-up, weak password,
    # rate limit) and never echoes the password back.
    sed -e 's/^/    /' /tmp/seed-signup.out >&2 || true
    rm -f /tmp/seed-signup.out
    exit 1
  fi
  rm -f /tmp/seed-signup.out

  user_id="$(lookup_user_id)"
  [[ -n "$user_id" ]] || { echo "sign-up returned $signup_status but no user row appeared" >&2; exit 1; }
  echo "    created (id=$user_id)"
fi

# Nightly already has an instance_admin, so claimFirstInstanceAdmin
# (server/src/first-admin-claim.ts) will not fire for this user -- the grant has
# to be explicit. On a freshly wiped volume this user may claim admin on its own
# first, which is exactly why the insert is a no-op on conflict.
echo "==> Granting instance_admin"
psql_q "insert into instance_user_roles (user_id, role) values ('${user_id}', 'instance_admin') on conflict do nothing" >/dev/null

# instance_admin and company membership are separate concerns: the auth
# middleware builds actor.companyIds purely from company_memberships
# (server/src/middleware/auth.ts:147-161), so without this the tester signs in
# successfully and then sees an empty board.
echo "==> Joining every company as owner"
psql_q "insert into company_memberships (company_id, principal_type, principal_id, status, membership_role)
        select c.id, 'user', '${user_id}', 'active', 'owner' from companies c
        on conflict (company_id, principal_type, principal_id)
        do update set status = 'active', updated_at = now()" >/dev/null

company_count="$(psql_q "select count(*) from company_memberships where principal_type = 'user' and principal_id = '${user_id}' and status = 'active'")"
echo "    active company memberships: $company_count"

# Prove the account actually works rather than trusting that the rows look right.
# PASSWORD DRIFT: if someone changed this account's password by hand on the box,
# this is where it surfaces -- the seed does not overwrite an existing password.
echo "==> Verifying sign-in"
verify_body="{\"email\":\"$(json_escape "$SEED_TESTER_EMAIL")\",\"password\":\"$(json_escape "$SEED_TESTER_PASSWORD")\"}"
verify_status="$(
  printf '%s' "$verify_body" | curl -sS -o /dev/null -w '%{http_code}' \
    -X POST "$BASE_URL/api/auth/sign-in/email" \
    -H "Origin: $BASE_URL" \
    -H "Content-Type: application/json" \
    --data-binary @- || echo 000
)"

if [[ "$verify_status" != "200" ]]; then
  echo "sign-in verification failed with HTTP $verify_status (expected 200)" >&2
  echo "  403 means the origin is not trusted -- check PAPERCLIP_PUBLIC_URL." >&2
  echo "  401 means the stored password differs from STAGING_TESTER_PASSWORD." >&2
  exit 1
fi

echo "==> OK: $SEED_TESTER_EMAIL can sign in to $BASE_URL"
