# Test Summary Report: adapter-utils-04 (IEEE 829)

## 1 Report identifier and scope

- Report id: adapter-utils-04
- Project: packages/adapter-utils
- Files: 5 (server-utils, setup-token-transport, ssh-fixture, sync-operation-schedule, workspace-restore-merge)
- Test cases: 126 before edits, 132 after (server-utils 92 incl. 6 POSIX-only skipIf, setup-token-transport 9, ssh-fixture 16, sync-operation-schedule 7 -> 11 with table expansion, workspace-restore-merge 2 -> 4)
- Date: see git

## 2 Summary

All five files were read in full and compared with their production sources (server-utils.ts, setup-token-transport.ts, ssh.ts, sync-operation-schedule.ts, workspace-restore-merge.ts). All subjects still exist in the fork and assertions match current behaviour; no upstream-only or stale-default assertions were found (V1 clean). Verdicts: VALID 1, VALID_WITH_NOTES 2, REWRITTEN 2, OBSOLETE_REMOVED 0, NEEDS_DECISION 0.

## 3 Variances

- Platform is Windows. server-utils: 6 POSIX-only process-group/signal tests are skipped (by design, skipIf win32) and were not exercised here.
- ssh-fixture: most tests self-skip (log a warning and return) when sshd is unsupported. Whether the sshd fixture actually started on this machine was not verified; a "pass" there may mean "not run". Only the two pure tests (buildSshSpawnTarget) are certain to have executed.
- Unedited files were run once for baseline: server-utils 86 passed / 6 skipped, setup-token-transport 9 passed.

## 4 Comprehensive assessment

| Code | Count | Notes |
|---|---|---|
| V1 | 0 | none stale |
| V2 | 7 | ssh-fixture tests that silently return and report PASS when the fixture is unsupported (listed as one systemic item per test below); appendWithByteCap test is weak |
| V3 | 3 | setTimeout-based flush/300 ms sleeps in server-utils process tests and sync schedule (bounded, low risk); fixed 150 ms timing assertions |
| V4 | 1 | server-utils "noisy runs" test cleans its descendant only after assertions, so a failing assertion leaks a process |
| V5 | 0 | fakes (PTY session, deferred tasks) mirror their interfaces |
| V6 | 1 | misleading comment in sync-operation-schedule order test (fixed) |
| V7 | 4 | gaps: bound-floor path, baseline deletion paths (both added), appendWithByteCap boundary, snapshot builders not covering sourceStatus edge cases |
| V8 | 2 | Windows EPERM symlink in ssh-fixture (fixed); unguarded early-return on win32 in workspace-restore-merge (fixed with skipIf) |
| V9 | 2 | large repetitive prompt-string contains() assertions in server-utils (brittle to wording); repeated git repo setup block in ssh-fixture |

## 5 Summary of results

| Path | Tests | Verdict | Defects | Action |
|---|---|---|---|---|
| packages/adapter-utils/src/server-utils.test.ts | 92 (6 skipped on win32) | VALID_WITH_NOTES | V3, V4, V7, V9 | none; notes only |
| packages/adapter-utils/src/setup-token-transport.test.ts | 9 | VALID | none | none |
| packages/adapter-utils/src/ssh-fixture.test.ts | 16 | REWRITTEN (minor) | V2, V8, V9 | guarded Windows EPERM symlink creation |
| packages/adapter-utils/src/sync-operation-schedule.test.ts | 7 -> 11 | REWRITTEN | V6, V7 | fixed comment, added 4 bad-bound tests |
| packages/adapter-utils/src/workspace-restore-merge.test.ts | 2 -> 4 | REWRITTEN | V7, V8 | added 2 deletion-path tests, skipIf for socket test |

Note: ssh-fixture verdict is REWRITTEN because of the targeted V8 edit, but its V2 weakness remains (see 7).

## 6 Per-test detail (non-clean tests)

| File | Test | Code | Finding | Action |
|---|---|---|---|---|
| server-utils | does not clean up noisy runs that have no terminal output | V4 | descendant kill happens in finally only after the race and liveness assertions; fine on pass, but the spawned noise process lives until finally runs; acceptable since finally always executes | none |
| server-utils | does not clean up noisy runs... / kills descendant... / force-kills... | V3 | wall-clock waits (300 ms race, 2 s poll); bounded, win32-skipped | none |
| server-utils | keeps valid UTF-8 when trimming through multibyte text | V7 | starting buffer "prefix " is already 7 bytes, so the multibyte split is not really exercised | recommend larger cap |
| server-utils | keeps the default local-agent prompt action-oriented | V9 | 20 contains() on prompt wording; valid against current template but brittle | none |
| server-utils | waits for onSpawn before sending stdin | V3 | asserts elapsed wall time >= 150 ms; lower bound only, not flaky | none |
| ssh-fixture | all sshd-backed tests (12) | V2 | `if (!started) return;` reports PASS when the fixture cannot start | recommend ctx.skip() (not applied: rule against adding skips) |
| ssh-fixture | can dereference local symlinks while syncing to the remote fixture | V8 | failed on Windows with EPERM creating the symlink (ENV failure) | guard EPERM, warn and return, consistent with file convention; now passes |
| ssh-fixture | git-repo setup repeated in 6 tests | V9 | duplicated init/config/commit block | recommend helper |
| sync-operation-schedule | returns settled results in input order in ${mode} | V6 | comment claimed out-of-order settling, tasks settle immediately in order | comment corrected |
| workspace-restore-merge | ignores non-file entries when capturing snapshots | V8 | silent `return` on win32 reports PASS without running | changed to it.skipIf(win32), visible as skipped |

## 7 Evaluation and recommendations

- Product findings: none. No suspected production bugs.
- Coverage gaps closed: scheduleSyncOperations bound floor (0, negative, NaN, fractional all fall back to 1); mergeDirectoryWithBaseline deletes a baseline file removed from the source only when the target still matches the baseline, and preserves a concurrently edited file.
- Remaining gaps: lock handling in withDirectoryMergeLock (stale owner, timeout) is untested here; appendWithByteCap has a single weak case; symlink and mode-change entries in snapshots are untested.
- Recommend converting the ssh-fixture silent returns to explicit vitest skips (context.skip) so unsupported environments are reported as skipped, not passed; and extracting a shared git-repo setup helper.
- Server-side CI gap: this package's tests run in the non-server vitest groups, so these results are visible to t3-ci.

## 8 Summary of activities

Files rewritten:
- ssh-fixture.test.ts: guarded EPERM on Windows symlink creation (ENV failure, now passes).
- sync-operation-schedule.test.ts: corrected misleading comment; added 4 bad-bound cases.
- workspace-restore-merge.test.ts: added 2 deletion-path tests; skipIf(win32) on socket test.

Deletions: none.

Commands (all from repo root, one at a time):
- `npx vitest run packages/adapter-utils/src/server-utils.test.ts` -> 86 passed, 6 skipped
- `npx vitest run .../setup-token-transport.test.ts` -> 9 passed
- `npx vitest run .../ssh-fixture.test.ts` -> baseline 15 passed, 1 failed (ENV: Windows EPERM symlink); after edit 16 passed
- `npx vitest run .../sync-operation-schedule.test.ts` -> baseline 7 passed; after edit 11 passed
- `npx vitest run .../workspace-restore-merge.test.ts` -> baseline 2 passed; after edit 3 passed, 1 skipped (win32)

## 9 Approvals

Prepared by: ____________________  Date: __________

Reviewed by: ____________________  Date: __________

Approved by: ____________________  Date: __________
