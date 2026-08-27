#!/bin/sh
# K19: verify Hermes gateway relay reachability from inside the production
# Paperclip container (relay binds the docker bridge gateway IP).
set -u
RELAY="${1:-172.21.0.1}"
PORT="${2:-8642}"
if command -v curl >/dev/null 2>&1; then
  OUT=$(curl -sS -m 5 "http://${RELAY}:${PORT}/health")
else
  OUT=$(wget -qO- -T 5 "http://${RELAY}:${PORT}/health")
fi
echo "relay-health-from-container: ${OUT:-EMPTY}"
