# K18 — production cutover runbook (exact commands, 2026-08-26 window 04:00 UTC)

All paths relative to the K18 worktree root unless noted.
Env: `docker compose --env-file deploy-prod/runtime.env -f deploy-prod/compose.yaml`.

## Phase 0 — pre-flight (done 01:30–02:10 UTC)
- [x] Staging rollback drill: backup → restore → healthy in 59s, counts identical, restarts=0
- [x] Entrypoint tests vs `paperclip:k15-7927f06fa` passed
- [x] Dump pipeline verified (74.8 MB checksummed dump, `pg_restore --list` OK)
- [x] Baseline counts captured (`deploy-prod/backups/counts-embedded.json`; refreshed at pause time)
- [x] Compose config validates; subnet 172.21.0.0/24 free; S3 reachable from bridge
- [x] No cron/nightly deploy conflicts (nightly script = legacy SPA port 4173 only)

## Phase 1 — window open (04:00 UTC)
```sh
# 1. announce (board comment) + capture rollback spec of the OLD container
docker inspect paperclip > deploy-prod/backups/paperclip-old-container.inspect.json
docker inspect paperclip --format '{{range .Config.Env}}{{println .}}{{end}}' > deploy-prod/backups/paperclip-old-container.env
chmod 600 deploy-prod/backups/paperclip-old-container.env

# 2. pause writes (snapshot + pause non-terminated agents, cancel recovery)
bash deploy-prod/scripts/k18-pause-writes.sh

# 3. refresh baseline counts at the quiesced moment
COUNT_TARGET=embedded OUT=deploy-prod/backups/counts-embedded.json bash deploy-prod/scripts/k18-counts.sh

# 4. consistent dump of embedded PG (checksummed)
bash deploy-prod/scripts/k18-dump-embedded.sh deploy-prod/backups/embedded-final-$(date -u +%Y%m%dT%H%M%SZ).dump
#   NOTE: downtime clock starts at the STOP, not the dump.

# 5. graceful stop (30s drain) — DOWNTOWN START
docker stop -t 30 paperclip

# 6. full data tarball (embedded PG dir + config + adapters + plugins + secrets) + checksum
tar --zstd -cf deploy-prod/backups/paperclip-data-$(date -u +%Y%m%dT%H%M%SZ).tar.zst \
  --exclude='instances/default/logs' -C /root paperclip-data
(cd deploy-prod/backups && sha256sum paperclip-data-*.tar.zst > paperclip-data-<TS>.tar.zst.sha256)

# 7. free the container name for the compose stack
docker rm paperclip
```

## Phase 2 — dedicated PG + commit-pinned image (04:05 UTC)
```sh
# 8. dedicated PostgreSQL (internal network, no host port) + restore final dump
bash deploy-prod/scripts/restore-postgres.sh deploy-prod/backups/embedded-final-<TS>.dump
#    (stops compose paperclip [no-op], up db, drop/create, pg_restore, up paperclip,
#     fork migrations auto-apply 216 -> ~228, healthcheck)

# 9. Hermes relay for the production bridge (after t3-prod_gateway exists)
BRIDGE=$(docker network inspect t3-prod_gateway --format '{{(index .IPAM.Config 0).Gateway}}')   # 172.21.0.1
nohup socat TCP-LISTEN:8642,bind=$BRIDGE,fork,reuseaddr TCP:127.0.0.1:8642 >> /var/log/paperclip-prod-relay.log 2>&1 &
IFACE=$(docker network inspect t3-prod_gateway --format '{{(index .Options "com.docker.network.bridge.name")}}')
ufw allow in on $IFACE to $BRIDGE port 8642 proto tcp

# 10. smoke (health/commit, auth, UI, scheduling CRUD, Hermes relay, counts diff)
bash deploy-prod/scripts/k18-smoke.sh
```

## Phase 3 — observe + restore (04:15–06:00 UTC)
```sh
# 11. restore agent statuses (idle agents back to idle; manual pauses untouched)
bash deploy-prod/scripts/k18-resume-agents.sh
# 12. verify
docker inspect paperclip --format 'restarts={{.RestartCount}} healthy={{.State.Health.Status}}'
docker compose --env-file deploy-prod/runtime.env -f deploy-prod/compose.yaml ps
docker exec paperclip curl -s http://127.0.0.1:3100/api/health
docker network inspect t3-prod_database --format '{{json .Internal}}'   # must be true
docker port t3-prod-db-1 || echo "db has NO host ports (expected)"
# 13. watch: docker events / healthcheck cron every 5 min; spot-check logs
```

## Rollback (only if a gate fails — rehearsed in staging, scripted)
```sh
bash deploy-prod/scripts/k18-rollback.sh
# stops compose, restores original instances/default/config.json from the tarball,
# recreates the old ghcr container from the recorded inspect/env, waits for health.
```

## Evidence artifacts (deploy-prod/backups/, gitignored)
- `embedded-final-<TS>.dump` + `.sha256` — final embedded-PG dump
- `paperclip-data-<TS>.tar.zst` + `.sha256` — full /root/paperclip-data
- `paperclip-old-container.inspect.json` + `.env` — old container spec
- `agents-status-before.json` — pause snapshot
- `counts-embedded.json` — quiesced baseline
