# K18 — Production cutover and rollback drill: evidence report

Date: 2026-08-26 UTC. Branch `t3-paperclip-aitodo/t_5ffb66c6-k18-production-cutover-and-rollback-dril`
(commits `a9ae98646`, `51fc7c53a`, `c2bbe88a0`, `9d7602fda`, `7f8ca0fc3`).
Maintenance window: owner-approved (04:00 start, max 2h downtime daily). Actual downtime **5m15s**.

## Result (all gates PASS)

| gate | result |
|---|---|
| health `/api/health` | `{"status":"ok","commit":"7927f06fa…","bootstrapStatus":"ready","databaseBackup":{"status":"ok"}}` |
| container | `paperclip` healthy, `restarts=0`, image `paperclip:k15-7927f06fa` |
| DB exposure | `docker port t3-prod-db-1` → no host ports; `t3-prod_database` internal=true |
| auth stack | get-session 401 unauth; disposable user sign-up + board key worked; identity deleted (5 DELETEs) |
| scheduling CRUD | routine create→list→patch→delete `{"deleted":true}`; issue scheduling PUT/GET/DELETE passed |
| Hermes relay (in-container) | `http://host.docker.internal:8642/health` → `{"status":"ok","platform":"hermes-agent","version":"0.20.5"}` |
| S3 storage (minio) | ListObjectsV2 from new container → 3 real keys (company assets, issue attachments incl. 2026-08-24 CSV) |
| tailnet access | Host `100.103.41.112:3100` → 200 (whitelisted) |
| entity counts | identical except expected deltas (below) |
| guard rails | healthcheck cron exit 0 (no ALERT), circuit breaker exit 0 (no trip), adapters loaded (1) |

## Cutover timeline (2026-08-26)

| time (UTC) | event |
|---|---|
| 03:58:33 | pause writes: 9 idle agents → paused (`maintenance`), 2 active recovery actions cancelled, snapshot `agents-status-before.json` |
| 03:58:47 | quiesced baseline counts captured; final embedded dump `embedded-final-20260826T035847Z.dump` (74,793,769 B, sha256 verified) |
| 04:00:04.841 | `docker stop -t 30 paperclip` — **downtime start** (graceful, 1.2s) |
| 04:02:26 | `/root/paperclip-data` tarball `paperclip-data-20260826T040026Z.tar.zst` (10,946,564,021 B) + sha256 |
| 04:03 | old container removed (`docker rm paperclip`); rollback spec captured earlier (`paperclip-old-container.inspect.json` + `.env`) |
| 04:04–04:05 | dedicated PG restore (`restore-postgres.sh`, 2 runs; first aborted on pre-created-network label mismatch → removed network, compose created it) |
| 04:05:20 | new container healthy on `0.0.0.0:3100` — **downtime end** |
| 04:06–04:09 | relay bound `172.21.0.1:8642` + ufw rule; full smoke suite PASS |
| 04:10 | agent statuses restored (12 paused / 9 idle / 8 terminated — matches pre-cutover; `pause_reason='maintenance'` cleared; manual pauses untouched) |
| 04:12 | guard scripts repointed to standalone PG and verified (healthcheck + circuit breaker) |

**downtime_seconds: 315** (04:00:04.841 → 04:05:20.052).

## Entity counts before → after (baseline = quiesced embedded PG at 03:58:47)

| table | before | after | delta |
|---|---:|---:|---|
| companies | 4 | 4 | 0 |
| agents | 29 | 29 | 0 |
| issues | 120 | 120 | 0 |
| issue_comments | 797 | 797 | 0 |
| projects | 6 | 6 | 0 |
| heartbeat_runs | 21048 | 21048 | 0 |
| plugin_entities | 186 | 186 | 0 |
| plugins | 1 | 1 | 0 |
| user | 4 | 4 | 0 |
| session | 8 | 8 | 0 |
| activity_log | 106453 | 106461 | +8 (startup reconciliation + smoke, K14-established pattern) |
| drizzle migrations | 216 | 227 | +11 (fork scheduling migrations 217–227, K16-identical) |

No unexplained count or id differences. Sample spot-checks: `TVE-*` issues, agent `24c36c90` configs, plugin_entities intact.

## Artifacts (deploy-prod/backups/, gitignored — NOT in the repo)

- `embedded-final-20260826T035847Z.dump` + `.sha256` — final embedded-PG dump (rollback source)
- `paperclip-data-20260826T040026Z.tar.zst` + `.sha256` — full `/root/paperclip-data` (incl. embedded PG data dir `instances/default/db`, config, adapters, plugins, secrets)
- `paperclip-old-container.inspect.json` + `.env` — exact old-container spec for recreation
- `agents-status-before.json` — agent pause snapshot
- `counts-embedded.json` — quiesced baseline

## Rollback drill

- Rehearsed in staging FIRST: backup → restore → healthy in 59s, counts identical, restarts=0 (same topology as production).
- Production rollback is scripted (`deploy-prod/scripts/k18-rollback.sh`): stop compose → verify tarball checksum → restore original `instances/default/config.json` (embedded-postgres mode) from tarball → recreate old ghcr container from recorded inspect/env → wait for health. Embedded PG data dir was never modified by the cutover.
- Not exercised on production (no gate failed).

## Production changes outside the repo (documented for K19 / operator)

1. `deploy-prod/` assets committed to the K18 branch (compose, config, scripts, runbook).
2. Host guard scripts repointed from embedded PG (`127.0.0.1:54329`) to the standalone PG (`db:5432` via secret file):
   - `/usr/local/bin/paperclip-healthcheck` (2 connection sites)
   - `/root/paperclip-data/scripts/paperclip-circuit-breaker.cjs`
3. Hermes relay for the production bridge: `socat TCP-LISTEN:8642,bind=172.21.0.1 → 127.0.0.1:8642` (background process, pid at cutover 3280272) + ufw rule `172.21.0.1 8642/tcp on br-<t3-prod_gateway>`.
4. Container name kept as `paperclip` — all existing wrappers/cron (`paperclip-stop/restart`, healthcheck cron, circuit breaker) work unchanged.

## Decisions

- Kept S3 storage backend (minio tailnet, prefix `paperclip/`) instead of the fork template's local_disk — zero data movement, attachments preserved (verified by object listing).
- Kept `container_name: paperclip` so host tooling and the healthcheck/circuit-breaker crons keep working.
- Tailnet IP + hostnames whitelisted in `PAPERCLIP_ALLOWED_HOSTNAMES` to preserve the existing access path (raw tailnet IP was 200 pre-cutover).
- Production agents NOT force-unpaused for the Hermes smoke: the two hermes_gateway agents are deliberately paused (manual / company_archived); a full Paperclip-triggered Hermes run is K19's acceptance item.
- Dedicated PG password freshly generated; `BETTER_AUTH_SECRET` preserved from the old container (sessions stay valid).

## Residual risk

- Relay is a background process; the systemd unit (`deploy-staging/hermes-bridge-relay.service` pattern) must be installed by the operator for durability across reboots (K13 noted systemd install path is guarded).
- Guard scripts are host/bind-mount patches — re-apply if the container image or host scripts are rebuilt.
- S3 write path (attachment upload) not explicitly E2E'd post-cutover (bootstrap + list verified; K19 to upload an attachment).
- Host-reboot / long-duration behavior remains unverified (carried from K17).
- Legacy SPA nightly deploy script (port 4173) untouched and unrelated.
- Old embedded-PG data dir retained on the bind mount (~11 GB) as the rollback source; may be reclaimed after K19 acceptance.

## next_card_needs (K19 — t_76eb5a4a)

- Acceptance against the NEW production stack: `http://127.0.0.1:3100` + `http://100.103.41.112:3100`, commit `7927f06fa…`, migrations 227, standalone PG `t3-prod-db-1` (postgres:17.9-alpine, internal).
- K19 must exercise: one successful Paperclip-triggered Hermes run (agents still paused by design — unpause one hermes_gateway agent for the test), attachment upload (S3 write path), scheduling E2E on the live stack, and the operator runbook (owner also requested a new-user onboarding README — noted on K19 card).
- Verify the healthcheck cron + circuit breaker continue to pass (now DB-repointed).
- Legacy SPA tag / ancestry proof per K19 checklist unchanged.
