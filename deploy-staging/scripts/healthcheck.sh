#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DEPLOY_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE=${COMPOSE_FILE:-$DEPLOY_DIR/compose.yaml}
HERMES_API_BASE_URL=${HERMES_API_BASE_URL:-http://host.docker.internal:8642}

cd "$DEPLOY_DIR"
docker compose -f "$COMPOSE_FILE" exec -T db pg_isready -U "${POSTGRES_USER:-paperclip}" -d "${POSTGRES_DB:-paperclip}"
docker compose -f "$COMPOSE_FILE" exec -T paperclip curl --fail --silent --show-error http://127.0.0.1:3100/api/health
docker compose -f "$COMPOSE_FILE" exec -T paperclip curl --fail --silent --show-error "$HERMES_API_BASE_URL/health"
docker compose -f "$COMPOSE_FILE" exec -T discord-bridge node -e "fetch('http://127.0.0.1:8080/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
