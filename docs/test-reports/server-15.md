# Test Summary Report - shard server-15 (IEEE 829)

## 1 Report identifier and scope
- Report id: server-15. Project: server (vitest). Date: see git.
- Files: 19 (`server/src/__tests__/heartbeat-*` from remote-referenced-projects to workspace-ready-comment).
- Test cases: 154 (it/test counts; it.each expansions: retry-scheduling 2+3+3, branch-containment 2+3).

## 2 Summary
All 19 files were read or scanned against the production sources they import (`services/heartbeat.ts`, `heartbeat-run-summary.ts`, `agent-start-lock.ts`, `adapters/index.ts`). No upstream-only or stale-default assertions were found. One cross-cutting defect (V5, hand-built `adapters/index` mock) was fixed in two files.
Verdicts: VALID 7, VALID_WITH_NOTES 10, REWRITTEN 2, OBSOLETE_REMOVED 0, NEEDS_DECISION 0.

## 3 Variances
- 13 files use `describeEmbeddedPostgres` and all 11 DB-backed ones timed out in `beforeAll` (20 s hook) on this Windows host. Their test bodies could not be executed here (ENV, not REAL). They are skipped on hosts without support and run in t3-nightly.
- `vitest list --json` output was empty, so it.each expansion counts come from reading the source.
- Embedded-PG tests were therefore reviewed statically only.

## 4 Comprehensive assessment
- V1 Validity: 0 defects.
- V2 Meaningful assertions: 0 defects.
- V3 Determinism: 0 hard defects. All polling is deadline-bounded (3-10 s); fixed 50-100 ms sleeps in afterEach/waiters are note-level (7 files). `waitForCondition` default of 3 s in stale-queue-invalidation is tight on loaded CI.
- V4 Isolation: 0 defects (env vars restored in mcp-servers and runtime-skills; fake timers restored in start-lock).
- V5 Mock fidelity: 2 defects (branch-containment, finalize-branch) fixed. responsible-user and stale-queue already use importActual.
- V6 Clarity: 3 notes (terminalize mapping test has 9 assertions in one case; retry-scheduling and stale-queue are 2300/1650 lines).
- V7 Coverage: notes below.
- V8 Portability: 2 notes (branch/finalize/busy tests create git repos and POSIX-style paths such as `/repo/...` in ready-comment are string fixtures only, harmless).
- V9 Maintainability: 2 notes (stale `heartbeat.ts:16601` line references in terminalize-before-release comments; very large files).

## 5 Summary of results
| File | Tests | Verdict | Defects | Action |
|---|---|---|---|---|
| heartbeat-remote-referenced-projects.test.ts | 9 | VALID | - | none; passes |
| heartbeat-responsible-user-invariant.test.ts | 6 | VALID_WITH_NOTES | V3 note | none; EP, ENV timeout |
| heartbeat-retry-scheduling.test.ts | 30 | VALID_WITH_NOTES | V3, V6 notes | none; EP, not runnable here |
| heartbeat-run-lease-release-terminalization.test.ts | 5 | VALID | - | none; EP |
| heartbeat-run-log.test.ts | 3 | VALID | - | none; passes |
| heartbeat-run-status-payload.test.ts | 2 | VALID | - | none; passes |
| heartbeat-run-summary.test.ts | 15 | VALID | - | none; passes |
| heartbeat-run-terminalize-before-release.test.ts | 5 | VALID_WITH_NOTES | V6, V9 | none; mapping test passes, DB 4 ENV |
| heartbeat-runtime-mcp-servers.test.ts | 2 | VALID_WITH_NOTES | V3 note | none; EP |
| heartbeat-runtime-skills.test.ts | 2 | VALID_WITH_NOTES | V3 note | none; EP |
| heartbeat-runtime-state.test.ts | 3 | VALID | - | none; EP |
| heartbeat-scheduling-suppression.test.ts | 6 | VALID | - | none; passes |
| heartbeat-stale-queue-invalidation.test.ts | 24 | VALID_WITH_NOTES | V3, V6 | none; EP |
| heartbeat-start-lock.test.ts | 1 | VALID | - | none; passes |
| heartbeat-timer-wake-session-reset-pf4.test.ts | 16 | VALID | - | none; passes |
| heartbeat-workspace-branch-containment.test.ts | 6 | REWRITTEN | V5 | adapters mock now spreads importActual |
| heartbeat-workspace-busy.test.ts | 15 | VALID_WITH_NOTES | V3, V8 | none; EP |
| heartbeat-workspace-finalize-branch.test.ts | 3 | REWRITTEN | V5 | adapters mock now spreads importActual |
| heartbeat-workspace-ready-comment.test.ts | 1 | VALID_WITH_NOTES | V8 | none; passes |

## 6 Per-test detail (not clean)
| File | Test | Code | Finding | Action |
|---|---|---|---|---|
| heartbeat-workspace-branch-containment.test.ts | all (file-level mock) | V5 | hand-built `../adapters/index.js` mock omitted most real exports | spread importActual, override same functions |
| heartbeat-workspace-finalize-branch.test.ts | all (file-level mock) | V5 | same | same fix |
| heartbeat-run-terminalize-before-release.test.ts | maps each terminal run status... | V6 | nine assertions in one case, one failure hides the rest | noted, kept (no weakening) |
| heartbeat-run-terminalize-before-release.test.ts | file comments | V9 | cite `heartbeat.ts:16601` line numbers that will rot | noted |
| heartbeat-stale-queue-invalidation.test.ts | many | V3 | `waitForCondition` 3 s default bound | noted |
| heartbeat-runtime-skills.test.ts | afterEach | V3 | fixed 100 ms sleep to let async work drain | noted |

## 7 Evaluation and recommendations
- No product bugs suspected; no NEEDS_DECISION items.
- Coverage gaps: `compactRunLogChunk` has no empty-string/no-op case; `buildHeartbeatRunStatusLiveEventPayload` has no failed/cancelled terminal case; `withAgentStartLock` has no test that a completed first start releases the next without waiting 30 s, nor that rejection of the first start does not block the second.
- Recommend adding a Windows-friendly skip reason or longer hookTimeout for embedded PG locally (config change, out of scope).
- Consider splitting retry-scheduling and stale-queue-invalidation by concern.

## 8 Summary of activities
- Rewritten: branch-containment and finalize-branch (V5 mock fidelity; behaviour of the mock functions unchanged, `runningProcesses` still a fresh Map).
- Deletions: none.
- Commands: `pnpm --filter @paperclipai/plugin-sdk ensure-build-deps`; `npx vitest run` on 14 unedited files: 8 files / 54 tests pass, 6 DB files hook-timeout (ENV), 22 skipped; `npx vitest run` on the 2 edited files: modules load, `beforeAll` embedded-PG timeout (ENV, identical to pre-edit behaviour). `tsc` typecheck of the two edits printed no errors for them.

## 9 Approvals
Prepared by: ____________  Reviewed by: ____________  Approved by: ____________
