# Test Summary Report: shard server-10 (IEEE 829)

## 1 Report identifier and scope

- Report id: server-10
- Project: `@paperclipai/server` (vitest project `server`)
- Files: 6, test cases: 156 (`it` count; no `it.each` expansions in this shard)
- Date: see git
- Rubric: V1 validity, V2 meaningful assertions, V3 determinism, V4 isolation, V5 mock fidelity, V6 clarity, V7 coverage balance, V8 portability, V9 maintainability

## 2 Summary

All six files were read in full and checked against the production sources they exercise (`middleware/error-handler.ts`, `services/environments.ts`, `services/environment-runtime.ts`, `services/evidence-provenance.ts`, `routes/issues.ts`, plugin-sdk testing harness). No file tests a removed or upstream-only subject; all subjects exist in this fork.

Verdicts: VALID 1, VALID_WITH_NOTES 2, REWRITTEN 3, OBSOLETE_REMOVED 0, NEEDS_DECISION 0.

Headline defect: `environment-selection-route-guards.test.ts` "accepts sandbox environments on issue update" asserted only `status != 422` and so passed on an HTTP 500 caused by a stale hand-mock (`routineService` returned `{}` and lacked `syncRunStatusForIssue`). Fixed by completing the mock and asserting the exact success status on all five accept-path tests.

## 3 Variances

- ENV: embedded PostgreSQL does not start within the 30 s `beforeAll` hook on this Windows host. Every DB-backed test in `environment-service` (39), `environment-runtime` (70 of 72) and `evidence-provenance` (15 of 20) therefore could not be executed here (reported as skipped after a suite hook timeout). These were assessed by static review against the production source only. The pure (non-DB) cases in those files ran and passed (2 + 5).
- The edits to `environment-runtime.test.ts` (skipIf, comment, timeouts) are on DB-backed tests and are unverified dynamically; they were verified for syntax/collection only (the file loads and collects 72 tests). They should be confirmed in the nightly slow-tests job (Linux).
- `acquires and releases an SSH run lease` needs the SSH lab fixture (Docker/sshd); not available here.
- Typecheck of test files was not run.

## 4 Comprehensive assessment (cross-cutting, by rubric code)

| Code | Count | Notes |
|---|---|---|
| V1 | 0 | No stale upstream behaviour found. Sandbox provider names (`fake`, `fake-plugin`, `daytona`, `kubernetes`) match current `services/environments.ts`/runtime. |
| V2 | 3 | Route guards: five `not.toBe(422)` assertions (fixed); evidence-provenance `Function.length` assertion (fixed); SSH test silently `return`s when unsupported (fixed: now a reported skip). |
| V3 | 3 | Plugin-worker readiness tests used 25 ms / 200 ms deadlines against a real DB query plus a 1 ms poll (Windows timers tick about 15 ms) so the happy path could flake (fixed: 10 s deadline, failure-only cost). `keeps the orphan when an environment delete and the orphan record race` runs a real race and branches on the winner (both outcomes asserted; accepted, noted). Deadline-exhausted test keeps 25 ms (needs a short deadline) and asserts `>= 2` polls; acceptable. |
| V4 | 0 | env var `SANDBOX_ORPHAN_CLEANUP_SPOOL_DIR` and `PAPERCLIP_CLOUD_TENANT_SERVER_TOKEN` are restored; spies restored in `finally`; afterEach truncates tables. Two tests restore environment config at the end of the body rather than in `finally` (afterEach cleanup covers it). |
| V5 | 2 | Route guards hand-build the whole `services/index.js` barrel (rot risk, caused the hidden 500); noted, not converted (importOriginal would pull the DB-heavy barrel). Runtime tests cast partial `PluginWorkerManager` objects with `as unknown as`, and a few mocks embed `expect` inside the mock callback (could be swallowed by the SUT's error handling). Noted. |
| V6 | 1 | `test_release_run_leases_continues_after_first_release_fails` uses snake_case; left (rename for taste not allowed). |
| V7 | 3 | error-handler: no case for 4xx HttpError passthrough, skill-policy/workspace-repair reason fields, structured connection-error codes, or the non-Zod 500 raw-message hiding for non-cloud actors beyond the first case. environment-test-harness: only happy plus injected-failure paths. route guards: no cross-company environment rejection case. |
| V8 | 1 | Hard-coded POSIX paths (`/workspace`, `/srv/paperclip`, `/tmp/anchor`) are opaque strings passed to mocks or the DB, not touched on disk: portable. SSH fixture test is POSIX/Docker-only (now an explicit skip). |
| V9 | 3 | `environment-runtime.test.ts`: the plugin-row insert (about 20 copies of an identical manifest) and the foreign-company binding seed (about 12 copies) should be helpers; the SSH test carried an empty `finally`. Not refactored (6.7 kLOC file with unverifiable DB runtime here; high regression risk). |

## 5 Summary of results

| Path | Tests | Verdict | Defect codes | Action taken |
|---|---|---|---|---|
| server/src/__tests__/environment-runtime.test.ts | 72 | REWRITTEN | V2, V3, V5, V9 | SSH test turned into `it.skipIf`, empty `finally` documented; readiness-wait timeouts raised to 10 s. Not dynamically verified (ENV). |
| server/src/__tests__/environment-selection-route-guards.test.ts | 7 | REWRITTEN | V2, V5, V7 | Completed `routineService` mock; replaced five `not.toBe(422)` with exact 201/200; passes 7/7. |
| server/src/__tests__/environment-service.test.ts | 39 | VALID_WITH_NOTES | V3 (one race test, both outcomes asserted) | None. Not executed (ENV: embedded PG). |
| server/src/__tests__/environment-test-harness.test.ts | 13 | VALID | none (V7 note: harness negative paths limited) | None. Ran: pass. |
| server/src/__tests__/error-handler.test.ts | 5 | VALID_WITH_NOTES | V7 | None. Ran: pass. |
| server/src/__tests__/evidence-provenance.test.ts | 20 | REWRITTEN | V2 | Replaced `Function.length` assertion with a behavioural check. 5/5 pure tests pass; 15 DB tests not executed (ENV). |

## 6 Per-test detail (tests that are not clean)

| File | Test | Code | Finding | Action |
|---|---|---|---|---|
| environment-selection-route-guards | accepts sandbox environments on project create | V2 | `not.toBe(422)` would pass on 500/404 | Now asserts 201 |
| environment-selection-route-guards | accepts sandbox environments on project update | V2 | same | Now asserts 200 |
| environment-selection-route-guards | accepts sandbox environments on issue create | V2 | same | Now asserts 201 |
| environment-selection-route-guards | accepts plugin-backed sandbox environments on issue create | V2 | same | Now asserts 201 |
| environment-selection-route-guards | accepts sandbox environments on issue update | V2, V5 | Returned 500 (`routinesSvc.syncRunStatusForIssue is not a function`) while passing | Mock completed; asserts 200 |
| environment-runtime | acquires and releases an SSH run lease through the runtime seam | V2, V9 | Early `return` counted as pass when fixture unsupported; empty `finally` | `it.skipIf(!sshFixtureSupport.supported)`; comment in `finally` |
| environment-runtime | waits briefly for a ready sandbox provider plugin worker to come online | V3 | 25 ms deadline with DB query per poll; flaky on slow or Windows hosts | Deadline 10 s |
| environment-runtime | keeps polling across a longer worker restart window... | V3 | 200 ms deadline for 8 polls | Deadline 10 s |
| environment-runtime | uses plugin-backed sandbox config for execute and release | V5 | `expect` calls inside worker mock may be swallowed by SUT | Noted only |
| environment-runtime | test_release_run_leases_continues_after_first_release_fails | V6 | snake_case name | Noted only |
| environment-runtime | (about 20 plugin-backed tests) | V9 | Copy-pasted plugin and managed-binding seeds | Noted only |
| environment-service | keeps the orphan when an environment delete and the orphan record race | V3 | Nondeterministic interleaving, branch on winner | Accepted: both safe outcomes asserted, orphan invariant fixed |
| evidence-provenance | has no parameter a `system` tally could be passed through | V2, V6 | `fn.length === 2` is brittle and not behavioural | Replaced with extra-argument-ignored equality check |
| error-handler | (suite) | V7 | No 4xx, skill-policy, workspace-repair, connection-error code cases | Gap reported |

## 7 Evaluation and recommendations

- Product findings: none. No production bug suspected. The 500 on `PATCH /api/issues/:id` in the route-guard test was purely a test-mock omission (the route does call `routinesSvc.syncRunStatusForIssue`).
- Recommendation: add a thin shared test helper for the plugin sandbox-provider plugin row and for the foreign-company managed binding in `environment-runtime.test.ts` (V9), after validating on Linux/CI.
- Recommendation: route-guard suite should build service mocks with a typed factory (or `importOriginal` for `routineService`) so future route additions surface as type errors instead of silent 500s. Server `logger` did not print the swallowed error, which hid the defect; asserting exact status is the guard.
- Coverage gaps: error-handler 4xx/structured-code branches; route guards lack a negative case for cross-company environment ids; the harness lacks failure tests for `realizeWorkspace` and `destroyLease`.
- Infra: embedded Postgres startup exceeds 30 s on this Windows host; CI should keep these suites on Linux.

## 8 Summary of activities

Files rewritten:
- `server/src/__tests__/environment-selection-route-guards.test.ts`: fix hidden 500 via complete `routineService` mock; exact status assertions.
- `server/src/__tests__/environment-runtime.test.ts`: reported skip for SSH fixture, bounded-wait timeouts made non-flaky.
- `server/src/__tests__/evidence-provenance.test.ts`: behavioural replacement for brittle `Function.length` assertion.

Deletions: none.

Commands run (repo root):
- `npx vitest run server/src/__tests__/environment-selection-route-guards.test.ts`: 7 passed (after fix; before fix the update case returned 500 under the old assertion).
- `npx vitest run server/src/__tests__/environment-service.test.ts`: ENV failure, embedded PG `beforeAll` timeout (39 skipped).
- `npx vitest run server/src/__tests__/evidence-provenance.test.ts`: 5 passed, 15 skipped (ENV hook timeout).
- `npx vitest run server/src/__tests__/environment-runtime.test.ts`: 2 passed, 70 skipped (ENV hook timeout).
- `npx vitest run server/src/__tests__/environment-test-harness.test.ts server/src/__tests__/error-handler.test.ts`: 18 passed.

## 9 Approvals

Prepared by: ____________________  Date: ________

Reviewed by: ____________________  Date: ________

Approved by: ____________________  Date: ________
