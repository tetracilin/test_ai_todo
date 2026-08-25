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
