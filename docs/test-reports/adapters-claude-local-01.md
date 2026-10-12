# Test Summary Report: adapters-claude-local-01 (IEEE 829)

## 1 Report identifier and scope
- Shard: adapters-claude-local-01; project packages/adapters/claude-local; 15 files (14 under src/server, 1 under src/ui); 223 test cases (acp.auth 14, acp 21, claude-config 3, execute.acp-fallback 3, execute.remote 3, parse 48 after +2 added, permissions 8, probe-diagnostics 16, probe-redaction 1, setup-token-characterization 1, setup-token-parse 70, setup-token-runner 16, test.probe 13, test.remote 2, build-config 4); date: see git.
- This report was reconstructed after the audit workflow finished without writing it. It is built from the audit agent's structured result, the verifier's result, the working-tree diff and a read of the test files.

## 2 Summary
All 15 files assessed against rubric V1-V9. Verdicts: VALID 2 (permissions, build-config), VALID_WITH_NOTES 5, REWRITTEN 8, OBSOLETE_REMOVED 0, NEEDS_DECISION 0. No suspected production bugs. The verifier approved all 8 rewrites and reverted none.

Count variance: the audit agent's summary reported 2 / 6 / 7 (VALID / NOTES / REWRITTEN) but its own `filesRewritten` list and the diff show 8 modified files. This report uses the file-level evidence (2 / 5 / 8). The earlier README roll-up carries the 2 / 6 / 7 figures.

## 3 Variances
- Windows host. After the edits, `vitest run` on packages/adapters/claude-local/src gave 217 passed, 5 failed, 1 skipped. All 5 failures are in the unedited acp.test.ts remote-lane cases (ENV: Windows bsdtar reads "C:" as a remote host, "tar: Cannot connect to C: resolve failed"; those cases use real host tar and /bin/bash and are POSIX-only).
- 11 Windows failures in test.probe.test.ts and test.remote.test.ts (host tar staging under the mocks) were real defects of the tests and now pass after stubbing prepareAdapterExecutionTargetRuntime.
- The verifier ran the 8 rewritten files: 8 files, 167 tests, all pass, no ENV failures.
- The opt-in live characterization suite (RUN_CLAUDE_SETUP_TOKEN_CHARACTERIZATION=1, needs real `claude`, python3 and network) was not run.
- A project-wide run also collects stale gitignored dist/**/*.test.js copies (tsconfig emits tests into dist); two dist-copy fixture tests fail with ENOENT because fixtures are not copied. These are outside this shard and are not counted above.

## 4 Comprehensive assessment
- V8/V5 (test.probe, test.remote): the "mocked" probe tests still ran real host tar staging through prepareAdapterExecutionTargetRuntime and failed on Windows. Fixed with a hermetic stub.
- V5 (execute.acp-fallback): the whole `./acp.js` module was hand-built, including a copy of the fallback message string. Converted to an importActual partial mock that overrides only createClaudeAcpExecutor and resolveClaudeExecutionEngineForRun, so the real formatClaudeAcpFallbackMessage is exercised and the mock cannot rot.
- V4 (acp.auth, probe-redaction, test.probe, probe-diagnostics): console.warn and other spies were restored inline after assertions only, so they leak when an assertion throws. Added afterEach restoration.
- V7 (parse): parseClaudeStreamJson had thin boundary coverage. Added a no-result-event case and a null/non-finite cost case.
- V6 (setup-token-parse): one test title described the wrong behaviour (it asserts the fifth-added-key bound). Renamed, assertion unchanged.
- V8 (acp.test, notes): remote-lane cases use real tar and /bin/bash with no Windows guard.
- V4/V3 (execute.remote, notes): uses `vi.clearAllMocks` only in afterEach, which does not reset implementations; fixture is a large repeated literal (V9). Uses importActual partial mocks (good).
- V1: no stale upstream or default-adapter assumptions found.

## 5 Summary of results
| path | tests | verdict | defect codes | action |
|---|---|---|---|---|
| packages/adapters/claude-local/src/server/acp.auth.test.ts | 14 | REWRITTEN | V4 | added vi.restoreAllMocks to afterEach |
| packages/adapters/claude-local/src/server/acp.test.ts | 21 | VALID_WITH_NOTES | V8 | none; 5 remote-lane cases are POSIX-only and fail on Windows (ENV), no guard exists |
| packages/adapters/claude-local/src/server/claude-config.test.ts | 3 | VALID_WITH_NOTES | V9 | none; temp-dir and spy cleanup already correct, fixtures repeated across cases |
| packages/adapters/claude-local/src/server/execute.acp-fallback.test.ts | 3 | REWRITTEN | V5 | hand-built ./acp.js mock replaced by importActual partial mock |
| packages/adapters/claude-local/src/server/execute.remote.test.ts | 3 | VALID_WITH_NOTES | V4, V9 | none; clearAllMocks only, large input fixture |
| packages/adapters/claude-local/src/server/parse.test.ts | 48 | REWRITTEN | V7 | added 2 tests (no result event; absent or non-finite cost) |
| packages/adapters/claude-local/src/server/permissions.test.ts | 8 | VALID | none | none |
| packages/adapters/claude-local/src/server/probe-diagnostics.test.ts | 16 | REWRITTEN | V4 | afterEach vi.restoreAllMocks for the console.warn spy block |
| packages/adapters/claude-local/src/server/probe-redaction.test.ts | 1 | REWRITTEN | V4 | added vi.restoreAllMocks to afterEach |
| packages/adapters/claude-local/src/server/setup-token-characterization.test.ts | 1 | VALID_WITH_NOTES | V8 | none; opt-in live suite (real claude, python3, network), skipped by default, not run here |
| packages/adapters/claude-local/src/server/setup-token-parse.test.ts | 70 | REWRITTEN | V6 | renamed misleading test to "returns null when the URL carries a fifth added key" |
| packages/adapters/claude-local/src/server/setup-token-runner.test.ts | 16 | VALID_WITH_NOTES | V9 | none; thorough secret-leak, timeout, cancel and sink-failure coverage |
| packages/adapters/claude-local/src/server/test.probe.test.ts | 13 | REWRITTEN | V8, V5, V4 | stubbed prepareAdapterExecutionTargetRuntime (no host tar); added restoreAllMocks |
| packages/adapters/claude-local/src/server/test.remote.test.ts | 2 | REWRITTEN | V8, V5 | stubbed prepareAdapterExecutionTargetRuntime (no host tar) |
| packages/adapters/claude-local/src/ui/build-config.test.ts | 4 | VALID | none | none |

## 6 Per-test detail
| file | test | code | finding | action |
|---|---|---|---|---|
| test.probe.test.ts, test.remote.test.ts | all remote-probe cases (11 failed on Windows) | V8, V5 | mocks left real host tar workspace/asset staging in play | hermetic prepareAdapterExecutionTargetRuntime stub returning a fixed runtime root, empty assetDirs and a no-op restoreWorkspace |
| execute.acp-fallback.test.ts | all 3 | V5 | whole acp.js mocked by hand, incl. a duplicated fallback message string | importActual spread, override three seams only |
| acp.auth.test.ts, probe-redaction.test.ts, test.probe.test.ts | all | V4 | clearAllMocks does not restore spies | restoreAllMocks in afterEach |
| probe-diagnostics.test.ts | logRedactedSandboxProbeDiagnostic cases | V4 | console.warn spy restored inline after assertions | afterEach restore |
| parse.test.ts | returns assistant text, session and model without usage when no result event arrived (new) | V7 | no coverage of a stream with no result event or non-JSON noise | added: summary "first\n\nsecond", usage/costUsd/resultJson null |
| parse.test.ts | reports a null cost when total_cost_usd is absent or not a finite number (new) | V7 | no boundary on cost | added |
| setup-token-parse.test.ts | returns null when the URL carries a fifth added key | V6 | old title ("unexpected added key with a valid name") contradicted the body | renamed |
| acp.test.ts | remote-lane cases (5) | V8 | real tar and /bin/bash, fail on Windows | noted; not guarded or edited |
| setup-token-characterization.test.ts | live characterization | V8 | skipped unless RUN_CLAUDE_SETUP_TOKEN_CHARACTERIZATION=1 | noted |

## 7 Evaluation and recommendations
- No product bugs suspected; no NEEDS_DECISION items. No assertions were weakened by any rewrite.
- Product/tooling finding: claude-local's vitest run collects stale dist/**/*.test.js copies because tsconfig emits tests into dist. Exclude dist in the package vitest config (separate test or ci PR, out of scope here).
- Add a `skipIf(process.platform === "win32")` guard, or a Windows-safe tar path, for the 5 acp.test.ts remote-lane cases (rolls into the repo-wide Windows-support decision).
- Consider a shared fixture builder for the execute.remote input literal and for the duplicated hoisted mock in test.probe and test.remote.
- Rerun on Linux (t3-nightly) to confirm acp.test.ts and the live characterization path.

## 8 Summary of activities
- Edited 8 test files: acp.auth, execute.acp-fallback, parse, probe-diagnostics, probe-redaction, setup-token-parse, test.probe, test.remote (net +70 / -14 lines). No deletions; no production code touched.
- Commands: `vitest run` on packages/adapters/claude-local/src after edits (217 passed, 5 failed ENV in acp.test.ts, 1 skipped); verifier run of the 8 rewritten files (167 passed).

## 9 Approvals
Prepared by: ____________  Reviewed by: ____________  Approved by: ____________
