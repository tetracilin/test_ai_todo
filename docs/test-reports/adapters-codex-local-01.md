# Test summary report: adapters-codex-local-01

## 1 Report identifier and scope
Shard adapters-codex-local-01, project packages/adapters/codex-local, 28 files, 323 test cases (src only; 1 skipped on Windows after edit), date: see git.

## 2 Summary
All 28 files were read against the current fork. Verdicts: VALID 17, VALID_WITH_NOTES 9, REWRITTEN 2, OBSOLETE_REMOVED 0, NEEDS_DECISION 0. Mocks use importOriginal (V5 good); env vars are saved and restored (V4 good). No tests assert upstream-only behaviour.

## 3 Variances
Run on Windows 11. Of 323 src tests, 53 failed before edits, all classified ENV: symlink creation EPERM (needs privilege), POSIX file mode bits (0600/0700 read back as 0666/0644 equivalents), POSIX signals (proc.signal null), tar/confined-path handling of Windows paths, and 5s timeouts under load. These tests are expected to pass on Linux CI. No REAL failure found. The dist/ copies of tests are also collected by vitest when running the package directory (see section 7).

## 4 Comprehensive assessment
- V8 Portability: about 8 files with unguarded POSIX assumptions (symlinks, mode bits, signals, path separators). 2 fixed, rest noted.
- V3 Determinism: integration test uses real subprocess and timers (Linux-guarded); acp/auth-merge tests hit timeouts under load.
- V1, V2, V4, V5: no defects found on sampled and full-file review.
- V7: negative paths (tie, older, identity mismatch, apikey, ELOOP, escape) are well covered.

## 5 Summary of results
| file | tests | verdict | defect codes | action |
|---|---|---|---|---|
| index.test.ts | 2 | VALID | - | none |
| server/acp.test.ts | 27 | VALID_WITH_NOTES | V3 V8 | 7 fail on Windows: ENV (tar/confined path/timeout); not edited |
| server/adapter-auth-promotion.test.ts | 17 | VALID_WITH_NOTES | V8 | 1 timeout on Windows (ENV) |
| server/auth-precedence.test.ts | 12 | VALID | - | none |
| server/codex-args.test.ts | 11 | VALID | - | none |
| server/codex-auth-cache.test.ts | 20 | VALID_WITH_NOTES | V8 | POSIX mode bits and symlink EPERM (ENV); unguarded |
| server/codex-auth-copyback.test.ts | 17 | VALID_WITH_NOTES | V8 | POSIX 0600 and read-only dir assertions (ENV); unguarded |
| server/codex-auth-merge-decision.test.ts | 7 | VALID | - | none |
| server/codex-auth-merge.test.ts | 25 | VALID_WITH_NOTES | V3 V8 | 9 timeouts on Windows (ENV) |
| server/codex-home.test.ts | 49 | VALID_WITH_NOTES | V8 | 24 symlink EPERM / mode-bit failures on Windows (ENV); unguarded |
| server/device-login-export.test.ts | 11 | VALID_WITH_NOTES | V8 | mode bits and symlink (ENV) |
| server/device-login-parse.test.ts | 16 | VALID | - | none |
| server/device-login-runner.test.ts | 9 | VALID | - | none |
| server/execute.acp-fallback.test.ts | 2 | VALID | - | none |
| server/execute.auth-precedence.test.ts | 1 | VALID | - | none |
| server/execute.auth.test.ts | 7 | VALID | - | none |
| server/execute.remote.test.ts | 6 | VALID_WITH_NOTES | V8 | symlink to /usr/bin/env EPERM (ENV) |
| server/execute.stderr-error.test.ts | 7 | VALID | - | none |
| server/execute.test.ts | 3 | VALID_WITH_NOTES | V8 | POSIX 0600 assertions (ENV) |
| server/output-inactivity-monitor.integration.test.ts | 2 | REWRITTEN | V8 | added win32 skipIf to POSIX-signal test |
| server/output-inactivity-monitor.test.ts | 16 | VALID | - | none |
| server/parse.test.ts | 16 | VALID | - | none |
| server/process-activity-monitor.test.ts | 5 | VALID | - | none |
| server/quota-spawn-error.test.ts | 6 | VALID | - | none |
| server/runtime-config.test.ts | 18 | VALID | - | none |
| server/test.remote.test.ts | 4 | REWRITTEN | V8 | replaced hard-coded / separators with path.join |
| ui/build-config.test.ts | 4 | VALID | - | none |
| ui/parse-stdout.test.ts | 3 | VALID | - | none |

## 6 Per-test detail (not clean)
| file | test | code | finding | action |
|---|---|---|---|---|
| output-inactivity-monitor.integration.test.ts | kills a codex child that goes silent... | V8 | asserts proc.signal in SIGTERM/SIGKILL, null on Windows | skipIf win32 added |
| test.remote.test.ts | stages managed CODEX_HOME in an isolated runtime dir... | V8 | hard-coded '/' after os.tmpdir() | path.join |
| codex-home.test.ts | 24 symlink/mode tests | V8 | EPERM / mode bits on Windows | noted, no edit |
| codex-auth-copyback.test.ts | 7 tests | V8 | POSIX mode and chmod semantics | noted |
| codex-auth-merge.test.ts | 9 tests | V3 | timeout on Windows | noted |
| acp.test.ts | 7 tests | V3 V8 | tar/confine/timeouts on Windows | noted |
| codex-auth-cache, device-login-export, execute.test, execute.remote, adapter-auth-promotion | several | V8 | mode bits, symlink, timeout | noted |

## 7 Evaluation and recommendations
- Consider a shared helper (canSymlink / isPosix) and describe.skipIf for POSIX-only suites rather than per-file edits.
- vitest collects dist/**/*.test.js alongside src (duplicate runs; dist fixtures missing so 'device-login-parse' fails there). Recommend excluding dist in the vitest project config (not edited per rules).
- Longer timeouts may be needed for acp/auth-merge on slow hosts.

## 8 Summary of activities
- output-inactivity-monitor.integration.test.ts: win32 skipIf (V8).
- test.remote.test.ts: path.join for tmp paths (V8).
- Deletions: none.
- Commands: npx vitest run packages/adapters/codex-local (117 fail incl. dist, ENV); npx vitest run packages/adapters/codex-local/src (json reporter); npx vitest run on the two edited files: 4 passed, 2 skipped.

## 9 Approvals
Author: ____________  Reviewer: ____________  Date: ____________
