#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  printf '%s\n' "usage: $0 BACKUP.dump" >&2
  exit 64
fi

BACKUP=$1
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DEPLOY_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE=${COMPOSE_FILE:-$DEPLOY_DIR/compose.yaml}

[ -r "$BACKUP" ] || {
  printf '%s\n' "backup is not readable: $BACKUP" >&2
  exit 1
}

if [ -r "$BACKUP.sha256" ]; then
  (cd "$(dirname -- "$BACKUP")" && sha256sum -c "$(basename -- "$BACKUP").sha256")
fi

cd "$DEPLOY_DIR"
docker compose -f "$COMPOSE_FILE" stop paperclip
docker compose -f "$COMPOSE_FILE" up -d --wait db

docker compose -f "$COMPOSE_FILE" exec -T db sh -eu -c \
  'PGPASSWORD="$(cat /run/secrets/postgres_password)" exec pg_restore --exit-on-error --clean --if-exists --no-owner --no-acl --username="${POSTGRES_USER}" --dbname="${POSTGRES_DB}"' \
  < "$BACKUP"

docker compose -f "$COMPOSE_FILE" up -d --wait paperclip
"$SCRIPT_DIR/healthcheck.sh"
