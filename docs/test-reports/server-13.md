# Test Summary Report: shard server-13 (IEEE 829)

## 1 Report identifier and scope

- Report id: server-13
- Project: `@paperclipai/server` (vitest project `server`)
- Suite: t3-nightly "slow-tests" vitest run
- Files: 14 (`server/src/__tests__/heartbeat-*.test.ts`, alphabetical range `heartbeat-comment-wake-batching` .. `heartbeat-plugin-environment`)
- Test cases: 124 `it()` cases after this audit (121 before; +3 added in `heartbeat-cost-accounting`). No `it.each` / table expansions in this shard.
- Date: see git

## 2 Summary

Every file was read in full and checked against the production symbols it exercises (`services/heartbeat.ts`, `services/recovery`, `services/instance-settings.ts`, `adapters/registry.ts`, `packages/db` embedded-Postgres helper, adapter model profiles). All subjects still exist in this fork and assertions match current behaviour; no upstream-only or stale-default assertions (V1) were found. The `openclaw_gateway` adapter used by the comment-wake-batching suite is still registered in `adapters/registry.ts`, and no assertion depends on Hermes Gateway or the selectable-adapter default list.

Defects found were concentrated in isolation, mock fidelity, portability and a few weak or missing assertions:

| Verdict | Files |
|---|---|
| VALID | 5 |
| VALID_WITH_NOTES | 3 |
| REWRITTEN | 6 |
| OBSOLETE_REMOVED | 0 |
| NEEDS_DECISION | 0 |

No suspected production bug was found. One real latent test bug was found and fixed (`started.stop` does not exist on the embedded-Postgres helper, so the database was never stopped).

## 3 Variances (what could not be verified and why)

- Embedded Postgres cannot start on this Windows host inside the file-local 20 s `beforeAll` timeout. `heartbeat-list` and `heartbeat-plugin-environment` were run and failed in `beforeAll` ("Hook timed out in 20000ms"). Classification: ENV (Windows embedded-PG cold start / contention), not REAL. The same applies to every other embedded-Postgres file in the shard.
- Therefore the DB-backed files that were edited (`heartbeat-plugin-environment`, `heartbeat-local-environment`, `heartbeat-dependency-scheduling`, `heartbeat-pending-cleanup-sweep`) are verified by reading and by the fact that the edits are small and syntactically trivial. They are NOT dynamically verified. They must be confirmed by t3-nightly on Linux.
- DB-backed files not run at all (no edit, ENV): `heartbeat-comment-wake-batching`, `heartbeat-issue-liveness-escalation`, `heartbeat-issue-rewake-throttle`, `heartbeat-list`, `heartbeat-lock-release-on-reassignment`.
- Pure and filesystem files were run locally and pass: `heartbeat-context-summary` (12), `heartbeat-model-profile` (6), `heartbeat-ledger-billing-code` (4), `heartbeat-cost-accounting` (10 after edit), `heartbeat-managed-clone-credentials` (8 after edit).
- `ensure-build-deps` for `@paperclipai/plugin-sdk` was run first, as required.

## 4 Comprehensive assessment (cross-cutting defects by rubric code)

| Code | Count | Summary |
|---|---|---|
| V1 Validity | 0 | No stale or upstream-only assertions. `openclaw_gateway`, `codex_local`, `process` adapters and model-profile semantics (codex `cheap` has empty adapterConfig) all match current source. |
| V2 Meaningful assertions | 3 | `heartbeat-managed-clone-credentials` cleanup test was vacuous on Windows (ENOENT check on a path the SUT never used); weak `>= 2` / `not.toBe` assertions in comment-wake-batching and dependency-scheduling (reported, not changed); `toBe(CAP)` followed by redundant `toBeLessThanOrEqual(CAP)` in pending-cleanup (reported). |
| V3 Determinism | 4 | Time-relative seeding and polling with bounded deadlines throughout (rewake-throttle uses `Date.now()` offsets; waitFor/waitForCondition use time-bounded loops, acceptable). `heartbeat-local-environment` polling deadline of 5 s on embedded PG is tight. Sets of accepted statuses `["queued","claimed","completed"]` in liveness tests reflect a genuine async race, accepted. |
| V4 Isolation | 4 | `heartbeat-plugin-environment`: instance `defaultEnvironmentId` leaked between tests and `afterAll` called a non-existent `stop` (fixed). `heartbeat-local-environment`: temp dir never removed (fixed). `heartbeat-comment-wake-batching`: no per-test DB cleanup or run drain; relies on unique ids and leaves in-flight runs when the DB is torn down (reported). `heartbeat-managed-clone-credentials`: managed-home paths shared across tests (acceptable, unique company ids). |
| V5 Mock fidelity | 2 | `heartbeat-dependency-scheduling` created `issue_relations` by hand with a DDL that duplicated migration 0049 (dead stand-in that could mask schema drift; removed). `heartbeat-ledger-billing-code` hand-builds a Drizzle chain `select().from().where()`: coupled to the query shape, acknowledged in a comment (reported). `heartbeat-pending-cleanup-sweep` and `heartbeat-plugin-environment` use partial runtime stand-ins cast with `as unknown as` (acceptable boundary doubles). |
| V6 Clarity | 3 | Combined hold-then-re-escalate scenario in one liveness test; variable named `openEscalations` that holds closed and open rows; missing blank line between two comment-wake tests (all reported). |
| V7 Coverage balance | 3 | `resolveLedgerCostStatus` / `resolveCacheAdjustedCostUsd` lacked zero-cost, zero-token and negative-cost cases (added 3 tests). `heartbeat-lock-release-on-reassignment` second test re-implements the production UPDATE inline rather than driving the service (reported). Model-profile `agent_runtime_profile_disabled` branch is untested (reported). |
| V8 Portability | 1 | `heartbeat-managed-clone-credentials`: `deriveRepoNameFromRepoUrl` treats `C:\...` as a URL on Windows, so two tests addressed the wrong managed directory (fixed with scheme-less relative repo URLs). |
| V9 Maintainability | 4 | Magic page size 20/22 in pending-cleanup (fixed); ten near-identical `openclaw_gateway` agent seeds in comment-wake-batching; unused `mockTelemetryClient` in pending-cleanup; duplicated company/agent seed blocks across files (reported). |

## 5 Summary of results

| Path | Tests | Verdict | Defect codes | Action taken |
|---|---|---|---|---|
| server/src/__tests__/heartbeat-comment-wake-batching.test.ts | 12 | VALID_WITH_NOTES | V4, V6, V9, V2 | Read and verified against source; not run (ENV, embedded PG). No edit. |
| server/src/__tests__/heartbeat-context-summary.test.ts | 12 | VALID | none | Read; run, 12 pass. |
| server/src/__tests__/heartbeat-cost-accounting.test.ts | 10 (7 + 3 added) | REWRITTEN | V7 | Added 3 boundary tests; run, 10 pass. |
| server/src/__tests__/heartbeat-dependency-scheduling.test.ts | 6 | REWRITTEN | V5, V9, V2 | Removed dead hand-written `issue_relations` DDL helper; not run (ENV). |
| server/src/__tests__/heartbeat-issue-liveness-escalation.test.ts | 24 | VALID_WITH_NOTES | V6, V3 | Read; not run (ENV). No edit. |
| server/src/__tests__/heartbeat-issue-rewake-throttle.test.ts | 8 | VALID_WITH_NOTES | V3 | Read; not run (ENV). No edit. |
| server/src/__tests__/heartbeat-ledger-billing-code.test.ts | 4 | VALID | V5 (note only) | Read; run, 4 pass. |
| server/src/__tests__/heartbeat-list.test.ts | 5 | VALID | none | Read; run, failed in beforeAll (ENV, 20 s embedded PG start). No edit. |
| server/src/__tests__/heartbeat-local-environment.test.ts | 2 | REWRITTEN | V4 | Temp dir created by the env-injection test is now removed in afterEach; not run (ENV). |
| server/src/__tests__/heartbeat-lock-release-on-reassignment.test.ts | 2 | VALID | V7 (note only) | Read; not run (ENV). No edit. |
| server/src/__tests__/heartbeat-managed-clone-credentials.test.ts | 8 | REWRITTEN | V8, V2 | Two tests made platform-independent and non-vacuous; run, 8 pass (previously 1 ENV failure on Windows). |
| server/src/__tests__/heartbeat-model-profile.test.ts | 6 | VALID | V7 (note only) | Read; run, 6 pass. |
| server/src/__tests__/heartbeat-pending-cleanup-sweep.test.ts | 22 | REWRITTEN | V9 | Replaced magic page-size numbers with `SWEEP_PAGE_SIZE`; not run (ENV). |
| server/src/__tests__/heartbeat-plugin-environment.test.ts | 3 | REWRITTEN | V4, V5 | Fixed teardown (`started.stop` does not exist, now `cleanup()`), reset instance default environment per test, null-safe `afterAll`; run, failed in beforeAll (ENV). |

Test counts by `it(` count: 12 + 12 + 10 + 6 + 24 + 8 + 4 + 5 + 2 + 2 + 8 + 6 + 22 + 3 = 124.

## 6 Per-test detail (tests that are not clean)

| File | Test | Code | Finding | Action |
|---|---|---|---|---|
| heartbeat-comment-wake-batching | defers mentioned-agent wakes while another agent is actively executing the same issue | V2 | `gateway.getAgentPayloads().length toBeGreaterThanOrEqual(2)` and `executionRunId not.toBe(...)` / `executionAgentNameKey not.toBe("mentioned agent")` are weak negative assertions. The sibling test "does not mark a direct mentioned-agent run as the issue execution owner" pins the exact null state. | Reported. |
| heartbeat-comment-wake-batching | (all gateway tests) | V4 | No per-test drain of in-flight runs or table cleanup; a run can still be executing when `afterAll` closes the DB client. | Reported; recommend `afterEach` drain via `drainHeartbeatRunsToQuiescence`. |
| heartbeat-comment-wake-batching | (all gateway tests) | V9 | Identical `openclaw_gateway` agent config copied 10 times. | Reported; extract a `gatewayAgentRow()` helper. |
| heartbeat-comment-wake-batching | does not mark a direct mentioned-agent run... / treats the automatic run summary... | V6 | Missing blank line between the two cases. | Reported (cosmetic). |
| heartbeat-cost-accounting | (file) | V7 | No zero-cost, zero-usage or negative-cost cases. | Added 3 tests: zero cost with tokens is `reported`; null cost with no tokens is `reported`; negative costs are rejected with fallback. |
| heartbeat-dependency-scheduling | (suite setup) | V5/V9 | `ensureIssueRelationsTable` ran `CREATE TABLE IF NOT EXISTS issue_relations` with hand-written DDL after real migrations had already created the table (migration 0049); dead code that could hide drift. | Removed. |
| heartbeat-dependency-scheduling | keeps blocked descendants idle until their blockers resolve | V2 | `blockedWakeRequestCount toBeGreaterThanOrEqual(2)` is loose. Several `waitForCondition` results are ignored but followed by explicit status assertions. | Reported. |
| heartbeat-dependency-scheduling | honors maxConcurrentRuns 1... | V2 | `mockAdapterExecute.mock.calls.length toBeGreaterThanOrEqual(2)` could be exactly 2. | Reported. |
| heartbeat-issue-liveness-escalation | holds a recently closed matching escalation, then re-escalates after the cooldown | V6 | Two behaviours in one test; `openEscalations` holds closed plus open rows. | Reported. |
| heartbeat-issue-liveness-escalation | resolved-dependency tests | V3 | Accepts `["queued","claimed","completed"]` because the wake dispatches a background run; legitimate race tolerance. | Accepted. |
| heartbeat-issue-rewake-throttle | all | V3 | Seeds `finishedAt` relative to `Date.now()`; correctness depends on the throttle window being far larger than test latency. | Reported. |
| heartbeat-local-environment | injects run-scoped Paperclip env into process agents | V4 | `mkdtemp` directory never removed. | Fixed (tracked in `tempDirs`, removed in `afterEach`). |
| heartbeat-local-environment | both | V3 | 5 s polling deadline for run completion on embedded PG is tight on slow hosts. | Reported. |
| heartbeat-managed-clone-credentials | keeps using a pre-existing non-git directory as-is without attempting a clone | V8 | On Windows, `new URL("C:\\...")` parses, so the SUT derived a repo name and used a different directory than the test's `_default` path: failed on Windows (ENV, not a production bug). | Rewritten: scheme-less unreachable repo URL (also proves no clone is attempted), plus `.git` absence assertion. Passes. |
| heartbeat-managed-clone-credentials | leaves neither the target nor temp directories behind when the clone fails | V8/V2 | Same cause: the ENOENT check addressed a path the SUT never used, so it passed vacuously on Windows. | Rewritten with scheme-less relative URL so the `_default` slot is the real target. Passes. |
| heartbeat-ledger-billing-code | all | V5 | Hand-built Drizzle chain `select().from().where()` rots if the query shape changes; documented in a comment. | Reported; a DB-backed test would be stronger. |
| heartbeat-lock-release-on-reassignment | guards the cancel UPDATE WHERE clause against a concurrent claim flip to running | V7/V5 | Reproduces the production UPDATE inline instead of calling the service; it verifies Postgres WHERE semantics, not the SUT. | Reported. |
| heartbeat-model-profile | (file) | V7 | `agent_runtime_profile_disabled` fallback and `profileResolutionFallbackReason` paths are untested. | Reported. |
| heartbeat-pending-cleanup-sweep | respects_backoff_and_page_size | V9 | Hard-coded 22 / 20 duplicated the production page size already modelled as `SWEEP_PAGE_SIZE`. | Fixed. |
| heartbeat-pending-cleanup-sweep | concurrent_sweeps_never_exceed_attempt_cap | V2 | `toBe(CAP)` immediately followed by redundant `toBeLessThanOrEqual(CAP)`. The cap-warning bound `<= 1` is correct because a second sweep can legitimately see attempts at the cap. | Reported. |
| heartbeat-pending-cleanup-sweep | (file) | V9 | `mockTelemetryClient` is mocked but never asserted. | Reported. |
| heartbeat-plugin-environment | (suite teardown) | V4 | `stopDb = started.stop` references a property that does not exist on `EmbeddedPostgresTestDatabase` (only `cleanup()`), so the embedded Postgres instance was never stopped. | Fixed to use `tempDb.cleanup()`; `afterAll` is null-safe when `beforeAll` fails. |
| heartbeat-plugin-environment | inherits the instance default environment across companies... | V4 | Writes instance `defaultEnvironmentId`, which leaked into later tests. | Fixed: reset to null in `afterEach`. |

## 7 Evaluation and recommendations

Product findings: none. No test was bent to pass; no suspected production bug.

Recommendations:
1. Confirm the DB-backed edits in t3-nightly (Linux). They are small, but this host could not execute them.
2. `heartbeat-comment-wake-batching`: add an `afterEach` that drains in-flight runs (`drainHeartbeatRunsToQuiescence`) and extract a gateway-agent seed helper. This is the largest file in the shard (2184 lines) and its ten gateway tests dominate nightly time.
3. Replace the hand-built Drizzle chain in `heartbeat-ledger-billing-code` with a DB-backed test, or at least keep the comment that ties it to `resolveLedgerScopeForRun`.
4. Coverage gaps worth adding: `agent_runtime_profile_disabled` in `resolveModelProfileApplication`; a service-level (not inline SQL) test for the queued-to-running race in lock-release-on-reassignment; a throttle-window boundary test in rewake-throttle.
5. Embedded Postgres start on Windows exceeds the 20 s file-local `beforeAll` limit; consider a shared helper-level default timeout so developers on Windows can run these suites.
6. `heartbeat.ts`: `deriveRepoNameFromRepoUrl` treats Windows absolute paths as URLs. This is not a defect for the Linux-only runtime but could produce confusing managed directory names for local-path repos on Windows.

## 8 Summary of activities

Files rewritten (one-line reasons):
- `heartbeat-cost-accounting.test.ts`: added three boundary cases (zero cost, zero usage, negative cost).
- `heartbeat-dependency-scheduling.test.ts`: removed dead `ensureIssueRelationsTable` DDL stand-in and its call.
- `heartbeat-local-environment.test.ts`: remove temp directory created by the env-injection test.
- `heartbeat-managed-clone-credentials.test.ts`: two tests made platform-independent and non-vacuous.
- `heartbeat-pending-cleanup-sweep.test.ts`: use `SWEEP_PAGE_SIZE` instead of magic numbers.
- `heartbeat-plugin-environment.test.ts`: correct DB teardown, reset instance default environment per test, null-safe `afterAll`.

Deletions: none (no tests removed).

Commands run and outcomes:
- `pnpm --filter @paperclipai/plugin-sdk ensure-build-deps`: ok.
- `npx vitest run server/src/__tests__/heartbeat-list.test.ts server/src/__tests__/heartbeat-cost-accounting.test.ts`: cost-accounting passed (8 at the time); heartbeat-list failed in `beforeAll` (ENV, embedded Postgres 20 s hook timeout).
- `npx vitest run server/src/__tests__/heartbeat-plugin-environment.test.ts --hookTimeout=180000`: failed in `beforeAll` (ENV; file-local 20 s hook timeout overrides the flag).
- `npx vitest run` on context-summary, model-profile, ledger-billing-code, managed-clone-credentials: 29 pass, 1 fail (ENV Windows path derivation, fixed by the rewrite).
- `npx vitest run server/src/__tests__/heartbeat-managed-clone-credentials.test.ts` after rewrite: 8 pass.
- `npx vitest run server/src/__tests__/heartbeat-cost-accounting.test.ts` after edit: 10 pass.

## 9 Approvals

- Prepared by: ______________________  Date: __________
- Reviewed by: ______________________  Date: __________
- Approved by: ______________________  Date: __________
