# Test Summary Report: shard server-24 (IEEE 829)

## 1. Report identifier and scope

- Report id: `server-24`
- Project: `server` (vitest project `@paperclipai/server`), t3-nightly "slow-tests" audit
- Branch under audit: develop-derived working tree (`test/slow-tests-audit`); date: see git
- Files in shard: 30 (all under `server/src/__tests__/`)
- Test cases: 286 (it/test cases after edits; `remote-http-endpoint-guard` counts 2 plain + 4 `it.each` rows = 6; originally 285, one test was added to `recovery-classifiers`)
- Rubric: V1 validity, V2 meaningful assertions, V3 determinism, V4 isolation, V5 mock fidelity, V6 clarity, V7 coverage balance, V8 portability, V9 maintainability (ISO/IEC/IEEE 29119, ISTQB)

## 2. Summary

All 30 files were read in full and each was checked against the production source it exercises (plugin dispatcher/worker manager/UI static route, privateHostnameGuard, privateJsonEtag, productivity-review, projects/routines routes and services, quota-windows adapters, recovery services, redaction, remote-http-endpoint-guard, resource-memberships, routable-blocked, sandbox-provider-runtime).

No file tests upstream-only behaviour; all subjects exist in the fork and assertions match current behaviour (V1 clean). Defects found were mostly V2 (vacuous/loose assertions), V3 (ordering, timing margins, loose status matchers) and V4 (temp-dir cleanup).

Verdict counts: VALID 8, VALID_WITH_NOTES 11, REWRITTEN 11, OBSOLETE_REMOVED 0, NEEDS_DECISION 0 (total 30; see section 5).

Edited files: 12 (11 classed REWRITTEN, plus `routines-routes`, edited by a test rename only and classed VALID_WITH_NOTES).

## 3. Variances (what could not be verified)

- Host is Windows 11. Embedded PostgreSQL did not start inside the suite's fixed 20-30 s `beforeAll` timeout on this machine (ENV: Windows process start/contention; the CLI `--hookTimeout` does not override per-hook timeouts). Affected files could not be executed: `projects-list-archived-routes` (skipped, 2), `resource-memberships-routes` (hook timeout), `routines-e2e` (hook timeout), `qa-routine-secrets-e2e` (hook timeout twice; the first attempt also had the vitest worker exit unexpectedly), and, unedited, `productivity-review-service`, `project-icon-persistence`, `recovery-observability`, `recovery-stale-issue-lock-sweep`, `routine-run-telemetry`. Edits to these were therefore checked statically against production source (route status codes 201 at `server/src/routes/routines.ts` lines 191 and 497, `HttpError extends Error`, no ORDER BY in project list service) and are small and assertion-level. They are classified ENV, not REAL.
- `project-goal-telemetry-routes` exceeded the default 20 s test timeout on the first test in a cold run (module transform of real routes on Windows, ENV). It passes (2/2) with `--testTimeout=90000`. Not a defect in the test logic; cold-import cost is a risk on slow hosts (V3 note).
- `recovery-stale-issue-lock-sweep` uses pid `2_000_000_000` as a "dead process"; `isPidAlive` behaviour for that pid on Windows is untested here (V8 note).
- Fixture workers in `plugin-worker-manager*.test.ts` run real child processes (`fixtures/*.cjs`); they passed on Windows.

## 4. Comprehensive assessment (cross-cutting defects)

| Code | Count | Summary |
|---|---|---|
| V1 | 0 | No upstream-only or stale-default assertions found in this shard. |
| V2 | 7 | Dispatcher "lifecycle" test never emitted the lifecycle event; parity tests compared a re-export with itself (tautology); `[200,201]` status matchers (3 files); "missing secret" test passed on any thrown value; open-timeout test asserted a bare `toThrow()`; project env route test did not prove values are absent from the activity log; "legacy run" secrets test does not exercise the fallback it names. |
| V3 | 6 | Unordered DB reads asserted in order (project list, activity log x6); 100 ms vs 50 ms RPC timeout margin; fixed 40 ms/60 ms sleeps used to synthesize races (`plugin-worker-manager` forged-peer test, duplex buffering tests); synchronous read after a fixed delay (duplex replay); retry-on-500 helper in `routines-e2e`; cold-import 20 s timeouts. |
| V4 | 1 | `quota-windows` temp dirs created with `Date.now()` names and removed only on the success path. |
| V5 | 2 | `private-hostname-guard` page-route test uses hand-built req/res (acceptable for middleware, noted); `reusable-leases-default` re-implements the production guard in a helper instead of calling it. |
| V6 | 3 | Misleading names fixed: "newest-first" (no ordering asserted), "legacy ... falls back", "lifecycle path". |
| V7 | 6 | Gaps listed in section 7. |
| V8 | 2 | POSIX-ish pid and `/tmp` nonexistent-path assumptions (noted, guarded by being nonexistent). |
| V9 | 4 | Annotation thread create/reply/resolve test duplicated between `routine-document-annotation-routes` and `routines-routes`; duplicated vi.mock + vi.doMock blocks; repeated fixture literals; ten copies of temp-dir boilerplate in `quota-windows` (fixed). |

## 5. Summary of results (one row per file)

| Path | Tests | Verdict | Defect codes | Action taken |
|---|---|---|---|---|
| server/src/__tests__/plugin-tool-dispatcher-pluginDbId.test.ts | 6 | REWRITTEN | V2, V6, V9 | "lifecycle" test now mocks `plugin-registry`, calls `initialize()`, emits `plugin.enabled` / `plugin.disabled` on the lifecycle emitter and asserts UUID registration and unregistration; removed dead `createDbStub` and unused imports. Passes 6/6. |
| server/src/__tests__/plugin-ui-static.test.ts | 4 | VALID_WITH_NOTES | V7 | None. Notes: no path-traversal or missing-asset (404) case. |
| server/src/__tests__/plugin-worker-manager-duplex.test.ts | 22 | REWRITTEN | V3 | Replaced a synchronous post-delay read with `vi.waitFor` in the throwing-listener replay test. Passes 22/22. Note: two tests rely on a 60 ms sleep to let frames buffer (outcome still correct if frames arrive late). |
| server/src/__tests__/plugin-worker-manager.test.ts | 47 | REWRITTEN | V2, V3 | Per-call timeout override widened from 100 ms to 5 000 ms (delay stays 50 ms) to remove a scheduling race; open-timeout test now asserts `/timed out after 200ms/` instead of a bare `toThrow()`. Passes 47/47. Notes: forged-peer test uses a 40 ms sleep (vacuous if the worker is slow). |
| server/src/__tests__/private-hostname-guard.test.ts | 6 | VALID_WITH_NOTES | V5, V9 | None. Hand-built req/res for page route; unneeded 20 s timeout; upstream-author hostname `dotta-macbook-pro` as sample data. |
| server/src/__tests__/private-json-etag.test.ts | 1 | VALID_WITH_NOTES | V6, V7 | None. One test covers 200, 304 and change; no weak-ETag or non-GET cases. |
| server/src/__tests__/productivity-review-service.test.ts | 16 | VALID | none | None (embedded PG; not run on this host, injected clock, deterministic). |
| server/src/__tests__/project-goal-telemetry-routes.test.ts | 2 | REWRITTEN | V2, V9 | `[200,201]` status matcher tightened to exactly 201 (both routes return 201). Passes 2/2 with `--testTimeout=90000`; default 20 s timeout exceeded on a cold run (ENV). Duplicate mock registration noted. |
| server/src/__tests__/project-icon-persistence.test.ts | 4 | VALID | none | None (embedded PG; not run). |
| server/src/__tests__/project-list-metrics.test.ts | 4 | VALID | none | None. |
| server/src/__tests__/project-routes-env.test.ts | 2 | REWRITTEN | V2 | Create test: `[200,201]` -> 201 and asserts the secret id never appears in activity-log calls; update test asserts the plaintext value never appears. Passes 2/2. |
| server/src/__tests__/project-shortname-resolution.test.ts | 5 | VALID | none | None. |
| server/src/__tests__/projects-list-archived-routes.test.ts | 2 | REWRITTEN | V3 | Project list has no ORDER BY, so id comparison made order-insensitive. Embedded PG skipped here (ENV); not executed. |
| server/src/__tests__/qa-routine-secrets-e2e.test.ts | 6 | REWRITTEN | V2, V6 | Missing-secret test now requires an `Error` with a non-empty value-free message; "legacy run" test renamed and commented to state it covers the resolution layer only. Not executed (ENV, hook timeout). |
| server/src/__tests__/quota-windows-service.test.ts | 1 | VALID | none | None. Fake timers, deterministic. |
| server/src/__tests__/quota-windows.test.ts | 58 | REWRITTEN | V4, V9 | Replaced 10 `Date.now()` temp dirs with a `mkdtempSync` helper cleaned in a file-level `afterEach` (also on failure). Passes 58/58. |
| server/src/__tests__/recovery-classifiers.test.ts | 7 | REWRITTEN | V2, V7 | Parity tests asserted a function equal to its own re-export; now assert identity plus concrete outcomes (`blocked_by_unassigned_issue`, `enqueue` with key). Added 1 test for skip (budget, idempotent wake) and exhaustion boundaries. Passes 7/7. |
| server/src/__tests__/recovery-observability.test.ts | 12 | VALID | none | None (embedded PG part not run; pure part deterministic). |
| server/src/__tests__/recovery-stale-issue-lock-sweep.test.ts | 11 | VALID_WITH_NOTES | V8 | None. Pid `2_000_000_000` as dead-process sentinel is unverified on Windows. |
| server/src/__tests__/redact-sensitive.test.ts | 10 | VALID_WITH_NOTES | V2 | None. Cycle test only asserts "does not throw". |
| server/src/__tests__/redaction.test.ts | 8 | VALID | none | None. |
| server/src/__tests__/remote-http-endpoint-guard.test.ts | 6 | VALID_WITH_NOTES | V7 | None. 2 plain + 4 `it.each`; no IPv4-mapped IPv6 / multiple-address / DNS-failure case. |
| server/src/__tests__/rerun-survival.integration.test.ts | 4 | VALID | none | None. Referenced companion suites verified to exist. |
| server/src/__tests__/resource-memberships-routes.test.ts | 13 | REWRITTEN | V3 | Activity-log reads (6) now `orderBy(createdAt)` since order assertions depended on heap order. Not executed (ENV). |
| server/src/__tests__/reusable-leases-default.test.ts | 2 | VALID_WITH_NOTES | V5, V9 | None. Helper `executionSupportsReusableLeases` copies the production guard rather than calling it. |
| server/src/__tests__/routable-blocked.test.ts | 3 | VALID_WITH_NOTES | V7 | None. No non-blocked status / missing descriptor case. |
| server/src/__tests__/routine-document-annotation-routes.test.ts | 3 | VALID_WITH_NOTES | V9 | None. Overlaps `routines-routes` annotation test. |
| server/src/__tests__/routine-run-telemetry.test.ts | 1 | VALID_WITH_NOTES | V7 | None. Only the `manual`/`issue_created` path. Not run (embedded PG). |
| server/src/__tests__/routines-e2e.test.ts | 5 | REWRITTEN | V2, V3 | Five `[200,201]` matchers tightened to 201 (create routine and trigger both respond 201). The `postRoutineRun` retry-on-500 helper left in place and flagged (section 7). Not executed (ENV). |
| server/src/__tests__/routines-routes.test.ts | 15 | VALID_WITH_NOTES | V6, V9 | Renamed "newest-first service order" test (no ordering was asserted). Passes 15/15. |

Recount of verdicts: REWRITTEN 11 (dispatcher, duplex, worker-manager, goal-telemetry, routes-env, archived-routes, qa-routine-secrets, quota-windows, recovery-classifiers, resource-memberships, routines-e2e), VALID_WITH_NOTES 11 (ui-static, hostname-guard, json-etag, stale-lock-sweep, redact-sensitive, remote-http-guard, reusable-leases, routable-blocked, routine-doc-annotation, routine-run-telemetry, routines-routes), VALID 8 (productivity-review, icon-persistence, list-metrics, shortname, quota-service, recovery-observability, redaction, rerun-survival). Total 30.

## 6. Per-test detail (tests that are not clean)

| File | Test | Code | Finding | Action |
|---|---|---|---|---|
| plugin-tool-dispatcher-pluginDbId | registers tools by UUID when plugin.enabled fires | V2/V6 | Never emitted `plugin.enabled`; called the registry directly, so the lifecycle handler and `registerFromDb` were untested. | Rewritten to drive `initialize()` + emitted events with a mocked registry. |
| plugin-worker-manager-duplex | isolates a throwing listener during the buffered replay | V3 | Synchronous `expect(chunks)` after a 60 ms sleep fails if frames arrive late. | Added `vi.waitFor`. |
| plugin-worker-manager | honors per-call timeout overrides for environmentExecute | V3 | 100 ms override vs 50 ms delay is a scheduling race on a loaded host. | Override 5 000 ms. |
| plugin-worker-manager | terminalizes the route on an open timeout | V2 | `rejects.toThrow()` passes for any error. | Asserts `timed out after 200ms`. |
| plugin-worker-manager | fails closed and never delivers execute.log across companies | V3 | 40 ms sleep to let worker record peer id; if late the forged id is unknown and the test passes vacuously. | Noted (needs fixture handshake). |
| project-goal-telemetry-routes | emits telemetry when a project/goal is created | V2 | `[200,201]` accepted. | Exactly 201. |
| project-routes-env | normalizes env bindings on create / update | V2 | Did not prove raw values/ids are kept out of the activity log. | Added negative assertions. |
| projects-list-archived-routes | includes archived projects when includeArchived is true | V3 | Asserted list order with no ORDER BY in the service. | Order-insensitive compare. |
| qa-routine-secrets-e2e | surfaces a clear, value-free error when a routine secret is missing/deleted | V2 | `expect(caught).toBeTruthy()` passes for any throw. | Requires `Error` with non-empty value-free message. |
| qa-routine-secrets-e2e | legacy run with null routine_revision_id... | V1/V6 | Name claims a fallback lookup that is private to heartbeatService and not exercised. | Renamed and commented. |
| quota-windows | readClaudeToken / readCodexAuthInfo / readCodexToken fs cases (10) | V4 | `Date.now()` dir names, cleanup skipped on failed assertion. | `mkdtempSync` + `afterEach` cleanup. |
| recovery-classifiers | keeps issue graph liveness classifier parity | V2 | `compat` is a re-export; equality of identical calls cannot fail. | Identity check + concrete finding. |
| recovery-classifiers | keeps run liveness continuation decision parity | V2 | Same tautology. | Identity check + concrete `enqueue` outcome. |
| resource-memberships-routes | six tests reading `activityLog` in insertion order | V3 | Row order not guaranteed without ORDER BY. | `orderBy(createdAt)`. |
| routines-e2e | all create/trigger status checks (5) | V2 | `[200,201]` accepted. | Exactly 201. |
| routines-e2e | `postRoutineRun` helper | V3 | Retries once on HTTP 500 after 25 ms, masking a real intermittent server error. | Not changed (no safe replacement without running PG); see section 7. |
| routines-routes | lists routine revisions ... newest-first service order | V6 | Single-element mock, ordering never asserted. | Renamed. |
| redact-sensitive | caps recursion depth so cycles do not pin the logger | V2 | Only asserts no throw. | Noted. |
| reusable-leases-default | test_api_presentation_agrees_with_runtime_execution | V5 | Compares against a local copy of the production guard. | Noted. |

## 7. Evaluation and recommendations

Product findings (none requiring a decision; no production code changed):
1. `routines-e2e` retry-on-500 hides a possible intermittent server error on `POST /routines/:id/run`. Recommend finding the root cause (likely wakeup/heartbeat race with the shimmed `wakeup`) and removing the retry.
2. `GET /companies/:id/projects` has no deterministic ORDER BY; clients and tests cannot rely on order (service `projects.ts` list).
3. Embedded Postgres startup on Windows exceeds hard-coded 20-30 s `beforeAll` timeouts, so ten files in this shard silently do not run for Windows contributors. Consider a shared helper-level timeout.

Coverage gaps (not added; larger than a cheap test):
- `plugin-ui-static`: path traversal and missing-file 404.
- `remote-http-endpoint-guard`: IPv4-mapped IPv6, mixed public/private DNS answers, DNS failure.
- `routable-blocked`: non-blocked status, missing descriptor, wakeup failure leaving `markNotified` uncalled.
- `private-json-etag`: weak ETag matching, non-GET methods.
- `routine-run-telemetry`: failure/skipped run statuses.
- Heartbeat `getRoutineEnvForExecutionIssue` legacy (null revision) fallback has no direct test because the helper is private; exporting it or testing via a heartbeat run would close the gap.
- Routine route validation (400) paths in `routines-routes` beyond the e2e activity-gate case.

Test hygiene notes: duplicated annotation test between two routine route files; `vi.mock` and `vi.doMock` registrations duplicated in the telemetry/env route tests; fixture literals repeated across files.

## 8. Summary of activities

Files rewritten (one-line reason each):
- plugin-tool-dispatcher-pluginDbId.test.ts: make lifecycle test exercise real `plugin.enabled`/`plugin.disabled` handlers; drop dead helper.
- plugin-worker-manager-duplex.test.ts: bounded wait instead of sync read after sleep.
- plugin-worker-manager.test.ts: widen timeout margin; assert specific timeout error.
- project-goal-telemetry-routes.test.ts: exact 201 status.
- project-routes-env.test.ts: exact 201; negative leak assertions.
- projects-list-archived-routes.test.ts: order-insensitive id comparison.
- qa-routine-secrets-e2e.test.ts: stronger error assertion; honest legacy-test name/comment.
- quota-windows.test.ts: safe unique temp dirs with guaranteed cleanup.
- recovery-classifiers.test.ts: de-tautologize parity tests; add skip/exhausted boundary test (+1 test).
- resource-memberships-routes.test.ts: ordered activity-log reads.
- routines-e2e.test.ts: exact 201 statuses.
- routines-routes.test.ts: corrected test name (VALID_WITH_NOTES).

Deletions: none.

Commands run (from repo root) and outcomes:
- `npx vitest run server/src/__tests__/plugin-tool-dispatcher-pluginDbId.test.ts`: 6 passed.
- `... plugin-worker-manager-duplex.test.ts`: 22 passed.
- `... plugin-worker-manager.test.ts`: 47 passed.
- `... project-goal-telemetry-routes.test.ts`: first run 1 failed (20 s timeout on cold import, ENV); with `--testTimeout=90000`: 2 passed.
- `... project-routes-env.test.ts`: 2 passed.
- `... recovery-classifiers.test.ts`: 7 passed.
- `... quota-windows.test.ts`: 58 passed.
- `... routines-routes.test.ts`: 15 passed.
- `... qa-routine-secrets-e2e.test.ts`: not executed, ENV (embedded PG start hook timeout; first attempt also worker exited unexpectedly), run twice.
- `... projects-list-archived-routes.test.ts resource-memberships-routes.test.ts routines-e2e.test.ts`: not executed, ENV (archived skipped; other two hook timeout at 20 s embedded PG start).

## 9. Approvals

- Prepared by: ____________________  Date: __________
- Reviewed by: ____________________  Date: __________
- Approved by: ____________________  Date: __________
