# @dev tagged-comment intake — independent QA verification

Date: 2026-08-30
Branch under test: wt/t_649c493a @ a00c504f2 (merged into wt/t_57391612 for verification)
Verdict: PASS — verified working with two non-blocking findings (see Findings).

## Scope

Independent verification of the tagged-comment (`@dev`) ingestion feature and its
scheduler/CLI behavior, per task t_57391612. All tests run against a real
embedded PostgreSQL 17 cluster (the `embedded-postgres` npm package), as the
`postgres` user (initdb refuses root), using Node v22.23.2.

## Commands and observed results

### 1. Existing feature test suite (59/59 PASS)

```
# unit (no DB), as root
NODE_ENV=test node node_modules/vitest/vitest.mjs run --project @paperclipai/server \
  server/src/__tests__/comment-intake-config.test.ts \
  server/src/services/comment-intake-text.test.ts \
  server/src/__tests__/development-comment-intake-cursor.test.ts
  -> Test Files 3 passed | Tests 18 passed

# integration (embedded Postgres), as postgres
NODE_ENV=test node node_modules/vitest/vitest.mjs run \
  server/src/__tests__/comment-intake.test.ts \
  server/src/__tests__/comment-intake-scheduler.test.ts \
  server/src/__tests__/development-comment-intakes-service.test.ts \
  server/src/__tests__/development-comment-intakes-routes.test.ts
  -> Test Files 4 passed | Tests 41 passed
```

18 + 41 = 59, matching the parent's reported count. The poller/scheduler suites
exercise: complaint/suggestion/triage classification, agent-authored exclusion,
cross-company exclusion, soft-delete exclusion, dedupe across overlap replay,
crash-resume of a stalled intake, secret redaction (partial run), edited-source
triage, 100-per-tick pagination with keyset resume, sanitized error codes with
no watermark advance, single-run guard, stale-run reap, auto-disable after N
failures, poll-interval gate, disabled scheduler, and batch-size honoring.

### 2. Independent QA tests (5 PASS)

Added `server/src/__tests__/comment-intake-qa-independent.test.ts` (4 tests) and
`server/src/__tests__/comment-intake-qa-delete.test.ts` (1 test) to cover the
behaviors the upstream suite does not:

```
NODE_ENV=test node node_modules/vitest/vitest.mjs run \
  server/src/__tests__/comment-intake-qa-independent.test.ts \
  server/src/__tests__/comment-intake-qa-delete.test.ts
  -> Test Files 2 passed | Tests 5 passed
```

Verified behaviors:
- Exact `@dev` token boundaries (case-insensitive): `(@DEV):`, `@dev complaint`,
  `@DEV suggestion -`, `hi @dev issue` all match; `user@dev.example`,
  `@developer`, `@dev-team`, `foo@dev`, `@dev0`, and `` `@dev complaint` `` /
  fenced `@dev` are all rejected.
- Concurrent execution: three overlapping `runSource` ticks -> exactly one
  intake row and exactly one `origin_kind=comment_intake` backlog issue
  (advisory lock + dedupe key + idempotency key absorb the race).
- Repeated processing: `runDue` re-tick and a later replay tick produce one
  backlog item only.
- Unrelated comments left untouched; a secret-bearing comment (`sk-...`,
  `password=...`) is stored redacted (`request_body` NULL,
  `dismissed_reason_code=secret_detected`, no backlog) and the secret text never
  appears in `comment_intake_runs` or `comment_intake_checkpoints`.
- Deleting a backlog-linked issue does not error (composite company-integrity FK
  coexists correctly with the `SET NULL` single FK) and nulls the link.

### 3. CLI runner end-to-end (PASS)

Drove `server/scripts/comment-intake-run.ts` against the live embedded cluster:

```
--smoke                 -> exit 0, {"phase":"smoke","sources":1,"enabled":1,...}
run                     -> exit 0, {"phase":"run","processed":1,... "createdCount":1,"status":"succeeded"}
re-run                  -> exit 0, {"skipped":"not_due"}
ENABLED=false           -> exit 0, {"disabled":true,"results":[]}
embedded-postgres mode  -> exit 2, "requires a Postgres database ..."
invalid config          -> exit 1, "comment-intake-run failed: Invalid Paperclip config ..."
```

Resulting rows: 1 intake, 1 backlog issue. Connection string never appears in
stdout/stderr.

### 4. Secret / credential leak check (PASS)

- `comment_intake_runs.error_detail` is bounded to 120 chars and carries only
  the error `name`; no body, headers, tokens, cursor text, or provider payload.
- `comment_intake_checkpoints` stores only cursor/watermark/error-code fields.
- Logger statements emit only ids, counts, and sanitized error codes.
- CLI writes only non-secret knobs and run stats.
- Redacted/archived `request_body` is NULL at the API boundary
  (`shapeDevelopmentCommentIntake` suppresses it).

## Findings

1. (MINOR, documentation) The implementation contract
   `doc/plans/2026-08-30-dev-comment-intake-design.md` is cited in five source
   files (comment-intake.ts, development-comment-intakes.ts, cursor.ts,
   routes.ts) but is absent from the feature branch; it exists only in WIP
   snapshot commits (t_17f6daea). The contract text is recoverable from git
   history but not discoverable from the branch. Recommend committing the doc
   alongside the feature.

2. (OBSERVATION, for architect decision) "Verified human" attribution is
   implemented as `issue_comments.author_agent_id IS NULL` plus the author
   existing in `auth_users`. It does NOT require `auth_users.emailVerified`.
   The schema carries a stricter signal (`issue_comments.author_type`,
   `source_trust`) that the poller does not use. If "verified human" (contract
   §1, §2 rule 4) means "verified linked-user", the current check may ingest
   comments from users whose email is unverified. No test covers the
   unverified-email case; all seeds use `emailVerified: true`.

## Environment notes (for reproducing)

- Worktree `server/node_modules/.vite{,-temp}` and root `node_modules/.vite{,-temp}`
  must be owned by `postgres` before the embedded-PG suites run.
- Native shared-library aliases under `node_modules/.pnpm/embedded-postgres@*/…/@embedded-postgres/linux-x64/native/lib`
  must be pre-created as root (see `prepareEmbeddedPostgresNativeRuntime`) or the
  postgres user hits `EACCES: symlink 'libcrypto.so.1.1'`.
- Node v22 is required (vitest 4 needs ^20/^22/>=24; the postgres user only has
  `/usr/bin/node` v18, so a v22 binary was staged at `/tmp/qa-node22/node`).
