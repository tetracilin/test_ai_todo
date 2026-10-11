# Test Summary Report - shard server-20 (IEEE 829 structure)

## 1 Report identifier and scope

| Item | Value |
|---|---|
| Report id | server-20 |
| Project | server (vitest project `@paperclipai/server`) |
| Subject | Issue thread interactions, stalled-review decisions, subtree diagnostics/progress, issue tree control, issue telemetry routes |
| Files in shard | 10 |
| Test cases | 172 (routes 70 incl. 5 `it.each` tables expanded; interactions service 56 incl. 2 tables; telemetry 8; stalled-review 10; tree-control routes 9; tree-control service 6; subtask progress 5; subtree diagnostics 5; issue telemetry routes 2; tree-control unit 1) |
| Date | see git |
| Rubric | ISO/IEC/IEEE 29119 / ISTQB, codes V1-V9 |

## 2 Summary

All 10 files were read in full and checked against the production modules they exercise (`routes/issues.ts`, `routes/issue-tree-control.ts`, `services/issue-thread-interactions.ts`, `services/issue-tree-control.ts`, `services/stalled-review-decisions.ts`, `services/cross-issue-influence-limit.ts`, shared telemetry events). Every subject still exists in the fork and the assertions match current behaviour; none relies on upstream-only behaviour or stale adapter defaults.

Verdicts: VALID 2, VALID_WITH_NOTES 5, REWRITTEN 3, OBSOLETE_REMOVED 0, NEEDS_DECISION 0.

Three files were edited (test-only changes, no assertion weakened, no test removed). One product finding is recorded in section 7 (calendar-date enforcement switch in production code).

## 3 Variances (what could not be verified)

Host is Windows 11 and shares CPU with other audit agents.

* Embedded Postgres suites (stalled-review, subtask-progress, subtree-diagnostics, interactions-service, interactions-telemetry, tree-control-service): `startEmbeddedPostgresTestDatabase` exceeds the 20s `beforeAll` hook timeout on this host, so every test is reported skipped (for example interactions-service: "Hook timed out in 20000ms", 56 skipped). Classified **ENV**, not REAL. Their validity was established by reading and by comparing against production code, and they are expected to run in the Linux t3-nightly job. The one edit made in this group (interactions-service, section 8) is therefore not dynamically verified; it is a mechanical `.where(eq(documents.id, documentId))` using symbols already imported and used in the same test.
* Mock-only suites ran: tree-control-unit 1/1, tree-control-routes 9/9, thread-interaction-routes 70/70, issue-telemetry-routes 2/2 (after the edits below). Before the edits, the first one or two tests of `issue-thread-interaction-routes` and both tests of `issue-telemetry-routes` timed out (10s/20s) because the cold transform of the huge `routes/issues.ts` module was counted against the test timeout (ENV-triggered, but a real V3 design weakness, fixed).

## 4 Comprehensive assessment (cross-cutting, by rubric code)

| Code | Count | Finding |
|---|---|---|
| V1 Validity | 0 defects | All subjects exist and behaviour matches the fork. Ticket ids in comments/names (PAP-436, LOOA-629, PAPA-440) are historical upstream identifiers, harmless. |
| V2 Meaningful assertions | 0 | Assertions are specific (status codes, error codes, persisted rows, absence of leaked ids/payloads). |
| V3 Determinism | 4 | (a) routes: cap-exceeded cases depend on wall clock being after `CROSS_ISSUE_INFLUENCE_ENFORCE_AT` (2026-08-11); would have failed before that date and breaks if the date moves: fixed by pinning the clock. (b) routes and telemetry-routes: cold dynamic import counted against test timeout: fixed with a `beforeAll` warm-up. (c) service lock test uses a 25 ms sleep as a negative probe (accepted, noted). (d) a few `Date.now() + 1_000` comment timestamps (benign). |
| V4 Isolation | 2 | routes: shared `mockRunAttribution` fixture was mutated by `createApp` and one test and never restored: fixed. service: two `db.update(documents).set(...)` calls without `.where` updated every document row: fixed. |
| V5 Mock fidelity | 3 | Hand-built `services/index.js` factories in routes, telemetry-routes and tree-control-routes will rot when exports are added (acceptable because the SUT is the route layer; not changed). The routes DB mock lacks `innerJoin`, so 9+ tests log swallowed `TypeError: ...innerJoin is not a function`; production swallows it so assertions still hold, but the mock is not faithful. Noted, not rewritten (needs a larger harness change). |
| V6 Clarity | 3 | Several tests bundle multiple scenarios (stalled-review first test also covers self-approval 200; "persists addressees..." covers five behaviours; tree-control-service ancestry test covers checkout, forged run and legacy full-pause). Names understate scope. Not split, to avoid churn. |
| V7 Coverage balance | 0 defects | Negative paths are well covered (403/404/409/422/429, cross-company, stale targets, caps). Gaps listed in section 7. |
| V8 Portability | 0 | No POSIX assumptions. |
| V9 Maintainability | 2 | Heavy repeated company/goal/issue/agent seeding blocks in the interactions service file (about 15 copies); no shared helper for the second-revision document update. Noted only. |

## 5 Summary of results

| Path | Tests | Verdict | Defect codes | Action taken |
|---|---|---|---|---|
| server/src/__tests__/issue-stalled-review-decision-routes.test.ts | 10 | VALID_WITH_NOTES | V6 | None. Embedded PG; ENV skip on Windows. First test mixes access denial with self-approval success. |
| server/src/__tests__/issue-subtask-progress-routes.test.ts | 5 | VALID | - | None. Embedded PG; ENV skip. Uses shared route-test-harness. |
| server/src/__tests__/issue-subtree-diagnostics-routes.test.ts | 5 | VALID_WITH_NOTES | V3 (benign `Date.now()` offsets), V7 | None. Embedded PG; ENV skip. Leak assertions (payload/error/details absent) are strong. |
| server/src/__tests__/issue-telemetry-routes.test.ts | 2 | REWRITTEN | V3, V5 | Added `beforeAll` warm-up of the routes import. Now 2/2 pass. Hand-built service mocks noted. |
| server/src/__tests__/issue-thread-interaction-routes.test.ts | 70 | REWRITTEN | V3, V4, V5 | Warm-up `beforeAll`, restore `mockRunAttribution` each test, pin clock for the cap-exceeded cases. 70/70 pass. |
| server/src/__tests__/issue-thread-interactions-service.test.ts | 56 | REWRITTEN | V4, V6, V9, V3 (25 ms probe) | Scoped two unscoped `documents` updates by id. Not run to green (ENV hook timeout). |
| server/src/__tests__/issue-thread-interactions-telemetry.test.ts | 8 | VALID_WITH_NOTES | V9 | None. Embedded PG; ENV skip. Strong privacy assertions (no raw ids, no free text). |
| server/src/__tests__/issue-tree-control-routes.test.ts | 9 | VALID_WITH_NOTES | V5 | None. 9/9 pass. Service-layer mocks are acceptable for a route test. |
| server/src/__tests__/issue-tree-control-service-unit.test.ts | 1 | VALID | - | None. 1/1 pass. |
| server/src/__tests__/issue-tree-control-service.test.ts | 6 | VALID_WITH_NOTES | V6 | None. Embedded PG; ENV skip. Ancestry test is long but its three phases are all necessary. |

## 6 Per-test detail (tests that are not clean)

| File | Test | Code | Finding | Action |
|---|---|---|---|---|
| issue-thread-interaction-routes | "creates board-authored interactions" and "does not run historical-comment catch-up..." | V3 | Timed out on cold import of routes module (10s/20s). | Warm-up `beforeAll`. |
| issue-thread-interaction-routes | "fails a capped run closed on cross-issue $route..." (4 cases) | V3 | Depended on wall clock being after the 2026-08-11 enforcement date. | Pinned Date with `vi.useFakeTimers({ toFake: ["Date"] })` at the enforcement instant; real timers restored in `afterEach`. |
| issue-thread-interaction-routes | "rejects an invalid run attribution before resolving or waking" | V4 | Set shared `mockRunAttribution.value = null` and never restored. | Restored in `beforeEach`. |
| issue-thread-interaction-routes | many agent-path tests | V5 | Logged swallowed `db.select(...).from(...).innerJoin is not a function`; DB mock is incomplete. | Noted. |
| issue-telemetry-routes | both tests | V3 | Cold import of routes inside test body timed out. | Warm-up `beforeAll`. |
| issue-thread-interactions-service | "expires request confirmations when the watched issue document revision changes" | V4 | `db.update(documents).set(...)` had no `.where`. | Added `.where(eq(documents.id, documentId))`. |
| issue-thread-interactions-service | "preserves resolved request_item_verdicts items when the watched issue document revision changes" | V4 | Same unscoped update. | Same fix. |
| issue-thread-interactions-service | "revalidates review policy under the issue lock before interaction accept/reject" | V3 | 25 ms sleep then `verdictSettled === false`. A slow host could pass vacuously; the later `rejects` assertion still guards correctness. | Noted. |
| issue-thread-interactions-service | "persists addressees without allowing them to bypass human-only governance" | V6 | Five behaviours in one test. | Noted. |
| issue-stalled-review-decision-routes | "denies agents, viewers, and cross-company users..." | V6 | Name omits the final self-approval-succeeds assertion. | Noted. |
| issue-tree-control-service | "walks pause-hold ancestry beyond 15 levels..." | V6 | Checkout deny, forged run, legit run and legacy full-pause in one test. | Noted. |

## 7 Evaluation and recommendations

* Quality is high overall: real embedded Postgres for service behaviour, mock-only route tests for authorisation matrices, explicit negative and cross-tenant cases, and leak assertions.
* Product finding (not a test bug): `services/cross-issue-influence-limit.ts` switches from `log_only` to `enforce` based on a hard-coded calendar date (`CROSS_ISSUE_INFLUENCE_ENFORCE_AT = 2026-08-11`). That is a rollout flag encoded as a date; if the fork wants a deterministic policy it should become a setting. The tests now pin the clock so they do not care.
* Mock fidelity: the routes harness DB mock should gain `innerJoin` (or the route should not swallow the error silently) so logged TypeErrors stop hiding real query-shape regressions.
* Coverage gaps (not added, would need production-aware fixtures): no route-level test for `/issues/:id/children` validation failures (negative progress, sortOrder); subtask progress is not tested for cross-company access; `subtasks/progress` rounding is covered for one input only; tree-control routes have no test for `releaseHold` success path or hold-not-found 404.
* Recommend a shared seeding helper for the interactions-service file (about 15 near-identical company/goal/issue blocks).

## 8 Summary of activities

Files rewritten:

* `server/src/__tests__/issue-thread-interaction-routes.test.ts`: warm-up `beforeAll`, run-attribution fixture reset, deterministic clock for the enforcement-cap cases.
* `server/src/__tests__/issue-telemetry-routes.test.ts`: warm-up `beforeAll` so cold import is not counted against test timeouts.
* `server/src/__tests__/issue-thread-interactions-service.test.ts`: scoped two unfiltered `documents` updates to the seeded document.

Deletions: none.

Commands run (repo root, one vitest process at a time):

* `pnpm --filter @paperclipai/plugin-sdk ensure-build-deps`: ok.
* `npx vitest run` on tree-control-service-unit (1 pass), telemetry-routes (before: 2 timeouts ENV/V3; after: 2 pass), thread-interaction-routes (before: 68 pass, 2 timeouts; after: 70 pass), tree-control-routes (9 pass).
* `npx vitest run` on subtask-progress, subtree-diagnostics, thread-interactions-service: embedded Postgres hook timeout, all tests skipped (ENV).
* Not run (not edited, embedded Postgres): stalled-review, interactions-telemetry, tree-control-service.

## 9 Approvals

Prepared by: ______________________  Date: __________

Reviewed by: ______________________  Date: __________

Approved by: ______________________  Date: __________
