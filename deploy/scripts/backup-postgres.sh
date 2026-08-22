#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DEPLOY_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE=${COMPOSE_FILE:-$DEPLOY_DIR/compose.yaml}
BACKUP_DIR=${BACKUP_DIR:-$DEPLOY_DIR/backups}
TIMESTAMP=${TIMESTAMP:-$(date -u +%Y%m%dT%H%M%SZ)}
DESTINATION=${1:-$BACKUP_DIR/paperclip-$TIMESTAMP.dump}
TEMP_DESTINATION="$DESTINATION.partial"

mkdir -p "$(dirname -- "$DESTINATION")"
[ ! -e "$DESTINATION" ] || {
  printf '%s\n' "refusing to overwrite $DESTINATION" >&2
  exit 1
}

cleanup() {
  rm -f "$TEMP_DESTINATION"
}
trap cleanup EXIT INT TERM

cd "$DEPLOY_DIR"
docker compose -f "$COMPOSE_FILE" exec -T db sh -eu -c \
  'PGPASSWORD="$(cat /run/secrets/postgres_password)" exec pg_dump --format=custom --compress=9 --no-owner --no-acl --username="${POSTGRES_USER}" --dbname="${POSTGRES_DB}"' \
  > "$TEMP_DESTINATION"

docker compose -f "$COMPOSE_FILE" exec -T db pg_restore --list < "$TEMP_DESTINATION" > /dev/null
mv "$TEMP_DESTINATION" "$DESTINATION"
sha256sum "$DESTINATION" > "$DESTINATION.sha256"
trap - EXIT INT TERM
printf '%s\n' "$DESTINATION"
