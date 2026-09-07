#!/bin/sh
set -eu

read_secret() {
  variable_name="$1"
  file_variable_name="${variable_name}_FILE"
  eval "secret_file=\${$file_variable_name:-}"
  [ -n "$secret_file" ] || return 0
  [ -r "$secret_file" ] || {
    printf '%s\n' "$file_variable_name is not readable" >&2
    exit 1
  }
  secret_value=$(cat "$secret_file")
  [ -n "$secret_value" ] || {
    printf '%s\n' "$file_variable_name is empty" >&2
    exit 1
  }
  export "$variable_name=$secret_value"
  unset "$file_variable_name"
}

read_secret POSTGRES_PASSWORD
read_secret BETTER_AUTH_SECRET

# Compose mounts file-backed Docker secrets with host ownership and mode. The
# server runs as the unprivileged Paperclip user, so copy only storage secrets
# into a per-container tmpfs before the image entrypoint drops privileges.
materialize_storage_secret() {
  secret_name="$1"
  source_path="/run/secrets/$secret_name"
  target_dir="${PAPERCLIP_SECRETS_DIR:-/run/paperclip-storage-secrets}"
  target_path="$target_dir/$secret_name"
  [ -r "$source_path" ] || {
    printf '%s\n' "storage secret $secret_name is not readable" >&2
    exit 1
  }
  mkdir -p "$target_dir"
  umask 077
  cat "$source_path" > "$target_path"
  chown "${USER_UID:-1000}:${USER_GID:-1000}" "$target_path"
  chmod 0400 "$target_path"
}

materialize_storage_secret paperclip_artifacts_access_key
materialize_storage_secret paperclip_artifacts_secret_key

: "${POSTGRES_HOST:=db}"
: "${POSTGRES_PORT:=5432}"
: "${POSTGRES_USER:=paperclip}"
: "${POSTGRES_DB:=paperclip}"

encoded_password=$(node -e 'process.stdout.write(encodeURIComponent(process.env.POSTGRES_PASSWORD))')
export DATABASE_URL="postgresql://${POSTGRES_USER}:${encoded_password}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"
unset POSTGRES_PASSWORD

# Materialize runtime config on persistent volume so public URL remains an env
# value while source config stays secret-free and read-only.
config_source=${PAPERCLIP_CONFIG_TEMPLATE:-/etc/paperclip/config.json}
config_target=/paperclip/instances/default/config.json
mkdir -p "$(dirname "$config_target")"
node -e '
  const fs = require("node:fs");
  const [source, target] = process.argv.slice(1);
  const config = JSON.parse(fs.readFileSync(source, "utf8"));
  const publicUrl = process.env.PAPERCLIP_PUBLIC_URL;
  if (publicUrl) {
    config.auth = { ...(config.auth || {}), baseUrlMode: "explicit", publicBaseUrl: publicUrl };
  }
  config.$meta = { ...(config.$meta || {}), updatedAt: new Date().toISOString() };
  fs.writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
' "$config_source" "$config_target"
export PAPERCLIP_CONFIG="$config_target"

exec /usr/local/bin/docker-entrypoint.sh "$@"
