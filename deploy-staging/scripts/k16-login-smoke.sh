#!/bin/sh
# K16 staging authenticated-login smoke via better-auth.
# Creates a disposable staging user, confirms session, then cleans up nothing
# (staging is disposable; the user row is isolated to the staging DB).
set -eu
BASE="${1:-http://127.0.0.1:33120}"
EMAIL="k16-smoke-$(date +%s)@t3-staging.invalid"
PASS="k16smoke-$(date +%s)"
COOKIE_JAR="/tmp/k16-smoke.cookies"
rm -f "$COOKIE_JAR"

echo "== 1. sign-up/email =="
SIGNUP=$(curl -sS -m 15 -c "$COOKIE_JAR" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"K16 Staging Smoke\"}" \
  "$BASE/api/auth/sign-up/email")
echo "$SIGNUP" | head -c 300
echo ""

echo "== 2. get-session =="
SESSION=$(curl -sS -m 15 -b "$COOKIE_JAR" "$BASE/api/auth/get-session")
echo "$SESSION" | head -c 400
echo ""
echo "$SESSION" | grep -q '"user"' && echo "AUTH_SESSION_OK" || { echo "AUTH_SESSION_FAIL"; exit 1; }

echo "== 3. board get-session (Paperclip auth layer) =="
BOARD=$(curl -sS -m 15 -b "$COOKIE_JAR" "$BASE/api/auth/get-session")
echo "$BOARD" | head -c 300
echo ""

echo "== 4. whoami via board profile =="
PROF=$(curl -sS -m 15 -b "$COOKIE_JAR" "$BASE/api/auth/profile")
echo "$PROF" | head -c 300
echo ""
echo "LOGIN_SMOKE_PASS email=$EMAIL"
