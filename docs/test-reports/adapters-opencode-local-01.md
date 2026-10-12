# Test Summary Report: adapters-opencode-local-01 (IEEE 829)

## 1 Report identifier and scope
- Shard: adapters-opencode-local-01
- Project: packages/adapters/opencode-local
- Files: 7; test cases: 42 (no each/table expansions)
- Date: see git

## 2 Summary
All seven files were read in full and checked against src/index.ts, server/models.ts, server/execute.ts, server/runtime-config.ts and server/parse.ts. Subject code all exists and matches the tests (fork-added gateway/OPENCODE_ALLOW_ALL_MODELS/provider-injection behaviour is covered). Verdicts: VALID 3, VALID_WITH_NOTES 2, REWRITTEN 2, OBSOLETE_REMOVED 0, NEEDS_DECISION 0.

## 3 Variances
- Windows host: remote/SSH tests are fully mocked so they ran as-is. The `/tmp` cwd strings in execute.test.ts are inert (never touched). Full-package run before edits showed dist/ copies of tests also being collected (dist/server/models.test.js), same defect mirrored; dist is a build artefact and was not edited.
- Server-wide suites were not run (out of scope).

## 4 Comprehensive assessment
- V3 Determinism: 1 file / 4 tests (models.test.ts) used a real spawn of a non-existent CLI; the discovery retry loop then slept in real time (observed 3-5 s on Windows), and one test exceeded the 5 s timeout (ENV-triggered but a genuine wall-clock dependency). Fixed.
- V2 Meaningful assertions: 2 tests (OPENCODE_ALLOW_ALL_MODELS bypass in models.test.ts) set a missing command, so they would have passed even if the bypass were removed (probe failure also returns the configured model). Fixed by asserting the probe is never invoked. 1 test (execute.test.ts format check) used bare `rejects.toThrow()`; tightened.
- V4 Isolation: execute.test.ts shared a hoisted mock without reset in the first describe; added mockReset and a no-probe assertion.
- V5: partial mocks use importActual/importOriginal throughout; execute.remote.test.ts and test.remote.test.ts hand-mock several execution-target functions on top of actual exports (acceptable). test.remote.test.ts mocks prepareAdapterExecutionTargetRuntime wholesale, so it verifies wiring, not staging.
- V1, V6, V8, V9: no blocking defects. Minor: execute.remote.test.ts first test is long with many assertions (V6).

## 5 Summary of results
| path | tests | verdict | defect codes | action |
|---|---|---|---|---|
| packages/adapters/opencode-local/src/index.test.ts | 4 | VALID | - | none |
| packages/adapters/opencode-local/src/server/execute.remote.test.ts | 3 | VALID_WITH_NOTES | V6 | none; first test asserts many concerns |
| packages/adapters/opencode-local/src/server/execute.test.ts | 7 | REWRITTEN | V2, V4 | mockReset added, format test asserts message and no probe call |
| packages/adapters/opencode-local/src/server/models.test.ts | 10 | REWRITTEN | V3, V2 | deterministic missing-command mock; bypass tests assert no discovery |
| packages/adapters/opencode-local/src/server/parse.test.ts | 3 | VALID_WITH_NOTES | V7 | none; gaps listed below |
| packages/adapters/opencode-local/src/server/runtime-config.test.ts | 14 | VALID | - | none |
| packages/adapters/opencode-local/src/server/test.remote.test.ts | 1 | VALID | - | none |

## 6 Per-test detail (non-clean tests)
| file | test | code | finding | action |
|---|---|---|---|---|
| models.test.ts | returns an empty list when discovery command is unavailable | V3 | real spawn + real retry sleeps, timed out at 5 s | mocked runChildProcess rejection; asserts it was called |
| models.test.ts | proceeds with the configured model when discovery cannot run | V3 | same wall-clock dependence (4.9 s) | mocked rejection, console.warn silenced |
| models.test.ts | skips the availability check when OPENCODE_ALLOW_ALL_MODELS is set in the run env | V2 | passed even without the bypass | spy asserts probe not called |
| models.test.ts | honours OPENCODE_ALLOW_ALL_MODELS from the process env | V2 | same | spy asserts probe not called |
| execute.test.ts | still enforces provider/model format even when the bypass flag is set | V2 | bare toThrow() | asserts error message and no process call |
| parse.test.ts | (file) | V7 | no tests for malformed JSON lines, empty stdout, multiple text parts | gap noted |

## 7 Evaluation and recommendations
- No suspected production bugs. Observation: on Windows a missing command surfaces after multi-second delay (spawn/retry path), not a test concern after the fix.
- Coverage gaps: parseOpenCodeJsonl (non-JSON lines, empty input, tool_use success); parseOpenCodeModelsOutput (dedupe, malformed lines, sorting) and discoverOpenCodeModelsCached (TTL, volatile env key exclusion) have no direct tests; local execute() path has no test (only remote); skills.ts untested.
- index.test.ts test name says "upstream Codex mini model"; the default remains a fork-retained constant, assertion is by constant so it is valid.

## 8 Summary of activities
- models.test.ts rewritten: added mockMissingCommand helper; 4 tests made deterministic or strengthened.
- execute.test.ts rewritten: beforeEach mockReset; format test asserts message and that the remote probe was not run.
- Deletions: none.
- Commands: `npx vitest run packages/adapters/opencode-local` (before: 2 failed incl. dist mirror, ENV-triggered timeout); `npx vitest run .../models.test.ts .../execute.test.ts` after edits: 17 passed; models.test.ts rerun: 10 passed.

## 9 Approvals
Prepared by: ____________  Reviewed by: ____________  Date: ________
