#!/bin/sh
# K18 — consistent custom-format dump of the OLD embedded PostgreSQL
# (host-network container, 127.0.0.1:54329) + sha256 checksum sidecar.
# Uses a disposable postgres:18.1-alpine container on the host network
# (source embedded cluster is PostgreSQL 18.1), same method as K14/K16.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DEPLOY_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
BACKUP_DIR=${BACKUP_DIR:-$DEPLOY_DIR/backups}
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
DEST=${1:-$BACKUP_DIR/embedded-final-$TIMESTAMP.dump}
TEMP="$DEST.partial"

mkdir -p "$(dirname -- "$DEST")"
[ ! -e "$DEST" ] || { printf 'refusing to overwrite %s\n' "$DEST" >&2; exit 1; }

cleanup() { rm -f "$TEMP" "$TEMP.container"; }
trap cleanup EXIT INT TERM

docker run \
  --network host \
  --name k18-pgdump \
  -e PGPASSWORD=paperclip \
  postgres:18.1-alpine \
  pg_dump --format=custom --compress=9 --no-owner --no-acl \
    --username=paperclip --dbname=paperclip \
    --host=127.0.0.1 --port=54329 \
  > "$TEMP" || { docker rm -f k18-pgdump >/dev/null 2>&1 || true; exit 1; }
docker rm -f k18-pgdump >/dev/null 2>&1 || true

docker run \
  --network host \
  --name k18-pglist \
  postgres:18.1-alpine \
  pg_restore --list /dev/stdin < "$TEMP" > /dev/null || { docker rm -f k18-pglist >/dev/null 2>&1 || true; exit 1; }
docker rm -f k18-pglist >/dev/null 2>&1 || true

mv "$TEMP" "$DEST"
(cd "$(dirname -- "$DEST")" && sha256sum "$(basename -- "$DEST")" > "$(basename -- "$DEST").sha256")
trap - EXIT INT TERM
printf '%s\n' "$DEST"
