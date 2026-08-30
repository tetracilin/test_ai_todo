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

# Docker secrets are root-readable, while Paperclip intentionally runs as the
# unprivileged node user. Copy storage credentials into its private runtime
# directory, then replace the public reference name with that absolute path.
materialize_storage_secret() {
  variable_name="$1"
  eval "secret_ref=\${$variable_name:-}"
  [ -n "$secret_ref" ] || return 0
  case "$secret_ref" in
    /*) return 0 ;;
  esac
  secret_file="/run/secrets/$secret_ref"
  [ -r "$secret_file" ] || return 0
  runtime_dir=/paperclip/instances/default/runtime-secrets
  runtime_file="$runtime_dir/$secret_ref"
  mkdir -p "$runtime_dir"
  cp "$secret_file" "$runtime_file"
  chown node:node "$runtime_dir" "$runtime_file"
  chmod 700 "$runtime_dir"
  chmod 600 "$runtime_file"
  export "$variable_name=$runtime_file"
}

materialize_storage_secret PAPERCLIP_STORAGE_EXTERNAL_ACCESS_KEY_SECRET_REF
materialize_storage_secret PAPERCLIP_STORAGE_EXTERNAL_SECRET_KEY_SECRET_REF

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
