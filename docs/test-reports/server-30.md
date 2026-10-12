# Test Summary Report: shard server-30 (IEEE 829)

## 1 Report identifier and scope
- Identifier: server-30. Project: server (vitest). Date: see git.
- Files: 4. Test cases: 36 (10 + 9 + 9 + 8, no each/table expansion).
- Subject: workspace runtime leases, project/execution-workspace runtime-service authorization (helper and routes), runtime start terminality (readiness probe and port allocation).

## 2 Summary
Every file was read in full and checked against the production sources (services/workspace-runtime-leases.ts, services/workspace-runtime.ts, routes/projects.ts, routes/execution-workspaces.ts, routes/workspace-runtime-service-authz.ts). All subjects still exist and assertions match current fork behaviour; none rely on upstream-only behaviour.
Verdicts: VALID 1, VALID_WITH_NOTES 2, REWRITTEN 1, OBSOLETE_REMOVED 0, NEEDS_DECISION 0.

## 3 Variances
- workspace-runtime-leases.test.ts and workspace-runtime-service-authz.test.ts need embedded Postgres. On this Windows host the `beforeAll` hook timed out (30 s and 20 s, `Hook timed out`) and every test was skipped. Classified ENV (embedded-PG start and contention on Windows). Neither file was edited, and neither could be confirmed dynamically here. They were verified by reading against the source only.
- The failing hook budgets (20-30 s) are tight for embedded-PG startup on slow hosts; this is a recommendation, not a change made.

## 4 Comprehensive assessment (by rubric code)
- V1 Validity: 0 defects.
- V2 Meaningful assertions: 1 (terminality "negative control" asserts on a function defined inside the test, not on production code).
- V3 Determinism: 3 minor (terminality uses real 1 s readiness budgets, a real 1.5 s race in the negative control, and probe-count bounds tied to real timers; margins are generous). Leases TTL test uses the real clock but injects `now`, which is sound.
- V4 Isolation: 1 fixed (routes-authz first test absorbed the cold import of the route graph; its 15 s timeout fired, and the pending request leaked into the next test's mock-call assertion, producing a second, cascading failure).
- V5 Mock fidelity: 1 note (routes-authz hand-builds the `services/index.js` mock instead of using importOriginal; the SUT, the routes, is real, and the mock is registered in two places).
- V6 Clarity: 1 note (leases "reclaims from a hidden owner issue and from a terminal owner run" covers two behaviours in one case).
- V7 Coverage: gaps listed in section 7.
- V8 Portability: embedded-PG tests are environment dependent; fixed fake paths such as /tmp are only stored as data and never touched, so they are safe.
- V9 Maintainability: 2 notes (duplicated project-workspace fixture literal, duplicated vi.mock/vi.doMock blocks).

## 5 Summary of results
| path | tests | verdict | defects | action |
|---|---|---|---|---|
| server/src/__tests__/workspace-runtime-leases.test.ts | 10 | VALID_WITH_NOTES | V6, V8 | none; not runnable on this host (ENV hook timeout) |
| server/src/__tests__/workspace-runtime-routes-authz.test.ts | 9 | REWRITTEN | V4, V5, V9 | added a `beforeAll` that preloads the route modules (120 s budget); 9/9 pass |
| server/src/__tests__/workspace-runtime-service-authz.test.ts | 9 | VALID | V8 | none; not runnable on this host (ENV hook timeout) |
| server/src/__tests__/workspace-runtime-start-terminality.test.ts | 8 | VALID_WITH_NOTES | V2, V3 | none; 8/8 pass |

## 6 Per-test detail (non-clean tests)
| file | test | code | finding | action |
|---|---|---|---|---|
| routes-authz | rejects agent callers for project workspace runtime service mutations when workspace auth denies access | V4 | Timed out at 15 s on Windows because the first test paid the cold import of routes/projects.js and its dependency graph. REAL cause of the failure was test structure, not production behaviour. | Fixed by preloading in `beforeAll` |
| routes-authz | blocks shared-project stop/restart requests from agents | V4 | Failed only as a cascade: the previous test's in-flight request called the authz mock after `clearAllMocks`, so `not.toHaveBeenCalled` saw 1 call. | Resolved by the same fix; passes |
| routes-authz | whole file | V5, V9 | `services/index.js` mock is hand-built and duplicated across `vi.mock` and `vi.doMock`; a new export consumed by the routes would need to be added by hand. | Noted; not changed (the cache-busted dynamic import design needs the doMock copy) |
| terminality | negative control: an unbounded probe loop never terminalizes the same start | V2, V3 | Exercises a locally defined `legacyWait`, not production code, and spends 1.5 s of real time. It documents the historical bug shape but cannot fail on a regression. | Kept (not demonstrably obsolete); recommend removal |
| terminality | fails a readiness check whose probes never answer instead of hanging forever | V3 | Real ~1 s readiness budget and wall-clock upper bound of 1 s plus the probe timeout (6 s); generous margin. | Noted |
| terminality | stops probing as soon as the readiness budget is spent | V3 | Probe count bound (1 < n < 12) depends on real 200 ms timers; could flake under heavy load only on the low side. | Noted |
| leases | reclaims from a hidden owner issue and from a terminal owner run | V6 | Two reclaim reasons in one case; a failure in the first hides the second. | Noted |

## 7 Evaluation and recommendations
- No product bugs suspected. Lease exclusivity (single owner via second DB client), reclaim reasons (issue terminal, hidden, run terminal, TTL), board bypass and per-workspace scoping all match services/workspace-runtime-leases.ts. Authz tests match the 403 messages and the shared-workspace stop/restart rule in routes/projects.ts.
- Coverage gaps (not added, as they need embedded PG to verify here): lease `renew` path with a different run but same issue is covered, but `repair` action and `claim` with an unknown execution workspace are not; route tests cover only project `start`/`stop`/`restart` and execution `restart`, not `repair`; the execution-workspace shared-key restriction has no route test.
- Recommend raising embedded-PG `beforeAll` budgets or using a shared fixture on slow hosts, removing the terminality negative control, and splitting the leases combined reclaim test.

## 8 Summary of activities
- Rewritten: workspace-runtime-routes-authz.test.ts. Added `beforeAll` import warm-up and the `beforeAll` import from vitest; no assertions changed.
- Deletions: none.
- Commands: `npx vitest run` on terminality (8 pass); routes-authz before edit (7 pass, 2 fail, ENV-triggered timeout, root cause test structure), after edit (9 pass); leases and service-authz (all skipped, ENV `Hook timed out`, repeated twice for service-authz).

## 9 Approvals
Prepared by: ______________  Reviewed by: ______________  Approved by: ______________
