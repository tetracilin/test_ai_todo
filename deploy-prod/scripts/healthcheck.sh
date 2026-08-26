#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DEPLOY_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE=${COMPOSE_FILE:-$DEPLOY_DIR/compose.yaml}
ENV_FILE=${COMPOSE_ENV_FILE:-$DEPLOY_DIR/runtime.env}
[ -f "$ENV_FILE" ] || ENV_FILE=$DEPLOY_DIR/.env
HERMES_API_BASE_URL=${HERMES_API_BASE_URL:-http://host.docker.internal:8642}

cd "$DEPLOY_DIR"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T db pg_isready -U "${POSTGRES_USER:-paperclip}" -d "${POSTGRES_DB:-paperclip}"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T paperclip curl --fail --silent --show-error http://127.0.0.1:3100/api/health
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T paperclip curl --fail --silent --show-error "$HERMES_API_BASE_URL/health"
