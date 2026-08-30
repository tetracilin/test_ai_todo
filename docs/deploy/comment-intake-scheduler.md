---
title: Tagged-Comment (@dev) Ingestion Scheduler
summary: Operations guide for the production scheduler that polls issue comments tagged @dev into the development backlog
---

The tagged-comment ingestion poller turns verified-human issue comments that
contain the `@dev` tag into development-backlog issues. This document is the
operations reference for running that ingestion reliably in production:
enable, disable, tune, manual-run, monitor, and roll back.

## How it runs

Two execution paths exist, both driven by the same code and the same
environment configuration:

1. **In-process heartbeat scheduler (primary).** The server's existing
   heartbeat scheduler tick calls the poller every tick
   (`server/src/index.ts`). Each source is polled at most once per
   `PAPERCLIP_COMMENT_INTAKE_POLL_INTERVAL_MS` (default 5 minutes). This is
   the path used by the standard Compose deployments — no extra container is
   needed.
2. **One-shot CLI (manual runs and external cron).**
   `pnpm comment-intake:run` runs exactly one poll pass against a Postgres
   database and exits with a nonzero status if any source failed. Deployments
   that prefer a cron container, systemd timer, or CI schedule can invoke it
   on any schedule they choose.

Concurrency is handled at three layers:

- A per-source **single-run guard**: a source is skipped (`already_running`)
  while a previous run for it is still active.
- A Postgres **advisory lock** per source serializes genuinely overlapping
  ticks even across processes, so duplicate concurrent runs can never double-
  create backlog issues (combined with the SHA-256 dedupe key and the
  `comment-intake:<intakeId>:v1` idempotency key).
- A **run timeout** bounds every run: a run row left `running` past the
  timeout (crash or hang) is reaped as failed, and each statement in the run
  transaction is capped by `statement_timeout`.

Retries are bounded: a failing source is retried at the poll cadence until it
has failed `PAPERCLIP_COMMENT_INTAKE_MAX_CONSECUTIVE_FAILURES` times in a row,
after which the source is **auto-disabled** and an operator must re-enable it.

## Configuration

All knobs are environment variables; none are secrets.

| Variable | Default | Description |
|----------|---------|-------------|
| `PAPERCLIP_COMMENT_INTAKE_ENABLED` | `true` | Master switch for the in-process scheduler tick and the CLI poll pass. |
| `PAPERCLIP_COMMENT_INTAKE_POLL_INTERVAL_MS` | `300000` (5 min) | Minimum gap between two polls of the same source (clamped to ≥ 30 s). |
| `PAPERCLIP_COMMENT_INTAKE_BATCH_SIZE` | `100` | Candidates read per source per pass (clamped 1–1000). |
| `PAPERCLIP_COMMENT_INTAKE_RUN_TIMEOUT_MS` | `300000` (5 min) | How long a run may stay active before it is considered stale/hung (clamped to ≥ 10 s). |
| `PAPERCLIP_COMMENT_INTAKE_MAX_CONSECUTIVE_FAILURES` | `6` | Consecutive failures before a source is auto-disabled (clamped to ≥ 1). |

Values are validated and clamped at config load (`server/src/config.ts`,
`resolveCommentIntakeOptions`); invalid numeric input falls back to the
default. Deployments can also disable the whole heartbeat scheduler with the
existing `HEARTBEAT_SCHEDULER_ENABLED=false`.

### Least-privilege service identity

The scheduler performs no network calls to external providers — it reads the
local `issue_comments` table and writes intake/backlog rows, all through the
standard application database role (`POSTGRES_USER`, default `paperclip`). No
extra credentials are required. If you run the CLI as a separate cron
container, give it the same application role (read/write on the application
schema, no superuser, no admin database) and pass the connection via
`DATABASE_URL` / `POSTGRES_*` environment variables only — never bake
passwords into the schedule definition or the image.

## Enable / disable

**Enable** (default): nothing to do — `PAPERCLIP_COMMENT_INTAKE_ENABLED`
defaults to `true` and sources become eligible when a row exists in
`comment_intake_sources` with `enabled = true` (set through the app/API; the
poller ignores disabled sources).

**Disable the scheduler** (stops all polling without touching data):

```sh
PAPERCLIP_COMMENT_INTAKE_ENABLED=false docker compose up -d paperclip
```

**Disable one source** (keeps the scheduler running, stops that source only):

```sql
UPDATE comment_intake_sources SET enabled = false WHERE id = '<source-id>';
```

An auto-disabled source (after repeated failures) has `enabled = false`; the
structured log line `comment intake source auto-disabled after consecutive
failures` records `sourceId`, `consecutiveFailureCount`, and
`maxConsecutiveFailures`.

## Manual run

Requires a Postgres-backed server (embedded Postgres is polled only by the
in-process scheduler):

```sh
# From the server package
pnpm comment-intake:run
```

Prints one JSON line per phase to stdout, e.g.:

```json
{"phase":"run","ok":true,"sources":1,"processed":1,"failures":0,"results":[{"sourceId":"...","status":"succeeded","candidateCount":2,"createdCount":1}]}
```

Exit codes: `0` success (including all-skipped), `1` any source failed or an
unexpected error, `2` configuration error (e.g. server uses embedded
Postgres). The manual run honors the same env configuration as the server —
to force a pass while the scheduler is disabled, run
`PAPERCLIP_COMMENT_INTAKE_ENABLED=true pnpm comment-intake:run`.

## Smoke check

```sh
pnpm comment-intake:smoke
```

Verifies database connectivity, that migration `0232` is applied
(`comment_intake_sources` exists), and reports the number of registered and
enabled sources, plus the scheduler knobs in effect. Exits `1` on failure —
useful as a container healthcheck or a pre-cron gate.

## Monitoring

Structured log lines (server tick and CLI):

- `comment intake scheduler tick complete` with `processed` count when any
  source ran (server path).
- `comment intake source poll failed` with sanitized `errorCode`
  (`database_error` | `timeout` | `unexpected_error`).
- `comment intake source auto-disabled after consecutive failures` (warning).
- `comment intake reaped stale running run past its timeout` (warning).

Durable state to query:

```sql
-- Recent runs and their outcome
SELECT source_id, status, started_at, finished_at, created_count,
       duplicate_count, error_code
FROM comment_intake_runs
ORDER BY started_at DESC LIMIT 20;

-- Sources with problems
SELECT id, company_id, enabled, tag
FROM comment_intake_sources
WHERE enabled = false;

-- Failure counters per source
SELECT source_id, consecutive_failure_count, last_error_code, last_attempt_at,
       last_success_at
FROM comment_intake_checkpoints
WHERE consecutive_failure_count > 0
ORDER BY consecutive_failure_count DESC;
```

Alert on: any run with `status = 'failed'`, a source whose `enabled` flipped
to `false` unexpectedly, or `consecutive_failure_count` climbing.

## Rollback

1. **Stop ingestion immediately** — disable the scheduler
   (`PAPERCLIP_COMMENT_INTAKE_ENABLED=false` + recreate the container) or
   disable the offending source (`UPDATE comment_intake_sources SET
   enabled = false WHERE id = ...`).
2. **Confirm no in-flight runs** — `SELECT * FROM comment_intake_runs WHERE
   status = 'running'` should be empty (stale rows are reaped by the timeout
   on the next poll).
3. **Remove undesired backlog items** — delete the intake row and its backlog
   issue (or just cancel the issue; the intake row keeps `intake_status` and
   `backlog_issue_id` for audit). The partial-unique index on
   `backlog_issue_id` and the `(company_id, dedupe_key)` unique constraint
   prevent duplicates on re-ingestion.
4. **Rewind a source checkpoint if needed** — delete the checkpoint row to
   force a full re-read of the source window:
   `DELETE FROM comment_intake_checkpoints WHERE source_id = '<source-id>';`
   (replay is dedupe-safe).
5. **Roll back the deployment** — re-enable or redeploy the previous image;
   the poller schema (`0232`) is additive and the scheduler is a no-op when
   disabled, so an older release simply stops polling until re-enabled.

## Cron-container alternative (external scheduler)

If your deployment convention favors an external scheduler over the in-process
tick:

1. Disable the in-process tick: `PAPERCLIP_COMMENT_INTAKE_ENABLED=false`.
2. Build/run the server image (it contains the CLI) with the same
   `DATABASE_URL` and `POSTGRES_*` env, and invoke:

   ```sh
   node --import ./server/node_modules/tsx/dist/loader.mjs server/scripts/comment-intake-run.ts
   ```

   (or the compiled `server/dist` equivalent), on your cron interval
   (5 minutes recommended). Nonzero exit status drives your failure alerting.

The advisory lock, single-run guard, and dedupe keys keep this path safe even
if the in-process tick is accidentally left enabled (overlapping runs
serialize instead of duplicating).
