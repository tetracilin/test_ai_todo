# Test Summary Report: shard server-19 (IEEE 829)

## 1 Report identifier and scope

| Item | Value |
|---|---|
| Report id | server-19 |
| Project | server (vitest project `@paperclipai/server`) |
| Suite | t3-nightly "slow-tests" full vitest run |
| Files | 18 (all `server/src/__tests__/issue-*.test.ts`, `issue-execution-policy` through `issue-stale-execution-lock-routes`) |
| Test cases | 226 after edits (224 before). `it.each` expansions: scheduled-retry 2, stale-execution-lock 4 |
| Date | see git |
| Rubric | ISO/IEC/IEEE 29119 / ISTQB, codes V1-V9 |

## 2 Summary

Every file was read in full and checked against the production module it exercises on current `develop` (the fork): `services/issue-execution-policy`, `issue-goal-fallback`, `issue-liveness`, `issue-rewake-throttle`, `issue-recovery-actions`, `issue-references`, `issue-review-policy`, `recovery/service`, `heartbeat` (monitor, scheduled retry) and `routes/issues.ts`.

Headline: the shard is in good shape. All subjects still exist, every asserted error code, outcome and route path was found in current source, and no test asserts upstream-only behaviour or an upstream default (V1 clean). No tautologies were found. Four files were edited; none deleted.

| Verdict | Files |
|---|---|
| VALID | 8 |
| VALID_WITH_NOTES | 6 |
| REWRITTEN | 4 |
| OBSOLETE_REMOVED | 0 |
| NEEDS_DECISION | 0 |

## 3 Variances (what could not be verified)

- The host is Windows. Embedded Postgres does not start inside the 20-30 s `beforeAll` budget on a cold host (observed on `issue-identifier-routes` and `issue-review-policy`: `beforeAll` timeout, classified ENV). 12 of 18 files are embedded-PG suites, so their DB-backed tests could not be executed here. For those files the conclusions come from static reading against source and schema (for example migration `0060_orange_annihilus.sql` and the `agent_wakeup_requests_review_path_recovery_idempotency_uq` constraint name were confirmed to exist).
- Two edits land in embedded-PG-only files (`issue-references-service`, `issue-review-attention`) and are unexecuted. Both are mechanical: a dead DDL helper was removed, and a vacuous `resolves.toBeDefined()` was replaced with a row-state assertion using `eq` and existing columns. The first t3-nightly run should confirm them.
- The first test of `issue-feedback-routes` timed out at 20 s on this host in the unmodified file too (reproduced with a copy of `HEAD`): cold transform of `routes/issues.ts` takes about 28 s. Classified ENV, and mitigated with a warm-up `beforeAll` (see section 8).
- t3-ci does not run server suites, so nothing here went through CI.

## 4 Comprehensive assessment (cross-cutting, by rubric code)

| Code | Count | Finding |
|---|---|---|
| V1 Validity | 0 defects, 1 note | Test titles carry upstream incident ids ("PAP-1703-style", "PAP-2239-style", "#7893", "Fix B path") as narrative only; the behaviour asserted is current. |
| V2 Meaningful assertions | 3 | `expect([200,201]).toContain(status)` on a route that always returns 201 (feedback, fixed); `resolves.toBeDefined()` on a DB insert (review-attention, fixed); `interactions-read-only-contract` asserts on source text (`not.toContain("logActivity")`) and would pass if a helper were renamed. |
| V3 Determinism | 4 | Assignee-filter coalescing and storm tests rely on a 50 ms sleep to hold an in-flight window while 5-10 concurrent requests arrive; monitor-scheduler quiet-window polling (time-bounded, acceptable); `Date.now()+60_000` for a "future" monitor; `["todo","in_progress"]` accepted for a racing recovery issue. All bounded; flake risk only under heavy load. |
| V4 Isolation | 1 | feedback-routes paid a one-off cold import inside the first test's timeout (fixed). Otherwise afterEach cleanup, response-cache clearing (`__clearIssueListResponseCacheForTests`) and FK-ordered deletes are sound. |
| V5 Mock fidelity | 3 | feedback-routes hand-builds the whole `../services/index.js` mock rather than `importOriginal`, so it will rot when `issueRoutes` consumes a new service export. The first recovery-actions test hand-builds a fake drizzle query chain (justified: it reproduces a read/update race a real DB cannot). references-service re-declared the `issue_reference_mentions` DDL by hand although the migration creates it (removed). |
| V6 Clarity | 3 | liveness "does not flag healthy in_review" loops a case table in one `it` (labelled via `expect(..., name)`); the assignee-filter file also hosts a service-level handoff test unrelated to its name; review-attention's third test checks a DB constraint rather than the service. |
| V7 Coverage | 4 gaps | feedback votes lacked a no-sharing and a flush-failure case (added); review-policy lacks a `not_creator` admit for a user actor; monitor-scheduler lacks a not-yet-due `tickTimers` case; scheduled-retry has no unauthenticated/forbidden case for the read path. |
| V8 Portability | 0 | monitor-scheduler spawns `process.execPath -e ""` (portable). No POSIX-only paths or signals found. |
| V9 Maintainability | 3 | Large repeated agent-seed blocks (recovery-actions, assignee-filter); unused `companyId` destructures in a few recovery tests; dead DDL helper (removed). |

## 5 Summary of results

| File | Tests | Verdict | Defect codes | Action taken |
|---|---|---|---|---|
| server/src/__tests__/issue-execution-policy.test.ts | 70 | VALID | - | None. Pure unit; run: 70 pass. |
| server/src/__tests__/issue-feedback-routes.test.ts | 6 (was 4) | REWRITTEN | V2, V4, V5, V7 | Strict 201 + body assertion; warm-up import; 2 negative-path tests added. Run: 6 pass. |
| server/src/__tests__/issue-goal-fallback.test.ts | 8 | VALID | - | None. Run: 8 pass. |
| server/src/__tests__/issue-identifier-routes.test.ts | 1 | VALID | - | None (embedded PG, not executable here, ENV). |
| server/src/__tests__/issue-interactions-read-only-contract.test.ts | 1 | VALID_WITH_NOTES | V2, V5 | Source-text contract test; behavioural replacement recommended. Run: pass. |
| server/src/__tests__/issue-list-assignee-filter-routes.test.ts | 15 | VALID_WITH_NOTES | V3, V6, V9 | None; timing-window and misplaced-test notes. Embedded PG, not run. |
| server/src/__tests__/issue-list-updatedsince-filter-routes.test.ts | 3 | VALID | - | None (embedded PG, not run). |
| server/src/__tests__/issue-liveness.test.ts | 17 | VALID_WITH_NOTES | V6 | None; table loop inside one `it`. Run: 17 pass. |
| server/src/__tests__/issue-monitor-scheduler.test.ts | 7 | VALID_WITH_NOTES | V3, V7 | None; bounded polling and loose status set. Embedded PG, not run. |
| server/src/__tests__/issue-onboarding-first-task-routes.test.ts | 3 | VALID | - | None. Adapter is stubbed and runs are drained in afterEach. Embedded PG, not run. |
| server/src/__tests__/issue-recovery-actions.test.ts | 40 | VALID_WITH_NOTES | V5, V9 | None; fake query-chain test and unused destructures. 39 tests need embedded PG, not run. |
| server/src/__tests__/issue-references-service.test.ts | 2 | REWRITTEN | V5, V9 | Removed redundant hand-written DDL and the `sql` import. Unexecuted (ENV). |
| server/src/__tests__/issue-remove-cascade.test.ts | 3 | VALID | - | None (embedded PG, not run). |
| server/src/__tests__/issue-review-attention.test.ts | 3 | REWRITTEN | V2, V6 | Vacuous `resolves.toBeDefined()` replaced with persisted-row assertion. Unexecuted (ENV). |
| server/src/__tests__/issue-review-policy.test.ts | 6 | REWRITTEN | V9 | DB-free "anyone" policy test moved out of the embedded-PG describe so it runs on every host. Run: moved test passes; PG tests ENV-timeout. |
| server/src/__tests__/issue-rewake-throttle.test.ts | 14 | VALID | - | None. Run: 14 pass. |
| server/src/__tests__/issue-scheduled-retry-routes.test.ts | 16 (14 + each x2) | VALID_WITH_NOTES | V7 | None. All errorCodes and outcomes verified in `services/heartbeat.ts`. Embedded PG, not run. |
| server/src/__tests__/issue-stale-execution-lock-routes.test.ts | 11 (7 + each x4) | VALID | - | None (embedded PG, not run). |

## 6 Per-test detail (non-clean tests)

| File | Test | Code | Finding | Action |
|---|---|---|---|---|
| issue-feedback-routes | flushes a newly shared feedback trace immediately after saving the vote | V2, V4 | Accepted 200 or 201 though the route returns 201 and asserted nothing about the body; first-test import exceeded 20 s | Asserts 201 + vote body; warm-up `beforeAll` (120 s) |
| issue-feedback-routes | (new) does not flush a feedback trace when sharing is not enabled for the vote | V7 | Coverage gap | Added |
| issue-feedback-routes | (new) still saves the vote when the immediate trace flush fails | V7 | Coverage gap (route swallows flush errors) | Added |
| issue-interactions-read-only-contract | does not perform expiry sweeps or activity writes | V2, V5 | Text match on handler source | None; see section 7 |
| issue-list-assignee-filter-routes | coalesces simultaneous identical compact issue-list requests into one service computation | V3 | 50 ms sleep defines the coalescing window | None; note |
| issue-list-assignee-filter-routes | logs request_storm_detected for identical in-flight compact issue-list fanout without query values | V3 | Same 50 ms window | None; note |
| issue-list-assignee-filter-routes | logs resolved when a valid-path skip closes a stale required handoff | V6, V9 | Service test inside a route-filter file; passes `issueIdentifier "PAP-1"` unrelated to the seeded identifier | None; recommend moving |
| issue-liveness | does not flag healthy in_review issues with an explicit action path | V6 | 8 cases looped in one `it` | None; recommend `it.each` |
| issue-monitor-scheduler | clears timed-out monitors and creates a visible recovery issue when requested | V2, V3 | `["todo","in_progress"]` membership because a wake races the assertion | None; note |
| issue-monitor-scheduler | wakes a cross-agent review participant for provider quota monitors | V3 | Depends on `waitForHeartbeatIdle` (3 s bound) | None |
| issue-recovery-actions | does not reactivate an action resolved between the active read and update | V5 | Hand-built query chain couples to builder call order | None; justified |
| issue-recovery-actions | several quota/stranded tests | V9 | Unused `companyId` destructures | None |
| issue-references-service | both tests | V5, V9 | Redundant `ensureIssueReferenceMentionsTable` DDL | Removed |
| issue-review-attention | does not let a transiently skipped recovery consume its fingerprint | V2 | `resolves.toBeDefined()` cannot meaningfully fail | Now asserts both rows persisted (`queued`, `skipped`) |
| issue-review-policy | does no database work for the default anyone policy | V9 | Needlessly gated behind embedded PG | Moved to a plain describe |
| issue-stale-execution-lock-routes | preserves $status when releasing a non-in_progress issue | V9 | `new Date()` evaluated at module load in the table | None; harmless |

## 7 Evaluation and recommendations

Product findings: none. No suspected production bug and no fork-policy mismatch was found. Hermes/selectable-adapter defaults, teable, teams-catalog and tailscale areas are not touched by this shard.

Recommendations (not done, to keep diffs minimal):
1. Replace the source-text contract in `issue-interactions-read-only-contract` with a route test using the mock-services harness, asserting that `logActivity` and the expiry methods are not called on GET.
2. In `issue-feedback-routes`, build the services mock from `importOriginal` (override only the used factories) to remove the rot risk (V5).
3. Make the coalescing and storm tests deterministic: gate `onComputeStart` on a deferred released once N requests are observed in flight, instead of a 50 ms sleep.
4. Convert the healthy in_review case table in `issue-liveness` to `it.each`.
5. Move the handoff-resolution test out of `issue-list-assignee-filter-routes`.
6. Coverage gaps: `tickTimers` with a not-yet-due monitor; `not_creator` admit for a user actor.
7. Confirm the two unexecuted PG edits in the next t3-nightly run.

## 8 Summary of activities

Files rewritten:
- `issue-feedback-routes.test.ts`: strict 201 and body assertion; `beforeAll` warm-up import (120 s) so the cold transform no longer lands in test 1's timeout; two new negative-path tests.
- `issue-references-service.test.ts`: dropped the dead hand-written DDL helper (migration 0060 is applied by the harness).
- `issue-review-attention.test.ts`: vacuous assertion replaced by a row-state assertion.
- `issue-review-policy.test.ts`: DB-free test moved to its own describe.

Deletions: none.

Commands run (from repo root) and outcomes:
- `npx vitest run server/src/__tests__/issue-feedback-routes.test.ts`: before warm-up 1 failed (20 s timeout, ENV, reproduced on an unmodified copy of HEAD); after, 6 passed.
- `npx vitest run server/src/__tests__/issue-identifier-routes.test.ts`: embedded-PG `beforeAll` timeout (ENV); test skipped.
- `npx vitest run server/src/__tests__/issue-review-policy.test.ts`: 1 passed (moved test), 5 skipped by the PG `beforeAll` ENV timeout.
- `npx vitest run` on execution-policy, goal-fallback, liveness, rewake-throttle and interactions-read-only-contract: 5 files, 110 tests passed.
- Not run: the remaining embedded-PG files (ENV).

## 9 Approvals

Prepared by: ______________________  Date: __________

Reviewed by: ______________________  Date: __________

Approved by: ______________________  Date: __________
