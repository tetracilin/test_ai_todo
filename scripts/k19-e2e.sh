#!/bin/sh
# K19 acceptance: create a temporary board API key for the existing instance
# admin (id read from DB, never printed), run the scheduling + attachment E2E,
# then revoke and delete the key. No secret values are echoed.
set -eu

DB="docker exec t3-prod-db-1 psql -U paperclip -d paperclip -tAc"
BASE="http://127.0.0.1:3100"
COMPANY_ID="ca743e8c-e414-49c8-9134-890ea933a3f6"
PROJECT_ID="85a7284b-a13b-48e5-879c-79d935f570f8"

USER_ID=$($DB "select id from \"user\" where email='admin@tecotec.tech'")
TOKEN="k19-$(openssl rand -hex 24)"
KEY_HASH=$(printf '%s' "$TOKEN" | sha256sum | awk '{print $1}')

$DB "insert into board_api_keys (user_id, name, key_hash, expires_at) values ('$USER_ID', 'k19-acceptance-temp', '$KEY_HASH', now() + interval '1 hour')" >/dev/null
cleanup() {
  $DB "delete from board_api_keys where key_hash='$KEY_HASH'" >/dev/null || true
}
trap cleanup EXIT

AUTH="Authorization: Bearer $TOKEN"
JSON='Content-Type: application/json'
echo "== 1. auth check =="
curl -sS -m 10 -H "$AUTH" "$BASE/api/companies/$COMPANY_ID/scheduling-routines" | head -c 200; echo

echo "== 2. create scheduling routine =="
ROUTINE=$(curl -sS -m 10 -H "$AUTH" -H "$JSON" \
  -d "{\"title\":\"K19 acceptance routine $(date +%s)\",\"recurrenceRule\":{\"kind\":\"daily\"},\"scheduledTime\":\"07:30\",\"timezone\":\"Asia/Ho_Chi_Minh\",\"priority\":\"low\",\"projectId\":\"$PROJECT_ID\"}" \
  "$BASE/api/companies/$COMPANY_ID/scheduling-routines")
echo "$ROUTINE" | head -c 300; echo
RID=$(printf '%s' "$ROUTINE" | sed -E 's/.*"id":"([^"]+)".*/\1/')
[ -n "$RID" ] && [ "$RID" != "$ROUTINE" ] || { echo "CREATE_ROUTINE_FAIL"; exit 1; }

echo "== 3. list + patch routine =="
curl -sS -m 10 -H "$AUTH" "$BASE/api/companies/$COMPANY_ID/scheduling-routines/$RID" | head -c 200; echo
curl -sS -m 10 -X PATCH -H "$AUTH" -H "$JSON" -d '{"status":"paused"}' \
  "$BASE/api/companies/$COMPANY_ID/scheduling-routines/$RID" | head -c 200; echo

echo "== 4. issue scheduling upsert =="
ISSUE=$(curl -sS -m 10 -H "$AUTH" -H "$JSON" \
  -d "{\"title\":\"K19 sched smoke $(date +%s)\",\"status\":\"todo\",\"priority\":\"low\"}" \
  "$BASE/api/companies/$COMPANY_ID/issues")
IID=$(printf '%s' "$ISSUE" | sed -E 's/.*"id":"([^"]+)".*/\1/')
echo "issue id captured"
curl -sS -m 10 -X PUT -H "$AUTH" -H "$JSON" -d '{"scheduledAt":"2026-08-27T01:00:00.000Z","scheduledDurationMinutes":30}' \
  "$BASE/api/companies/$COMPANY_ID/issues/$IID/scheduling" | head -c 250; echo
curl -sS -m 10 -H "$AUTH" "$BASE/api/companies/$COMPANY_ID/issues/$IID/scheduling" | head -c 250; echo

echo "== 5. attachment upload (S3 write path) =="
head -c 2048 /dev/urandom > /tmp/k19-attachment.bin
ATT=$(curl -sS -m 20 -H "$AUTH" -F "file=@/tmp/k19-attachment.bin;type=application/octet-stream" \
  "$BASE/api/companies/$COMPANY_ID/issues/$IID/attachments")
echo "$ATT" | head -c 400; echo
AID=$(printf '%s' "$ATT" | sed -E 's/.*"id":"([^"]+)".*/\1/')
[ -n "$AID" ] && [ "$AID" != "$ATT" ] || { echo "ATTACHMENT_FAIL"; exit 1; }
echo "== 6. attachment download round-trip =="
CODE=$(curl -sS -m 20 -H "$AUTH" -o /tmp/k19-download.bin -w '%{http_code}' \
  "$BASE/api/attachments/$AID/content")
echo "download status: $CODE"
sha256sum /tmp/k19-attachment.bin /tmp/k19-download.bin | awk '{print $1}' | uniq -c

echo "== 7. cleanup test data =="
curl -sS -m 10 -X DELETE -H "$AUTH" "$BASE/api/companies/$COMPANY_ID/issues/$IID/scheduling"; echo
curl -sS -m 10 -X DELETE -H "$AUTH" "$BASE/api/companies/$COMPANY_ID/scheduling-routines/$RID"; echo
echo "K19_E2E_DONE routine=$RID issue=$IID attachment=$AID"
