# Test Summary Report: adapters-cursor-local-01

## 1 Report identifier & scope
- Shard: adapters-cursor-local-01
- Project: packages/adapters/cursor-local (t3-nightly slow-tests)
- Files: 4; test cases: 8 (7 original + 1 added). Date: see git.

## 2 Summary
All four files read in full against `execute.ts`, `remote-command.ts`, `test.ts`. Subject code exists and is fork-compatible (no upstream-only or stale-default assertions found). Verdicts: VALID 0, VALID_WITH_NOTES 3, REWRITTEN 1, OBSOLETE_REMOVED 0, NEEDS_DECISION 0.

## 3 Variances
Windows host. The sandbox-runner tests spawn `#!/bin/sh` fake agents and use POSIX paths, so they fail here (classified ENV, see section 8). They could not be verified dynamically; they are expected to pass on the Linux nightly runner. Files were not edited, so no re-run was required.

## 4 Comprehensive assessment
- V1 Validity: 0 defects.
- V2: 1 weak assertion (`runMeta.find(Boolean)` in execute.test.ts, effectively first meta entry).
- V3 Determinism: 0 (no sleeps/ports; real child processes with 30s bounds).
- V4 Isolation: 0 (HOME restored in finally; temp dirs removed). Note: `setPrepareCursorSandboxCommand` is mockReset at test start, not restored after.
- V5 Mock fidelity: 0; mocks use importActual partials. execute.test.ts hand-rolled runner returns a stand-in result for `sh` probes (already updated in #160 for file reads); fragile regex `wc -c|dd if=`.
- V6: 1 (`expect` inside a mock implementation in execute.test.ts, failures could surface as caught errors rather than assertion failures; and a misaligned indentation block).
- V7 Coverage: 1 gap fixed (resume only "when identity matches" tested only positive case). Remaining gaps listed in section 7.
- V8 Portability: 3 files POSIX-only (sh scripts, `:` PATH, posix paths) with no platform guard.
- V9: duplicated sandbox runner helpers across execute.test.ts, test.test.ts, remote-command.test.ts.

## 5 Summary of results
| path | tests | verdict | defect codes | action |
|---|---|---|---|---|
| packages/adapters/cursor-local/src/server/execute.remote.test.ts | 4 (3 + 1 added) | REWRITTEN | V7 | Added negative resume test (SSH identity mismatch) |
| packages/adapters/cursor-local/src/server/execute.test.ts | 2 | VALID_WITH_NOTES | V2, V6, V8, V9 | None |
| packages/adapters/cursor-local/src/server/remote-command.test.ts | 2 | VALID_WITH_NOTES | V7, V8, V9 | None |
| packages/adapters/cursor-local/src/server/test.test.ts | 1 | VALID_WITH_NOTES | V7, V8, V9 | None |

## 6 Per-test detail
| file | test | code | finding | action |
|---|---|---|---|---|
| execute.remote.test.ts | resumes saved Cursor sessions ... only when the identity matches | V7 | Title promised a conditional but only the matching case was tested | Added "does not resume ... differs" test |
| execute.test.ts | reruns sandbox command resolution after managed runtime setup... | V2/V6 | `runMeta.find(Boolean)` is just the first meta; `expect` inside mockImplementation; misindented return block; regex-based stub of runner `sh` calls couples to implementation | Noted only |
| execute.test.ts | installs the default agent command on a fresh sandbox lease... | V8 | Needs POSIX sh | Noted |
| remote-command.test.ts | both tests | V7/V8 | Only happy paths; no test for no-hint/`$HOME` fallback, cursor-agent basename preference, absolute-path command bypass, non-sandbox target passthrough, nonzero probe exit | Noted |
| test.test.ts | re-resolves the installed agent... | V7/V8 | Only pass path; no failing version probe / missing agent case | Noted |

## 7 Evaluation & recommendations
- No suspected production bugs.
- Coverage gaps (not added, non-trivial): `prepareCursorSandboxCommand` early returns (non-sandbox target, no home), `cursor-agent` ordering, `isDefaultCursorCommand`; testEnvironment failure branches; execute retry path "resume session unavailable" (execute.ts ~742).
- Consider extracting one shared local-sandbox-runner helper and a `describe.skipIf(process.platform === "win32")` guard for POSIX-only suites (a maintainer decision).

## 8 Summary of activities
- Rewritten: execute.remote.test.ts, added one negative test (mismatched host still yields no `--resume`).
- Deletions: none.
- `npx vitest run .../execute.remote.test.ts`: 4/4 passed.
- `npx vitest run` on execute.test.ts, remote-command.test.ts, test.test.ts (unedited, run for classification): 5 failures, all ENV (Windows): "Failed to start command sh", sandbox sync path not a confined absolute path (`C:\...`), POSIX path expectations (`agent` vs absolute path), testEnvironment fail due to sh install simulation.

## 9 Approvals
Prepared by: ____________  Reviewed by: ____________  Date: ________
