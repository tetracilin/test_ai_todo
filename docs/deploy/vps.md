# VPS deployment with standalone PostgreSQL

## Topology decision

Use Docker Compose bridge networking. `paperclip` joins `gateway` and internal `database`; `db` joins only `database`. PostgreSQL has no `ports` or `expose` entry, so Docker does not bind it on host. Paperclip binds to loopback by default at `127.0.0.1:33100`.

Hermes API base URL from Paperclip container is `http://host.docker.internal:8642`. Linux mapping comes from `extra_hosts: host.docker.internal:host-gateway`. Hermes must listen on host-reachable interface, not only `127.0.0.1`; retain API authentication and host firewall restriction. Because adapter transport policy classifies this hostname as remote plain HTTP, K10 must either enable its explicit dev-only `dangerouslyAllowInsecureRemoteHttp` switch for this private bridge hop or terminate TLS on a private hostname. `paperclipApiUrl`, configured on Hermes adapter later, means Paperclip address reachable from Hermes host, normally `http://127.0.0.1:33100`.

## Pinned images

- Paperclip: `ghcr.io/paperclipai/paperclip:sha-6a4e2e1@sha256:66056e8c979bc2f8ef35083ebd333b7c83224fe3234bd92d251b0bbce1054317`
- PostgreSQL: `postgres:17.9-alpine@sha256:c7526c0f6c3f30260a563d7bcf8ad778effac59a44f8ffa86678c35418338609`

Never replace either with `latest`. Release work must update Paperclip digest to fork commit image after CI publishes it.

## First start

1. Copy `deploy/.env.example` to `deploy/.env`. Fill nonsecret deployment values.
2. Create `deploy/secrets/postgres_password` and `deploy/secrets/better_auth_secret` with random values. Set directory mode `0700` and file mode `0600`. These paths are gitignored.
3. Configure Hermes API listener so container gateway can reach port 8642. Keep `API_SERVER_KEY` enabled. Set `HERMES_API_BASE_URL` only if address differs.
4. Validate and start:

```sh
cd deploy
docker compose config --quiet
docker compose pull
docker compose up -d --wait
./scripts/healthcheck.sh
```

Paperclip startup runs pending migrations because `PAPERCLIP_MIGRATION_AUTO_APPLY=true`. Fresh DB health proves migration and DB access. Telemetry is disabled in config and by `PAPERCLIP_TELEMETRY_DISABLED=1`; owner must explicitly change both controls to opt in.

## Reachability proof

Run from active stack:

```sh
docker compose exec -T paperclip getent hosts host.docker.internal
docker compose exec -T paperclip curl --fail --silent --show-error "$HERMES_API_BASE_URL/health"
docker compose exec -T paperclip curl --fail --silent --show-error http://127.0.0.1:3100/api/health
docker compose port db 5432
```

Expected: Hermes and Paperclip return healthy JSON. `docker compose port db 5432` returns nonzero with `no port 5432/tcp` or empty output because DB has no host binding.

If Hermes remains loopback-only, do not weaken Compose by switching Paperclip to host network. Rebind authenticated Hermes API to host-reachable private address or install a supervised host-side loopback-to-bridge relay. Keep firewall limited to Docker bridge interface/source and repeat in-container proof. Current VPS proof used a temporary `socat` relay from Docker host-gateway port 8642 to `127.0.0.1:8642`; production needs a supervised relay or direct authenticated bind, not an ad-hoc process.

## Backup

```sh
cd deploy
./scripts/backup-postgres.sh
```

Script creates custom-format dump, validates catalog with `pg_restore --list`, writes SHA-256 sidecar, and refuses overwrite. Back up `paperclip-data` separately; DB dump does not include uploads, workspaces, or local encrypted master key.

## Restore

Use only after verified backup and maintenance approval:

```sh
cd deploy
./scripts/restore-postgres.sh backups/paperclip-YYYYMMDDTHHMMSSZ.dump
```

Restore stops Paperclip gracefully, verifies checksum when sidecar exists, restores with `--clean --if-exists --exit-on-error`, restarts app, then checks PostgreSQL, Paperclip, and Hermes. Compose stop grace is 45 seconds for Paperclip and 60 seconds for PostgreSQL.

## Rollback

1. Stop writes and `docker compose stop paperclip`.
2. Preserve failed DB volume and Paperclip data volume; do not delete either.
3. Restore last verified dump into disposable/rollback PostgreSQL volume.
4. Restore matching Paperclip data backup, especially encrypted secrets master key.
5. Revert `PAPERCLIP_IMAGE` to previous digest.
6. Start, run health/auth/entity-count checks, then return traffic.

Never run `docker compose down -v` during recovery.
