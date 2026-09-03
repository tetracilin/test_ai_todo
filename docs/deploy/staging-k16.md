# K16 — Staging deployment (alternate port 33120)

Status: staging reference for K17 QA. Never serves production traffic; never
touches the live host-network Paperclip (port 3100, embedded PG 54329) or the
`deploy/` production project.

## Topology

- Compose project: `t3-staging` (isolated named volumes `t3-staging_postgres-data`,
  `t3-staging_paperclip-data`, bridge `gateway` + internal `database` networks).
- App image: `paperclip:k15-7927f06fa` (local fork build of the K15-approved
  commit `7927f06fa`; not a registry tag).
- PostgreSQL `postgres:17.9-alpine` internal-only (no host port).
- App bound to `127.0.0.1:33120 -> 3100`.
- Hermes API base URL: `http://host.docker.internal:8642` via host-gateway.
  The live Hermes gateway binds only `127.0.0.1:8642`, so staging requires a
  supervised host-side relay on the Docker bridge gateway IP -> `127.0.0.1:8642`
  (see below). The Hermes adapter `apiKey` stays a `secret_ref` resolved from
  the restored encrypted secret store (master.key seeded from live data volume).

## No-collision invariants (verified)

- No container binds host port 3100 or the embedded PG 54329.
- DB is on an internal network; `docker compose port db 5432` is empty.
- Separate project name + volumes guarantee no shared state with live/deploy.

## Bring up (from repo worktree, K16 branch)

```sh
cd deploy-staging
# 1. secrets (gitignored)
install -d -m 0700 secrets backups
openssl rand -hex 32 > secrets/postgres_password
openssl rand -hex 32 > secrets/better_auth_secret
# Provision Discord values from the operator secret manager; never generate,
# print, or commit them from this repository.
# secrets/discord_bot_token
# secrets/discord_client_id
# secrets/discord_webhook_secret
# secrets/paperclip_discord_bridge_token
chmod 0600 secrets/*
# 2. .env (gitignored) — see .env.example for names
# 3. seed data volume from live backup (see below)
docker compose config --quiet
docker compose up -d --wait
./scripts/healthcheck.sh
```

## Restore current backup

The source of truth for staging data is a consistent custom-format dump of the
live embedded PG (PostgreSQL 18.1). Take it with a version-matched client:

```sh
docker run --network host -e PGPASSWORD=<pgpass> \
  -v "$PWD/backups:/out" postgres:18.1-alpine \
  pg_dump --format=custom --compress=9 --no-owner --no-acl \
  -h 127.0.0.1 -p 54329 -U paperclip -d paperclip -f /out/staging-source.dump
sha256sum backups/staging-source.dump
```

Restore into the staging DB (drops+recreates the dedicated `paperclip` database):

```sh
cd deploy-staging
./scripts/restore-postgres.sh backups/staging-source-<TS>.dump
```

The fork image applies migrations 217-226 on first startup
(`PAPERCLIP_MIGRATION_AUTO_APPLY=true`); live DB sits at 216.

## Seed the Paperclip data volume

The logical DB dump does not include `/paperclip/instances/default/secrets`
(encrypted master key, decision-signing key) or the companies/projects
instruction bundles. To make the restored `hermes_gateway` agents' `secret_ref`
resolve, copy the live `paperclip-data` instance into the staging volume:

```sh
docker run --name t3-staging-seed --rm=false \
  -v t3-staging_paperclip-data:/paperclip \
  -v /root/paperclip-data/instances/default:/src:ro \
  busybox sh -c 'mkdir -p /paperclip/instances/default && cp -a /src/. /paperclip/instances/default/ && chown -R 1000:1000 /paperclip'
```

Then `docker compose up -d --wait paperclip`. Do not copy the live embedded DB
directory (`instances/default/db/`) — staging uses the standalone PostgreSQL.

## Hermes relay (host side, supervised)

Hermes gateway listens on `127.0.0.1:8642` only. The staging container resolves
`host.docker.internal` to the Docker bridge gateway IP, so a supervised relay on
that IP is required. systemd unit:

```ini
[Unit]
Description=Hermes loopback->bridge relay for Paperclip staging
After=docker.service

[Service]
ExecStart=/usr/bin/socat TCP-LISTEN:8642,bind=172.16.0.1,fork,reuseaddr TCP:127.0.0.1:8642
Restart=always

[Install]
WantedBy=multi-user.target
```

Verify from inside the staging container:

```sh
docker exec <staging-paperclip> curl --fail --silent http://host.docker.internal:8642/health
```

## Evidence runbook

1. Health: `curl http://127.0.0.1:33120/api/health` -> `status: ok`, fork commit.
2. Authenticated login: sign up a disposable user via `/auth` (disableSignUp=false),
   or use the restored session store for an existing user.
3. Scheduling CRUD: authenticated API on `issue_scheduling` / `scheduling_routines`.
4. Hermes run: pick a `hermes_gateway` agent whose adapterConfig points
   `apiBaseUrl=http://host.docker.internal:8642` and `paperclipApiUrl` to the
   staging URL; create a run and confirm a terminal result and a recorded run id.
5. Soak: `docker inspect <staging-paperclip> RestartCount` stays 0 for 30 minutes;
   no error loops in `docker logs`.

## Rollback

`docker compose -f deploy-staging/compose.yaml down` (keep volumes); live
Paperclip is untouched and keeps serving 3100. Never `down -v` during recovery.

## Discord bridge service

`deploy-staging/compose.yaml` defines a `discord-bridge` service: the standalone Node
transport process from `discord-bridge/`. It builds from `../discord-bridge`
(`PAPERCLIP_DISCORD_BRIDGE_IMAGE` overrides the `ghcr.io/paperclipai/paperclip-discord-bridge:canary`
default), joins the `gateway` network, calls the staging server at the internal
`http://paperclip:3100`, and starts only after the `paperclip` service is healthy.
It has no published ports.

The server side of the bridge contract needs two non-secret additions from the same
Compose file: `PAPERCLIP_DASHBOARD_URL` (issue deep links sent to Discord) and
`PAPERCLIP_DISCORD_BRIDGE_TOKEN_FILE` (the bridge-only bearer credential the server
validates on `/api/integrations/discord/*`; the container entrypoint materializes it
from the mounted secret).

### Healthcheck

The bridge runs a loopback readiness endpoint (`HEALTH_PORT`, default `8080`):
`/health` returns `200 {"status":"ready"}` only after the Discord gateway connection is
established, and `503 {"status":"starting"}` until then. The Compose healthcheck probes
it every 15s with a 5s timeout, 12 retries, and a 30s start period; a failed Discord
login exits the process so the container restarts and stays unhealthy rather than
serving a half-connected bot. `scripts/healthcheck.sh` also probes the endpoint.

### Secrets

Discord bridge credentials remain external to git. Start from
`deploy-staging/.env.example`, then place values supplied by the Discord Developer
Portal and the Paperclip operator credential store in the four gitignored files named
there. The Compose definitions declare those files as Docker secrets; the bridge
service receives only `DISCORD_BOT_TOKEN_FILE`, `DISCORD_CLIENT_ID_FILE`,
`DISCORD_WEBHOOK_SECRET_FILE`, and `PAPERCLIP_API_KEY_FILE` paths. An optional fifth
file, `secrets/discord_dev_guild_id`, restricts slash-command registration to one
staging guild; when absent the bridge registers commands globally.

Before bringing up a staging bridge service, verify each file exists, has mode `0600`,
and is owned by the deployment operator. Do not put values in `deploy-staging/.env`, a
Compose `environment` value, logs, CI output, or shell history.

### CI/CD

> **Removed 2026-09-02 (hard fork).** `.github/workflows/discord-staging.yml` was deleted;
> this fork ships only `t3-ci`, `t3-nightly` and `t3-release` (`doc/ORIGIN.md`). There is no
> CI deploy path for the bridge any more — the steps below describe what the workflow *used
> to* do and are kept as the specification for doing it by hand on the staging host. The
> `discord-staging` GitHub Environment now has no consumer; review its secrets for
> revocation. Everything outside this section (compose project, secrets layout, healthcheck)
> is still current.

`.github/workflows/discord-staging.yml` deployed the bridge from CI. It was dispatched manually
with the ref to deploy (default `main`). The `build` job runs the bridge test suite,
typechecks/builds, validates the Compose file, and builds the image; the `deploy-staging`
job then SSHes to the staging host, writes the credential files (from the protected
`discord-staging` GitHub Environment, never repo variables), checks out the exact
deployed SHA, and runs `docker compose up -d --build` followed by `./scripts/healthcheck.sh`.
Secret values are streamed over ssh stdin and never echoed or committed.

### Human provisioning gate

The workflow cannot run until an authorized GitHub administrator creates the protected
`discord-staging` Environment and grants staging SSH access. That Environment must hold
`STAGING_SSH_PRIVATE_KEY`, `STAGING_SSH_HOST`, `STAGING_SSH_USER`,
`STAGING_DEPLOY_PATH`, `PAPERCLIP_DISCORD_BRIDGE_TOKEN`, `DISCORD_BOT_TOKEN`,
`DISCORD_CLIENT_ID`, and `DISCORD_WEBHOOK_SECRET` (plus optional
`DISCORD_DEV_GUILD_ID`). These credentials are human-provisioned; do not add them to
this repository or attempt to fabricate them. After provisioning, an authorized operator
may manually dispatch `.github/workflows/discord-staging.yml`.
