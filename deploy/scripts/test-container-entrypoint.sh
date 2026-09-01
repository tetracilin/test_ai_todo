#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DEPLOY_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE=${COMPOSE_FILE:-$DEPLOY_DIR/compose.yaml}

work_dir=$(mktemp -d)
cleanup() {
  rm -rf "$work_dir"
}
trap cleanup EXIT INT TERM

mkdir -p "$work_dir/secrets" "$work_dir/paperclip"
printf '%s' 'test-postgres-p@ssword' > "$work_dir/secrets/postgres_password"
printf '%s' 'test-better-auth-secret' > "$work_dir/secrets/better_auth_secret"
printf '%s' 'test-s3-access-key' > "$work_dir/secrets/paperclip_artifacts_access_key"
printf '%s' 'test-s3-secret-key' > "$work_dir/secrets/paperclip_artifacts_secret_key"
: > "$work_dir/secrets/empty_better_auth_secret"
chmod 0600 "$work_dir/secrets/"*

paperclip_image=$(docker compose -f "$COMPOSE_FILE" config --format json | node -e '
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    const image = JSON.parse(input).services?.paperclip?.image;
    if (!image) process.exit(1);
    process.stdout.write(image);
  });
')

run_default_image() {
  docker run --rm \
    --entrypoint /usr/local/bin/t3-container-entrypoint \
    -e PAPERCLIP_CONFIG_TEMPLATE=/etc/paperclip/config.json \
    -e POSTGRES_PASSWORD_FILE=/run/secrets/postgres_password \
    -e BETTER_AUTH_SECRET_FILE=/run/secrets/better_auth_secret \
    -e POSTGRES_HOST=db \
    -e POSTGRES_PORT=5432 \
    -e POSTGRES_USER=paperclip \
    -e POSTGRES_DB=paperclip \
    -v "$SCRIPT_DIR/container-entrypoint.sh:/usr/local/bin/t3-container-entrypoint:ro" \
    -v "$DEPLOY_DIR/paperclip-config.json:/etc/paperclip/config.json:ro" \
    -v "$work_dir/secrets/postgres_password:/run/secrets/postgres_password:ro" \
    -v "$work_dir/secrets/better_auth_secret:/run/secrets/better_auth_secret:ro" \
    -v "$work_dir/secrets/paperclip_artifacts_access_key:/run/secrets/paperclip_artifacts_access_key:ro" \
    -v "$work_dir/secrets/paperclip_artifacts_secret_key:/run/secrets/paperclip_artifacts_secret_key:ro" \
    -v "$work_dir/paperclip:/paperclip" \
    "$paperclip_image" "$@"
}

result=$(run_default_image sh -c '
  [ "$BETTER_AUTH_SECRET" = "test-better-auth-secret" ]
  [ -z "${BETTER_AUTH_SECRET_FILE:-}" ]
  [ "$DATABASE_URL" = "postgresql://paperclip:test-postgres-p%40ssword@db:5432/paperclip" ]
  [ -z "${POSTGRES_PASSWORD:-}" ]
  [ -r "$PAPERCLIP_CONFIG" ]
  [ "$(cat /run/paperclip-storage-secrets/paperclip_artifacts_access_key)" = "test-s3-access-key" ]
  [ "$(cat /run/paperclip-storage-secrets/paperclip_artifacts_secret_key)" = "test-s3-secret-key" ]
  printf passed
')
[ "$result" = passed ] || {
  printf '%s\n' "default-image entrypoint boundary did not pass" >&2
  exit 1
}

empty_output="$work_dir/empty-output"
if docker run --rm \
  --entrypoint /usr/local/bin/t3-container-entrypoint \
  -e POSTGRES_PASSWORD_FILE=/run/secrets/postgres_password \
  -e BETTER_AUTH_SECRET_FILE=/run/secrets/better_auth_secret \
  -v "$SCRIPT_DIR/container-entrypoint.sh:/usr/local/bin/t3-container-entrypoint:ro" \
  -v "$work_dir/secrets/postgres_password:/run/secrets/postgres_password:ro" \
  -v "$work_dir/secrets/empty_better_auth_secret:/run/secrets/better_auth_secret:ro" \
  "$paperclip_image" true >"$empty_output" 2>&1; then
  printf '%s\n' "empty BETTER_AUTH_SECRET_FILE unexpectedly passed" >&2
  exit 1
fi
grep -q 'BETTER_AUTH_SECRET_FILE is empty' "$empty_output"

missing_output="$work_dir/missing-output"
if docker run --rm \
  --entrypoint /usr/local/bin/t3-container-entrypoint \
  -e POSTGRES_PASSWORD_FILE=/run/secrets/postgres_password \
  -e BETTER_AUTH_SECRET_FILE=/run/secrets/missing \
  -v "$SCRIPT_DIR/container-entrypoint.sh:/usr/local/bin/t3-container-entrypoint:ro" \
  -v "$work_dir/secrets/postgres_password:/run/secrets/postgres_password:ro" \
  "$paperclip_image" true >"$missing_output" 2>&1; then
  printf '%s\n' "missing BETTER_AUTH_SECRET_FILE unexpectedly passed" >&2
  exit 1
fi
grep -q 'BETTER_AUTH_SECRET_FILE is not readable' "$missing_output"

printf '%s\n' "deploy entrypoint tests passed against $paperclip_image"
