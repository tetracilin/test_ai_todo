# K16 — Staging deployment on alternate port: evidence report

Date: 2026-08-25 UTC. Branch `t3-paperclip-aitodo/t_661d88a3-k16-staging-deployment-on-alternate-port`.
Image: `paperclip:k15-7927f06fa` (local fork build of K15-approved commit `7927f06fa`,
config digest `sha256:275f2aaad4ccc3d2c4bfebfbe13bcadaaf7a18ef6a7fa74df2ab4095bad96125`).

## Topology (no collision with live 3100 / live DB)
- Compose project `t3-staging`, isolated named volumes `t3-staging_postgres-data` +
  `t3-staging_paperclip-data`, internal `database` network + bridge `gateway`
  (pinned `172.20.0.0/24`).
- App bound `127.0.0.1:33120 -> 3100`; `docker compose port db 5432` returns no host binding.
- Live Paperclip (host-network 3100, embedded PG 54329) untouched: live restart count 0.
- Fresh consistent dump of live embedded PG 18.1 (74,704,079 bytes, 1,733 catalog entries,
  SHA-256 `43d92079...b3d03df8`) restored; staging DB at migration 227 (216 restored + 11 fork
  migrations incl. scheduling 0227/0228).
- `paperclip-data` volume seeded with live `secrets` (master.key), `companies`, `projects`,
  `skills`, `runtime-services` so the restored `hermes_gateway` agents' `secret_ref` resolves.

## Hermes relay (supervised)
- Hermes gateway binds only `127.0.0.1:8642`. Supervised socat relay on the pinned bridge
  gateway `172.20.0.1:8642 -> 127.0.0.1:8642` (systemd unit provided in repo:
  `deploy-staging/hermes-bridge-relay.service`; run as background process during soak).
- UFW route + bridge-inbound rules scoped to `172.20.0.1:8642` from the docker bridge.
- Verified in-container: `wget http://host.docker.internal:8642/health` ->
  `{"status":"ok","platform":"hermes-agent","version":"0.20.5"}`.

## Evidence
1. Health: `GET http://127.0.0.1:33120/api/health` -> `status ok`, `commit 7927f06fa...`,
   `bootstrapStatus ready`. Paperclip + db containers `healthy`, RestartCount 0.
2. Authenticated login: better-auth sign-up -> `get-session` returns user + session
   (`AUTH_SESSION_OK`); board `profile` returns the signed-in user.
3. Scheduling CRUD (board API key): create routine (201), list contains id, get ok,
   patch -> title PATCHED/status paused, delete -> `{"deleted":true}`; per-issue
   scheduling PUT -> scheduledAt + duration, GET returns row, DELETE -> `{"deleted":true}`.
4. Hermes agent run: issue assigned to hermes_gateway agent `24c36c90...` -> heartbeat run
   `80ca9564-e65a-42be-b223-453f509ddc38` status `succeeded`, exitCode 0, invoked
   `POST http://host.docker.internal:8642/v1/runs`; Hermes gateway run `run_8389ea48...`
   confirmed in `/root/.hermes/logs/agent.log`; agent posted `K16-STAGING-HERMES-RUN-OK`
   to the issue.
5. 30-minute soak: `deploy-staging/scripts/k16-soak.sh` polled every 2 min from
   19:50:46Z to 20:20:48Z -> `SOAK_PASS`; every sample `pc_restarts=0 db_restarts=0`,
   status running, health healthy, zero error lines.

## Staging-only data adjustments (isolated t3-staging DB; live untouched)
- Repointed both hermes_gateway agents: `apiBaseUrl=http://host.docker.internal:8642`,
  `paperclipApiUrl=http://127.0.0.1:33120/api`.
- Set `dangerouslyAllowInsecureRemoteHttp=true` on agent `24c36c90` (documented K13/K10
  dev-only escape hatch for the private plain-HTTP bridge hop; production should use TLS).
- Unpaused agent `24c36c90` and reactivated company `73f27949` (restored snapshot had both
  paused/archived, which blocked the wake).

## Residual risk
- Registry push of the fork image is deferred to the human-gated release lane (K18); staging
  runs the locally built tag.
- Relay is a background process for staging; the systemd unit in the repo must be installed by
  the operator for durable production use (install path /etc/systemd/system is guarded).
- `dangerouslyAllowInsecureRemoteHttp` is acceptable for the private bridge hop in staging only.
- Soak covered ~30 min zero-restart; host reboot / long-duration behavior belongs to K17/K18.

## Artifacts in repo (branch, worktree root)
- `deploy-staging/compose.yaml`, `.env.example`, `paperclip-config.json`,
  `hermes-bridge-relay.service`, `scripts/*` (backup/restore/healthcheck + k16 smoke suites).
- `docs/deploy/staging-k16.md` runbook.
- Commits: `384075aee`, `d3aae6858` (both pushed to origin branch).
