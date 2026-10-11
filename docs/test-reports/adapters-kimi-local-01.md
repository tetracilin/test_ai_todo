# Test Summary Report: adapters-kimi-local-01

## 1 Report identifier and scope
- Shard: adapters-kimi-local-01 (project `packages/adapters/kimi-local`)
- Files: 6. Test cases: 70 after edit (67 before; +3 added, 0 removed). Date: see git.
- Standard: ISO/IEC/IEEE 29119 / ISTQB rubric V1-V9.

## 2 Summary
All six files were read in full and checked against `acp.ts`, `execute.ts`, `parse.ts`, `test.ts`, `ui/build-config.ts`, `ui/parse-stdout.ts` and `index.ts`. The subject under test exists in this fork and assertions match current behaviour (ACP default engine with CLI fallback, `kimi-code/kimi-for-coding` default model, medium->high effort mapping, k3 as only effort-capable model). Verdicts: VALID 1, VALID_WITH_NOTES 0, REWRITTEN 5, OBSOLETE_REMOVED 0, NEEDS_DECISION 0.

## 3 Variances
- Not verified on Linux/macOS; run on Windows only. All six files passed on Windows, so no ENV failures were observed.
- Tests use mocked execution targets; no real `kimi` binary or ACP session was exercised.

## 4 Comprehensive assessment
| Code | Count | Notes |
|---|---|---|
| V1 | 0 | No stale upstream assertions found. |
| V2 | 0 | |
| V3 | 0 | No timers/network; only `Date.now` inside SUT for run ids. |
| V4 | 0 | Env stubbed/unstubbed in test.test.ts; temp dirs removed in execute.test.ts. |
| V5 | 2 | `execution-target` module was fully hand-mocked in execute.test.ts and test.test.ts (rots when exports are added). Fixed with importOriginal partial mocks. |
| V6 | 0 | |
| V7 | 3 | Gaps: error-role stdout line, malformed tool_call args in UI parser, secret-vs-legacy env precedence, Node 19 boundary. Added cheap tests. Remaining gaps in section 7. |
| V8 | 2 | execute.test.ts uses literal `/some/other/dir`, test.test.ts uses `/tmp/project`; both only compared as opaque strings against mocks, so portable. Noted, no change. |
| V9 | 0 | Repeated runProcessMock setup in execute.test.ts is verbose but readable. |

## 5 Summary of results
| Path | Tests | Verdict | Defects | Action |
|---|---|---|---|---|
| packages/adapters/kimi-local/src/server/acp.test.ts | 12 | REWRITTEN | V7 | Added Node v19.9.9 boundary assertion |
| packages/adapters/kimi-local/src/server/execute.test.ts | 16 | REWRITTEN | V5 | Mock of execution-target now spreads importOriginal |
| packages/adapters/kimi-local/src/server/parse.test.ts | 24 | VALID | none | none |
| packages/adapters/kimi-local/src/server/test.test.ts | 3 | REWRITTEN | V5, V7 | Mock now spreads importOriginal; coverage gaps listed |
| packages/adapters/kimi-local/src/ui/build-config.test.ts | 5 | REWRITTEN | V7 | Added secret-over-legacy env precedence test |
| packages/adapters/kimi-local/src/ui/parse-stdout.test.ts | 10 | REWRITTEN | V7 | Added error-role and invalid-JSON-arguments tests |


## 6 Per-test detail
| File | Test | Code | Finding | Action |
|---|---|---|---|---|
| acp.test.ts | rejects Node < 20 | V7 | Only v18 covered; boundary just below 20 untested | Added v19.9.9 |
| execute.test.ts | whole suite | V5 | Hand-built execution-target mock | importOriginal partial mock |
| test.test.ts | whole suite | V5 | Same | importOriginal partial mock |
| test.test.ts | (missing) | V7 | No test for unresolvable command, version probe failure, hello probe non-hello output, or non-kimi custom command | Reported only |
| build-config.test.ts | (new) prefers a secret binding over a legacy env var | V7 | Precedence in buildKimiLocalConfig was unasserted | Added |
| parse-stdout.test.ts | (new) renders error-role lines as stderr entries | V7 | `role: "error"` branch untested | Added |
| parse-stdout.test.ts | (new) keeps raw string arguments when invalid JSON | V7 | Fallback in parseToolCallArguments untested | Added |

## 7 Evaluation and recommendations
- No product bugs suspected.
- Coverage gaps (not added, need larger fixtures): `testKimiAcpEnvironment` and the ACP fallback path (`resolveKimiExecutionEngineForRun`, `formatKimiAcpFallbackMessage`); `detectLocalKimiAuth` OAuth dir / config.toml branches; remote execution target branches in execute/test; skills injection (`--skills-dir` positive case); execute retry on transient network error.

## 8 Summary of activities
- Rewritten: acp.test.ts (boundary), execute.test.ts (V5), test.test.ts (V5), build-config.test.ts (+1 test), parse-stdout.test.ts (+2 tests).
- Deletions: none.
- Commands: `npx vitest run packages/adapters/kimi-local` before edit: 12 files, 134 tests passed. After edit: `npx vitest run packages/adapters/kimi-local/src`: 6 files, 70 tests passed.

## 9 Approvals
Prepared by: ____________  Reviewed by: ____________  Date: ____________
