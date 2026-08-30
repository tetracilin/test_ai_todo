# K17 — Independent QA, security and data acceptance: evidence report

Date: 2026-08-25 UTC. QA agent `t3-qa`, card `t_d0cf78a9`, child of K16 `t_661d88a3`.
All tests were run against the **running staging artifact** at `http://127.0.0.1:33120`
(image `paperclip:k15-7927f06fa`, config digest
`sha256:275f2aaad4ccc3d2c4bfebfbe13bcadaaf7a18ef6a7fa74df2ab4095bad96125`),
not from summaries. Independent of K16's account.

## Verdict

**Zero P0, zero P1.** One P2 (adapter has no timeout on the initial Hermes run-create
POST). Staging accepted for K18 production cutover (human-gated).

## Image / lineage

- `docker inspect t3-staging-paperclip-1` → image `sha256:275f2aaad4...`, RestartCount 0, health healthy.
- `GET /api/health` → `commit 7927f06fa2ff091ce518e3ea29c51efa8bf971c0`, `bootstrapStatus ready`.
- `git merge-base --is-ancestor 7927f06fa HEAD` → ANCESTOR (worktree at K16 HEAD `e5da12f31`).
- Live host-network Paperclip (3100 / embedded PG 54329) untouched; staging bound 127.0.0.1:33120 only.

## Test matrix

### 1. Zero Google runtime
- `node scripts/check-no-google-runtime.mjs` → `MODE: blocking`, `Result: PASS; zero forbidden runtime paths`.
- `@google/genai` / `firebase` absent from `ui/package.json` deps. Only matches are a
  defensive redaction regex (`/^AIza[0-9A-Za-z\-_]{20,}$/` in `environment-variables-editor/sensitive.ts`)
  and a display label (`google: "Google"` in `lib/utils.ts`). No `generativelanguage` references.

### 2. Hermes run create / success
- `scripts/k16-trigger-hermes-run.sh` → issue `70ca585a` assigned to hermes_gateway agent
  `24c36c90`; `heartbeat_runs` row succeeded `exit_code 0`; agent posted
  `K16-STAGING-HERMES-RUN-OK` to the issue comment. (3 independent successful runs this session.)

### 3. Hermes error paths (live injection)
`scripts/k17-qa-hermes-errors.sh` (authfail against the real relay; 429/500/timeout against a
mock gateway container on the staging bridge):
- auth-failure (bogus key) → `error_code=hermes_gateway_auth_failed`, `exit_code=1`, no crash.
- 429 → `hermes_gateway_rate_limited`, transient retry scheduled (respects `retry-after`).
- 500 → `hermes_gateway_upstream_error`, transient retry scheduled.
- Cancel (`scripts/k17-qa-cancel.sh`) → `POST /api/heartbeat-runs/:id/cancel` returns 200,
  status `cancelled`, `signal=cancelled`, `result_json.cancelledByActorType=user` +
  `cancelledByUserId` set; no agent re-wake.
- Container stability: `restarts=0`, `health=healthy` across ALL injections.

### 4. PostgreSQL persistence / backup / restore
- `scripts/backup-postgres.sh` → `backups/paperclip-20260825T204954Z.dump` (74,856,124 bytes) + sha256 sidecar.
- `scripts/restore-postgres.sh backups/paperclip-20260825T204954Z.dump` → drop/create/pg_restore,
  app back `healthy`, `heartbeat_runs` count 21060 before == 21060 after (no data loss).
- `scripts/k17-qa-restart.sh` → `docker restart` paperclip container: issues 125==125, commit
  unchanged, health healthy, restarts 0 (the +1 run delta is background automation, not loss).

### 5. Scheduling CRUD / timezone / DST / idempotency / authz
- `scripts/k16-scheduling-smoke.sh` → create/list/get/patch/delete routine + issue-scheduling
  upsert/get/clear all pass.
- Timezone/DST: `scheduling_routines.timezone` stores IANA names; server resolves via
  `Intl.DateTimeFormat(timeZone: …)` with round-trip verification and a guard that rejects
  nonexistent local times (spring-forward gap) — `server/src/services/scheduling.ts:95-125`.
  Live offsets confirmed: America/New_York −04:00 (EDT), Asia/Ho_Chi_Minh +07:00 (no DST).
- Idempotency: routines carry `concurrency_policy=coalesce_if_active`, `catch_up_policy=skip_missed`;
  `routine_runs` has unique `(trigger_id, idempotency_key)` + `dispatch_fingerprint` indexes; daily
  routine fired exactly once per day (03:00 UTC) 08-19 → 08-25, no duplicates.
- Authz (`scripts/k17-qa-authz-redaction.sh`): cross-company GET/POST → 403; cross-tenant
  issue fetch by id → 404 (existence-oracle guarded); viewer write → 403 (read-only).

### 6. Retained entities after restore
- Source dump catalog (`staging-source-20260825T182719Z.dump`, 1,733 entries) contains full
  TABLE DATA for companies, projects, agents, issues, issue_comments, company_skills.
- Staging DB post-restore: companies=4, projects=5, agents=28 (23 real + 5 disposable k17),
  issues=125 (119 real + 6 k17), issue_comments=807, company_skills=105. Migration level 227.

### 7. Auth + secret redaction
- `agents.adapter_config.apiKey` for the hermes_gateway agent serializes as
  `{"type":"secret_ref","secretId":"d672fbb1-…"}`, not a plaintext key.
- `company_secret_versions.material` for that secret is AES-GCM (`iv`,`tag`,`scheme:local_e…`),
  no plaintext `secret` field → encrypted at rest.
- API surface: `GET /api/agents/:id` and `/api/agents/:id/configuration` return no `hsk_` token
  (board actor). Restricted agent view path exists (`redactForRestrictedAgentView`,
  `buildAgentDetail restricted`).

### 8. E2E + accessibility smoke
- Headless Chromium (`/usr/bin/chromium-browser --headless --dump-dom`) against
  `http://127.0.0.1:33120/` rendered the login screen: `<html lang="en">`, `<title>Paperclip</title>`,
  email/password inputs with `<label>`s, `Sign In` / `Create one` buttons, theme-toggle button
  with `aria-label="Switch to dark mode"`, 0 images missing alt. (The snap chromium's dbus/AppArmor
  log lines are sandbox noise; the page rendered cleanly.)

### 9. Container restart / host reboot
- Restart: verified (item 4). Host reboot: NOT tested — a reboot would disrupt the live
  Paperclip (3100), Teable, and Honcho services on this host. **Residual risk** carried to K18.

## Defects

- P0: 0
- P1: 0
- P2: 1 — `packages/adapters/hermes/src/gateway/server/execute.ts` `POST /v1/runs`
  (`fetchJson(createRunUrl, …)`) has no AbortSignal/timeout. A hung upstream on run-create leaves
  the heartbeat run in `running` indefinitely (observed: mock-hang run stayed `running` until the
  agent was paused; `timeoutSec` only governs the post-create event-stream/poll phase). No data or
  security impact; recommend a connect/response timeout on run-create before K18.

## Residual risks

- Host reboot / long-duration / HA behaviour not exercised (carried to K18/K19).
- Live SSE-drop / reconnect injection not performed (reconnect is covered by
  `packages/adapters/hermes/src/gateway/server/execute.test.ts` resume cases + `sessionKeyStrategy`).
- Staging restored snapshot carries a stale `company_archived` pause on hermes_gateway agent
  `24c36c90` (`paused_at` 2026-08-23, `pause_reason=company_archived`); K16 worked around it with
  SQL. Production cutover (K18) must reconcile archived-company handling rather than force-activate.
- `dangerouslyAllowInsecureRemoteHttp=true` remains set on staging agent `24c36c90` (dev-only
  plain-HTTP bridge hop; production must use TLS).
- Transient-upstream retry loop bound on initial assignment was not exhaustively mapped; pausing the
  agent cleanly stood the retries down (`scheduled_retry` → cancelled), confirming it is controllable.

## Commands run (exact)

```
node scripts/check-no-google-runtime.mjs
sh deploy-staging/scripts/k16-login-smoke.sh
sh deploy-staging/scripts/k16-scheduling-smoke.sh
sh deploy-staging/scripts/k16-trigger-hermes-run.sh
sh deploy-staging/scripts/backup-postgres.sh
sh deploy-staging/scripts/restore-postgres.sh backups/paperclip-20260825T204954Z.dump
sh deploy-staging/scripts/k17-qa-authz-redaction.sh
sh deploy-staging/scripts/k17-qa-hermes-errors.sh
sh deploy-staging/scripts/k17-qa-cancel.sh
sh deploy-staging/scripts/k17-qa-restart.sh
sh deploy-staging/scripts/k17-qa-timezone.sh
docker run --rm -v $PWD/backups:/out postgres:18.1-alpine pg_restore --list backups/staging-source-20260825T182719Z.dump
/usr/bin/chromium-browser --headless --disable-gpu --no-sandbox --dump-dom --virtual-time-budget=8000 http://127.0.0.1:33120/
```

Signed: t3-qa (K17). Zero P0/P1 → K18 may proceed under its human gate.
