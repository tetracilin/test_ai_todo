# Test Summary Report: shard server-14 (IEEE 829)

## 1 Report identifier and scope
- Shard: server-14 (project: server). Date: see git.
- Files: 3. Test cases: 159 (35 + 14 + 110; heartbeat-process-recovery counts 107 `it` declarations expanded to 110 by two `it.each` blocks).
- Subject: `server/src/services/heartbeat.ts` (+ `hot-restart.ts`, `recovery/*`, `home-paths.ts`).

## 2 Summary
All three files were read and compared with current `heartbeat.ts` exports and constants. No test asserts upstream-only behaviour. No file was edited. Verdicts: VALID 1, VALID_WITH_NOTES 2, REWRITTEN 0, OBSOLETE_REMOVED 0, NEEDS_DECISION 0.

## 3 Variances
- The two embedded-Postgres suites (`heartbeat-process-recovery` 110 tests, `heartbeat-referenced-projects` 12 of 14 tests) could not execute on this Windows host. `beforeAll` hit the 20s hook timeout starting embedded Postgres (ENV: startup and contention, not a REAL failure). Those tests were judged by static reading only.
- `heartbeat-project-env.test.ts` ran: 35/35 passed.
- Two process-recovery tests are `skipIf(win32)` (process-group semantics); they are correctly guarded (V8).

## 4 Comprehensive assessment
| Code | Count | Notes |
|---|---|---|
| V1 | 0 | `openclaw_gateway` and `codex_local` still registered in `adapters/registry.ts`. Kill-switch default (ON) matches `isMultiProjectWorkspaceSyncEnabled`. |
| V2 | 1 | Stray `expect(MAX_RUN_REFERENCED_ADDITIONAL_PROJECTS).toBeGreaterThan(0)` in the cap test. Harmless, constant-only. |
| V3 | 1 | process-recovery uses 50ms polling with bounded deadlines (3-5s) and wall-clock sleeps in cleanup. Bounded, so slow hosts may flake but cannot hang. |
| V4 | 0 | Env stubbed with `vi.stubEnv` and unstubbed in `afterEach`; temp dirs removed; DB wiped in `afterEach`. |
| V5 | 1 | process-recovery replaces `getServerAdapter` with a hand-built `{supportsLocalAgentJwt, execute}` for every adapter type. Other exports use `importActual`. It will rot if the dispatcher reads more adapter fields. |
| V6 | 2 | `isMultiProjectWorkspaceSyncEnabled` test packs 8 assertions in one case. Some process-recovery cases are 100+ lines with several behaviours. |
| V7 | 0 | Negative paths (deny, throw, flood, foreign company, empty dir, remote target) are covered. |
| V8 | 1 | `resolveManagedProjectWorkspaceDir` isolation test uses `path.sep`, so it is portable. Spawn/pgid tests are guarded. |
| V9 | 1 | Repeated `secretsSvc` stub literals in project-env. |

## 5 Summary of results
| Path | Tests | Verdict | Defects | Action |
|---|---|---|---|---|
| server/src/__tests__/heartbeat-project-env.test.ts | 35 | VALID | none | Ran: 35 passed. No edit. |
| server/src/__tests__/heartbeat-referenced-projects.test.ts | 14 | VALID_WITH_NOTES | V2, V6 | 2 ran and passed; 12 skipped (ENV, embedded PG hook timeout). No edit. |
| server/src/__tests__/heartbeat-process-recovery.test.ts | 110 | VALID_WITH_NOTES | V3, V5, V6 | Static review only (ENV, embedded PG hook timeout). No edit. |

## 6 Per-test detail (not clean)
| File | Test | Code | Finding | Action |
|---|---|---|---|---|
| heartbeat-referenced-projects | caps the number of additional projects and warns about the overflow | V2 | Trailing constant `toBeGreaterThan(0)` assertion unrelated to the behaviour | Noted; not edited because the suite cannot run locally |
| heartbeat-referenced-projects | is ON by default and disabled only by an explicit false env value | V6 | 8 assertions in one case; a failure does not name the offending value | Noted |
| heartbeat-process-recovery | whole suite (`getServerAdapter` mock) | V5 | Hand-built adapter stand-in for all adapter types | Noted |
| heartbeat-process-recovery | whole suite (`waitFor*` helpers) | V3 | Bounded polling; `waitForValue` returns null on timeout and the test then fails on its own assertion | Noted |

## 7 Evaluation and recommendations
- No suspected production bugs and no product decisions needed.
- Recommendation: run `heartbeat-process-recovery` and `heartbeat-referenced-projects` where embedded Postgres starts (t3-nightly on Linux) to confirm. On Windows, raise the `beforeAll` hook timeout.
- Move the stray constant assertion into the "defaults the evaluation cap" test. Replace the hand-built `getServerAdapter` stand-in with a wrapper around the real adapter, overriding only `execute`.
- Coverage gap: no test for `isMultiProjectWorkspaceSyncEnabled` with whitespace or case variants such as " False" or "OFF" (check `isFalsyRuntimeEnvValue` first).

## 8 Summary of activities
- Files rewritten: none. Deletions: none.
- Commands: `npx vitest run heartbeat-project-env + heartbeat-referenced-projects` gave 37 passed, 12 skipped, 1 suite failed (ENV hook timeout). `npx vitest run heartbeat-process-recovery` gave 110 skipped, suite failed (ENV hook timeout).

## 9 Approvals
Prepared by: ______  Reviewed by: ______  Approved by: ______
