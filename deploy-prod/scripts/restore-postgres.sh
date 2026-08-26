#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  printf '%s\n' "usage: $0 BACKUP.dump" >&2
  exit 64
fi

BACKUP_INPUT=$1
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DEPLOY_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE=${COMPOSE_FILE:-$DEPLOY_DIR/compose.yaml}
ENV_FILE=${COMPOSE_ENV_FILE:-$DEPLOY_DIR/runtime.env}
[ -f "$ENV_FILE" ] || ENV_FILE=$DEPLOY_DIR/.env

[ -r "$BACKUP_INPUT" ] || {
  printf '%s\n' "backup is not readable: $BACKUP_INPUT" >&2
  exit 1
}
BACKUP=$(CDPATH= cd -- "$(dirname -- "$BACKUP_INPUT")" && pwd)/$(basename -- "$BACKUP_INPUT")

if [ -r "$BACKUP.sha256" ]; then
  (cd "$(dirname -- "$BACKUP")" && sha256sum -c "$(basename -- "$BACKUP").sha256")
fi

cd "$DEPLOY_DIR"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" stop paperclip
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --wait db

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T db sh -eu -c \
  'password=$(cat /run/secrets/postgres_password)
   PGPASSWORD="$password" dropdb --if-exists --force --username="${POSTGRES_USER}" "${POSTGRES_DB}"
   PGPASSWORD="$password" createdb --username="${POSTGRES_USER}" --owner="${POSTGRES_USER}" "${POSTGRES_DB}"
   PGPASSWORD="$password" exec pg_restore --exit-on-error --no-owner --no-acl --username="${POSTGRES_USER}" --dbname="${POSTGRES_DB}"' \
  < "$BACKUP"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --wait paperclip
"$SCRIPT_DIR/healthcheck.sh"
