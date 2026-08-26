# K18 — Production cutover and rollback drill: evidence report

Date: 2026-08-26 UTC. Branch `t3-paperclip-aitodo/t_5ffb66c6-k18-production-cutover-and-rollback-dril`.
Maintenance window: approved by owner (04:00 start, max 2h downtime daily). This execution fills
the window with a cutover whose actual downtime is expected to be minutes.

## Before (pre-cutover, 2026-08-26 ~01:4x UTC)

- Production = host-network container `paperclip` (`ghcr.io/paperclipai/paperclip:latest`),
  embedded PostgreSQL 18.1 on `127.0.0.1:54329` (data at `/root/paperclip-data/instances/default/db`),
  storage = S3 (minio at `nas-storage-t19.tail9831b.ts.net:9000`, prefix `paperclip/`).
- Image digests:
  - legacy runtime: `ghcr.io/paperclipai/paperclip:latest` (image id `66056e8c979b`)
  - target fork: `paperclip:k15-7927f06fa` = `sha256:275f2aaad4ccc3d2c4bfebfbe13bcadaaf7a18ef6a7fa74df2ab4095bad96125`
    (build commit `7927f06fa2ff091ce518e3ea29c51efa8bf971c0`; K17 QA-accepted on staging 33120)
- Baseline entity counts (`deploy-prod/backups/counts-embedded.json`):

| table | count |
|---|---:|
| companies | 4 |
| agents | 24 |
| issues | 117 |
| issue_comments | 796 |
| projects | 5 |
| heartbeat_runs | 21047 |
| plugin_entities | 184 |
| plugins | 1 |
| activity_log | 106437 |
| user | 4 |
| session | 8 |
| drizzle migrations | 216 |

- Agents not paused/terminated (paused for the window, restored after): 4 idle agents
  (companies `ca743e8c…` ×3, `de95baf7…` ×1).
- Active recovery actions 2 / active pause-holds 7 / pending wake requests 0.

## Cutover sequence (04:00 UTC)

1. Announce window (board comment + this file).
2. Pause writes: pause non-terminated agents (`pause_reason=maintenance`, prior status recorded
   in `deploy-prod/backups/agents-status-before.json`); cancel active `issue_recovery_actions`.
3. Consistent dump of embedded PG (`deploy-prod/scripts/k18-dump-embedded.sh`) + sha256.
4. Graceful stop `docker stop -t 30 paperclip` (downtime clock starts).
5. Full `/root/paperclip-data` tarball (zstd) + sha256; old-container `docker inspect` + env
   captured for exact rollback recreation.
6. Dedicated PG: `docker compose up -d db` (postgres:17.9-alpine, internal network, no host port),
   restore dump (`restore-postgres.sh`), migration auto-apply by fork image.
7. Start commit-pinned image `paperclip:k15-7927f06fa` (`docker compose up -d paperclip`,
   `container_name: paperclip`, same /root/paperclip-data bind mount, same S3 backend).
8. Smoke (health / auth stack / UI / scheduling CRUD with temp key / Hermes relay from container /
   entity counts vs baseline).
9. Traffic: new container serves `0.0.0.0:3100` (same as before; tailnet IP whitelisted).
10. Observe until window end; record restarts/errors.

## After

- `production_commit`: `7927f06fa…`
- `image_digest`: `sha256:275f2aaad4…`
- `downtime_seconds`: <TBD>
- entity counts after: <TBD>
- `rollback_artifact`: `deploy-prod/backups/` (embedded dump, paperclip-data tarball,
  old-container inspect/env, rollback script `deploy-prod/scripts/k18-rollback.sh`)

## Rollback drill (rehearsed on staging first)

- Staging drill: fresh checksummed backup of the staging dedicated PG, full restore from that
  backup through `restore-postgres.sh` (stop app → drop/recreate DB → pg_restore → start app →
  healthcheck), counts re-verified. Proves the exact restore path used at cutover.
- Production rollback path (only if a gate fails): `k18-rollback.sh` — stop new stack, restore the
  original `instances/default/config.json` from the tarball, recreate the old container from the
  recorded inspect/env, verify embedded-PG health. Embedded PG data dir is untouched by the
  cutover, so rollback is a config restore + container start.

## Gates

| gate | result |
|---|---|
| health (api/health status ok, commit, bootstrap ready) | <TBD> |
| auth (session probe + temp board key CRUD) | <TBD> |
| entity counts match (expected deltas only) | <TBD> |
| scheduling CRUD | <TBD> |
| Hermes relay from container | <TBD> |
| container restarts during observe | <TBD> |
| DB not published to host | <TBD> |
