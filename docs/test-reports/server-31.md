# Test Summary Report: shard server-31 (IEEE 829)

## 1 Report identifier and scope
- Identifier: server-31. Project: server (vitest). Date: see git.
- Files: 2. Test cases: 144 (128 + 16).
- Subject: workspace runtime (execution of runtime services, port reservation and ownership, server workspace link repair, shell resolution, embedded-Postgres startup reconciliation) and worktree config (legacy worktree config/env repair and port-registry handling).

## 2 Summary
Both files were read and checked against the production sources (services/workspace-runtime.ts, packages/shared/src/worktree-port-registry.ts and the worktree config repair). All subjects still exist and assertions match current fork behaviour.
Verdicts: VALID 0, VALID_WITH_NOTES 1, REWRITTEN 1, OBSOLETE_REMOVED 0, NEEDS_DECISION 0.
The rewrite of workspace-runtime.test.ts was reviewed by the verifier and kept (no assertion weakened).

## 3 Variances
- Windows host. worktree-config: 4-7 of 16 failed intermittently. Classified ENV: EPERM when renaming the port-registry lock owner.json (production code swallows the error).
- workspace-runtime baseline: 25 failed, 76 passed, 27 skipped of 128, all ENV (symlink EPERM, POSIX sh and pnpm assumptions, CRLF, Windows process termination, embedded-Postgres `beforeAll` timeouts). About 100 DB-backed tests did not execute here and were verified by reading only.
- The edited tests compile. A filtered re-run showed only the same ENV failures. The new realpath assertion could not be confirmed in a passing run (its test fails on symlink EPERM). The two edited unreachable-URL tests fail here on process termination, not on the new helper.

## 4 Comprehensive assessment (by rubric code)
- V1 Validity: 0 defects.
- V2 Meaningful assertions: 2 fixed. Three lsof/linux-guarded tests returned silently and passed with zero assertions when lsof was missing; the "skips relinking ... already point at the repo" test asserted nothing.
- V3 Determinism: 2 fixed (fixed 250 ms sleep before a single fetch-rejection check, in two tests), 1 noted (a deliberate real 60.25 s wall-clock wait in the fixed-port reservation test).
- V4 Isolation: 0 defects found.
- V5 Mock fidelity: 0 defects found.
- V6 Clarity: no change; file is very large (about 8,000 lines) in one module.
- V7 Coverage: no gaps added.
- V8 Portability: many POSIX-only assumptions unguarded (sh -c with Windows paths, #!/bin/sh stubs, symlinks, CRLF). Noted, not changed.
- V9 Maintainability: the file size and the repeated service/fixture setup make it hard to maintain; noted.

## 5 Summary of results
| path | tests | verdict | defects | action |
|---|---|---|---|---|
| server/src/__tests__/workspace-runtime.test.ts | 128 | REWRITTEN | V2, V3, V8 | silent lsof/linux early returns converted to `it.skipIf`; realpath assertion added to relink test; two 250 ms sleeps replaced by bounded poll helper `expectUrlEventuallyUnreachable`; many tests not runnable on this host (ENV) |
| server/src/__tests__/worktree-config.test.ts | 16 | VALID_WITH_NOTES | V8 | none; intermittent ENV failures on Windows (EPERM on lock rename) |

## 6 Per-test detail (non-clean tests)
| file | test | code | finding | action |
|---|---|---|---|---|
| workspace-runtime | detects the owner of a listening TCP port | V2 | Returned early and passed with no assertions when lsof was missing. | `it.skipIf(!lsofAvailable)` |
| workspace-runtime | keeps a live registry record adoptable when cwd inspection is unsupported | V2 | Same silent early return. | `it.skipIf(!lsofAvailable)` |
| workspace-runtime | refuses to adopt a listener whose real cwd belongs to another workspace | V2 | Silent returns for non-linux and missing lsof. | `it.skipIf(!lsofAvailable \|\| platform !== "linux")` |
| workspace-runtime | skips relinking when server workspace dependencies already point at the repo | V2 | No assertion at all. | Added realpath equality assertion |
| workspace-runtime | stops ... and persists controlled ... stops (two tests) | V3 | Fixed 250 ms sleep then one fetch rejection check; flaky under load. | Replaced with polling helper (5 s deadline, 50 ms interval) |
| workspace-runtime | fixed-port reservation test | V3 | Real 60.25 s wall-clock wait. | Kept, noted |
| workspace-runtime | whole file | V8 | POSIX shell stubs, symlinks, CRLF and process-termination assumptions without guards. | Noted |
| worktree-config | repair tests | V8 | Intermittent failures on Windows from EPERM renaming the lock owner.json. | Noted (product finding below) |

## 7 Evaluation and recommendations
- Product findings (not changed):
  - packages/shared/src/worktree-port-registry.ts `writeRegistryLockOwner`: `renameSync` over an existing file raises EPERM on Windows. `maybeRepairLegacyWorktreeConfigAndEnvFiles` swallows all errors silently, so port collisions go unrepaired with no warning.
  - `maybeRepairLegacyWorktreeConfigAndEnvFiles` reports `repairedEnv: true` even when the config repair threw, masking partial failure.
- Recommend splitting workspace-runtime.test.ts by concern, guarding POSIX-only tests with platform skips, and giving DB-backed describe blocks a larger shared `beforeAll` budget on slow hosts.
- The Windows support decision (symlinks, sh, lock rename) needs a product owner call.

## 8 Summary of activities
- Rewritten: workspace-runtime.test.ts (27 insertions, 28 deletions): items listed in section 6.
- Deletions: none. worktree-config.test.ts not edited.
- Commands: vitest on both files on Windows (results in section 3).

## 9 Approvals
Prepared by: ______________  Reviewed by: ______________  Approved by: ______________
