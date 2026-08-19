#!/usr/bin/env bash
# Nightly VPS deploy: pull latest main, rebuild dist/, restart server.cjs.
#
# Triggered by the "Nightly VPS deploy" Paperclip routine (T-63), which wakes
# the assignee agent on a schedule; the agent runs this script from the
# workspace checkout. Can also be run manually from the repo root:
#   bash scripts/nightly-deploy.sh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

PORT="${T3_PORT:-4173}"
PID_FILE="$REPO_DIR/server.pid"
LOG_FILE="$REPO_DIR/server.log"

log() { echo "[nightly-deploy] $(date -u +%FT%TZ) $*"; }

log "starting deploy from $(git rev-parse --short HEAD)"

git fetch origin main
git checkout main
git reset --hard origin/main

log "now at $(git rev-parse --short HEAD), installing deps"
# --include=dev: this environment sets NODE_ENV=production, which makes
# plain `npm ci` skip devDependencies (vite) and breaks the build step.
npm ci --include=dev

log "building dist/"
GEMINI_API_KEY="${GEMINI_API_KEY:-dummy-deploy-key}" VITE_BASE_PATH="${VITE_BASE_PATH:-/}" npm run build

log "restarting server.cjs on port $PORT"
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  kill "$(cat "$PID_FILE")"
  sleep 1
fi

nohup env T3_PORT="$PORT" node server.cjs > "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"

sleep 1
if curl -sf "http://localhost:$PORT/api/health" > /dev/null; then
  log "deploy complete, health check ok, serving $(git rev-parse --short HEAD)"
else
  log "ERROR: health check failed after restart"
  exit 1
fi
