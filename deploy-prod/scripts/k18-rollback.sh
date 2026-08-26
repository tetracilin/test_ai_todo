#!/bin/sh
# K18 — production rollback to the PRE-CUTOVER state (old ghcr image,
# host network, embedded PG) from the recorded backup artifacts.
#
# Preconditions (created by the cutover, never deleted):
#   backups/embedded-final-*.dump(.sha256)   consistent embedded-PG dump
#   backups/paperclip-data-*.tar.zst(.sha256) full /root/paperclip-data tarball
#   backups/paperclip-old-container.inspect.json + .env  old container spec
#   backups/agents-status-before.json        agent pause-state snapshot
#
# Steps: stop new stack -> restore original instance config.json from the
# tarball -> recreate the old container exactly as inspected -> verify health.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DEPLOY_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE=${COMPOSE_FILE:-$DEPLOY_DIR/compose.yaml}
ENV_FILE=${COMPOSE_ENV_FILE:-$DEPLOY_DIR/runtime.env}
[ -f "$ENV_FILE" ] || ENV_FILE=$DEPLOY_DIR/.env
BACKUP_DIR=${BACKUP_DIR:-$DEPLOY_DIR/backups}

TARBALL=$(ls -1 "$BACKUP_DIR"/paperclip-data-*.tar.zst 2>/dev/null | tail -1 || true)
[ -n "$TARBALL" ] || { echo "no paperclip-data tarball found in $BACKUP_DIR" >&2; exit 1; }
INSPECT=$(ls -1 "$BACKUP_DIR"/paperclip-old-container.inspect.json 2>/dev/null | tail -1 || true)
[ -n "$INSPECT" ] || { echo "no old-container inspect json found" >&2; exit 1; }
ENVFILE=$(ls -1 "$BACKUP_DIR"/paperclip-old-container.env 2>/dev/null | tail -1 || true)

cd "$DEPLOY_DIR"

echo "== 1. stop new stack =="
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" down --timeout 45 || true

echo "== 2. verify tarball checksum =="
(cd "$(dirname -- "$TARBALL")" && sha256sum -c "$(basename -- "$TARBALL").sha256")

echo "== 3. restore original instance config.json from tarball =="
tar --zstd -xOf "$TARBALL" paperclip-data/instances/default/config.json > /root/paperclip-data/instances/default/config.json
chmod 600 /root/paperclip-data/instances/default/config.json
grep -q embedded-postgres /root/paperclip-data/instances/default/config.json || { echo "restored config does not reference embedded-postgres" >&2; exit 1; }

echo "== 4. recreate old container from recorded spec =="
docker rm -f paperclip >/dev/null 2>&1 || true
IMAGE=$(node -e 'const j=require(process.argv[1]);process.stdout.write(j.Config.Image)' "$INSPECT")
[ -n "$IMAGE" ] || IMAGE=ghcr.io/paperclipai/paperclip:latest
ARGS="--name paperclip --network host --restart unless-stopped --env-file $ENVFILE -v /root/paperclip-data:/paperclip"
# keep the recorded entrypoint/command so the container boots identically
docker run -d $ARGS "$IMAGE" node --import ./server/node_modules/tsx/dist/loader.mjs server/dist/index.js

echo "== 5. wait for health =="
for i in $(seq 1 60); do
  if docker exec paperclip curl --fail --silent http://127.0.0.1:3100/api/health >/dev/null 2>&1; then
    echo "ROLLBACK_HEALTHY after ${i}0s"
    exit 0
  fi
  sleep 10
done
echo "ROLLBACK_UNHEALTHY" >&2
exit 1
