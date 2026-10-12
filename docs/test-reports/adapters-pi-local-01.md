# Test Summary Report: adapters-pi-local-01 (IEEE 829)

## 1 Report identifier and scope
- Shard: adapters-pi-local-01; project packages/adapters/pi-local; 4 files; 35 test cases (execute.remote 6, models 3, parse 13, runtime-config 13); date: see git.

## 2 Summary
All four files assessed against rubric V1-V9 with the production source (execute.ts, models.ts, parse.ts, runtime-config.ts). Verdicts: VALID 1 (parse), VALID_WITH_NOTES 1 (execute.remote), REWRITTEN 2 (models, runtime-config). No obsolete tests, no suspected production bugs.

## 3 Variances
- Windows host. execute.remote mocks all SSH/process IO, so it is platform-neutral. Remote paths are literal POSIX strings by design.
- In one run of the whole pi-local project, models.test "returns an empty list when discovery command is unavailable" timed out at 5000 ms (ENV: Windows spawn-failure latency under parallel load). It passed when the server directory was run alone and after the edit. Not retried or loosened.

## 4 Comprehensive assessment
- V2 (1): models "rejects when discovery cannot run" used bare toThrow(), which passes on any error. Tightened.
- V4 (1 file, 13 tests): runtime-config tests assumed ambient PAPERCLIP_PI_PROVIDERS unset. Added env isolation.
- V3 (1 note): models test spawns a real missing command; latency depends on host load (5 s default timeout).
- V5: execute.remote uses importActual partial mocks (good); SUT not mocked.
- V6/V9 (notes): execute.remote repeats a large execute() input fixture 6 times; models test "returns an empty list" does not isolate PAPERCLIP_PI_COMMAND beyond afterEach.
- V7 gaps: no test for models parseModelsOutput/dedupe/sort/cache TTL (needs a fake pi command; not cheap); no test of empty-string env override resolving to placeholder-intact; remote tests do not assert cleanup on runChildProcess failure.
- V1: no stale upstream or default-adapter assumptions found; fixture repo URLs (github.com/paperclipai/paperclip) are inert test data.

## 5 Summary of results
| path | tests | verdict | defect codes | action |
|---|---|---|---|---|
| packages/adapters/pi-local/src/server/execute.remote.test.ts | 6 | VALID_WITH_NOTES | V9 | none; fixture duplication noted |
| packages/adapters/pi-local/src/server/models.test.ts | 3 | REWRITTEN | V2, V3 | assertion tightened to the real "Failed to start command" error |
| packages/adapters/pi-local/src/server/parse.test.ts | 13 | VALID | none | none |
| packages/adapters/pi-local/src/server/runtime-config.test.ts | 13 | REWRITTEN | V4 | env isolation for PAPERCLIP_PI_PROVIDERS added |

## 6 Per-test detail
| file | test | code | finding | action |
|---|---|---|---|---|
| models.test.ts | rejects when discovery cannot run for configured model | V2 | bare toThrow() cannot distinguish the intended failure | now matches /Failed to start command "__paperclip_missing_pi_command__"/ |
| models.test.ts | returns an empty list when discovery command is unavailable | V3 | real spawn; timed out once under load on Windows (ENV) | noted |
| runtime-config.test.ts | all 13 | V4 | depended on ambient process.env.PAPERCLIP_PI_PROVIDERS | beforeEach deletes it, afterEach restores |
| runtime-config.test.ts | "ignores malformed..." and "surfaces a note when ... invalid JSON" | V9 | near-duplicate (different invalid string, same assertion) | kept |
| execute.remote.test.ts | all 6 | V9 | repeated large input literal | noted |
| execute.remote.test.ts | starts a fresh session when header is empty / head fails | V2 | only asserts session differs from the stale id (weaker than the stale-cwd test which also asserts the managed path) | noted; not widened or changed |

## 7 Evaluation and recommendations
- No product findings; behaviour (managed workspace path, session identity check, provider config warnings) matches current source.
- Recommend a shared fixture builder for execute.remote and a fake-`pi` script test for model parsing/caching.
- Consider a per-test timeout on the models spawn tests for Windows.

## 8 Summary of activities
- models.test.ts: tightened error matcher (V2).
- runtime-config.test.ts: isolate PAPERCLIP_PI_PROVIDERS (V4).
- No deletions.
- Commands: `npx vitest run packages/adapters/pi-local` (68 pass, 2 fail in other files incl. one models timeout, ENV); `npx vitest run packages/adapters/pi-local/src/server` (35 pass); after edits `npx vitest run` on models+runtime-config (16 pass).

## 9 Approvals
Prepared by: ____________  Reviewed by: ____________  Approved by: ____________
