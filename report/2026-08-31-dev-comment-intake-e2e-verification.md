# @dev comment-to-backlog — E2E verification against a real Postgres 17

Date: 2026-08-31
Branch under test: wt/t_6d8a4f84 (base 8fea5a31d + merge of origin/wt/t_cc6a2cb0 @ 56ef498a0)
Test DB: embedded PostgreSQL 17 (the `embedded-postgres` npm package), run as the `postgres`
user because initdb refuses root. Node v22.23.2, vitest 4.1.10.
Merge note: the upstream env-prep handoff (t_9851b0df) was marked done without resolving the
required merge. The merge of origin/wt/t_cc6a2cb0 conflicted in
`packages/db/src/migrations/meta/_journal.json` (both sides appended idx 231) and
`packages/db/src/schema/index.ts` (both sides added an export block). Resolved mechanically:
journal keeps 0231_discord_integration_authority at idx 231 and appends 0232_comment_intake_schema
at idx 232; schema index keeps both export blocks. Merge committed as 125dd2855.

## Verdict

PASS — all 6 requirements verified end-to-end against a real Postgres 17 cluster. Two
non-blocking findings (see Findings): three committed service-test cases are broken
(test-code bugs, feature behavior is correct), and the integrated branch lacks the later
production-hardening present on the sibling wt/t_649c493a lineage.

## Requirement matrix

| # | Requirement | Result | Evidence |
|---|---|---|---|
| 1 | Tagged @dev comments ingest and create backlog items | PASS | comment-intake.test.ts: "ingests a tagged @dev comment and creates a backlog issue with a persisted checkpoint" (intake row `intakeStatus=backlog_created`, backlog issue `origin_kind=comment_intake` with `origin_id` = intake id, checkpoint watermark advanced) |
| 2 | Re-run does not duplicate | PASS | comment-intake.test.ts: "re-running ingestion does not create duplicate backlog items" (second tick `createdCount=0`, still exactly 1 intake + 1 backlog) |
| 3 | Untagged comments excluded | PASS | comment-intake.test.ts: "excludes untagged, code-fenced, and lookalike comments" and "excludes agent-authored and soft-deleted comments" (0 intakes, 0 backlog) |
| 4 | Query endpoint filters / paginates | PASS | comment-intake.test.ts: service-level filter + keyset pagination (3 pages, no dup, cursor/filter mismatch -> 400) + HTTP endpoint test (`?kind=complaint&limit=2`, cursor follow) |
| 5 | Authz rejects unauthorized | PASS | committed routes test (401 unauthenticated, 403 cross-company agent, 403 board without access, indistinguishable 404) + real-DB HTTP authz test in comment-intake.test.ts |
| 6 | Checkpoint recovery works | PASS | comment-intake.test.ts: "recovers from a killed mid-run tick" (orphaned running run does not block; atomic rollback leaves no partial state) + "records a failed mid-run tick without advancing the watermark, then retries cleanly" (failure counter increments, watermark not advanced, retry creates exactly once) |

## Command outputs

### 1. Committed unit / route / cursor / text tests — 23/23 PASS (as root)

```
$ pnpm exec vitest run --pool=forks --maxWorkers=2 \
    src/__tests__/development-comment-intakes-routes.test.ts \
    src/__tests__/development-comment-intake-cursor.test.ts \
    src/services/comment-intake-text.test.ts
 Test Files  3 passed (3)
      Tests  23 passed (23)
```
Full log: report/01-committed-unit-tests.log

### 2. New integration test (comment-intake.test.ts) — 10/10 PASS (as postgres)

```
$ NODE_ENV=test node ../node_modules/vitest/vitest.mjs run --pool=forks --maxWorkers=2 \
    src/__tests__/comment-intake.test.ts
 Test Files  1 passed (1)
      Tests  10 passed (10)
```
Full log: report/02-new-integration-test.log
(The single ERROR line is the deliberate issueService mock throw in the failed-run recovery test.)

### 3. Committed service test — 6 passed / 3 failed (as postgres)

```
$ NODE_ENV=test node ../node_modules/vitest/vitest.mjs run --pool=forks --maxWorkers=2 \
    src/__tests__/development-comment-intakes-service.test.ts
 Test Files  1 failed (1)
      Tests  3 failed | 6 passed (9)
```
Full log: report/03-committed-service-test.log

## Findings

F1 (Low, test-code defect, not a feature defect). Three committed cases in
`server/src/__tests__/development-comment-intakes-service.test.ts` fail because the test
seeding/expectations are wrong, not because the query service misbehaves:
- ordering test seeds 5 intakes but asserts a 4-item list (drops one of the same-timestamp pair)
  and relies on random-uuid string comparison for the tie-break;
- cursor test seeds only one `kind=suggestion` row then asserts a non-null next cursor;
- archived-body test seeds an `intakeStatus="archived"` row but the seed helper never sets
  `archivedAt`, so the `archivedAt` assertion fails.
These are fixed on the sibling lineage wt/t_649c493a (commit 266cd51f7 "poller integration
tests, crash-resume and pagination fixes"), which is NOT part of origin/wt/t_cc6a2cb0.
The feature itself is correct: the independently written REQ4 tests in
comment-intake.test.ts prove filtering, keyset pagination, and cursor/filter-mismatch 400
against the real DB.

F2 (Info, scope). origin/wt/t_cc6a2cb0 carries the core poller + query API but not the later
production hardening from wt/t_649c493a: configurable poll interval / batch size / run timeout,
a single-run guard with stale-run reaper, and a "timeout" error classification. None of these
are required by the 6 acceptance requirements verified here. If this branch is the one being
landed, those later commits should be cherry-picked before release.
