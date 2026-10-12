# Test Summary Report: shard adapter-utils-03

Format: IEEE 829 test summary report. Quality rubric: ISO/IEC/IEEE 29119 and ISTQB (V1 to V9).

## 1 Report identifier and scope

| Item | Value |
| --- | --- |
| Report id | adapter-utils-03 |
| Project | `packages/adapter-utils` (vitest project `@paperclipai/adapter-utils`) |
| Subject | Login-runner lifecycle, MCP isolation, remote (SSH) and sandbox managed runtime, sandbox callback bridge, native file sync, sandbox npm install command, runtime progress, inherited-env sanitising |
| Files in shard | 9 |
| Test cases | 145 (it.each expansions counted: 2 + 4 in `sandbox-managed-runtime.test.ts`) |
| Baseline | current `develop` (hard fork, no longer upstream paperclipai code) |
| Date | see git |

Test count per file (after edits): login-runner-lifecycle 16, mcp-isolation 3, remote-managed-runtime 3, runtime-progress 16 (12 original + 4 added), sandbox-callback-bridge 37, sandbox-file-sync 11, sandbox-install-command 4 (3 + 1 added), sandbox-managed-runtime 52, server-utils-env 3 (1 + 2 added). Original total: 138. Added: 7. Deleted: 0.

## 2 Summary

Every file was read completely and checked against the production module it exercises (`login-runner-lifecycle.ts`, `runtime-progress.ts`, `remote-managed-runtime.ts`, `sandbox-install-command.ts`, `sandbox-managed-runtime.ts`, `sandbox-callback-bridge.ts`, `server-utils.ts#sanitizeInheritedPaperclipEnv`, the acpx fixtures under `scripts/mcp-fixtures`).

No file tests upstream-only behaviour. The subjects all exist in the fork and the assertions match current behaviour. No suspected production bug requires a product decision. One host-portability finding (production code uses `path.posix` on host paths, so Windows hosts are unsupported by these paths) is recorded in section 7 as an observation, not a test defect.

Verdict counts: VALID 0, VALID_WITH_NOTES 2, REWRITTEN 7, OBSOLETE_REMOVED 0, NEEDS_DECISION 0.

## 3 Variances

- The machine is Windows 11 with no usable POSIX toolchain for node (`/bin/sh`, `sh -c`, GNU `cp -a`, bsdtar quirks, symlink privilege). Section 5 files that depend on these cannot pass here. All such failures were classified ENV and root-caused (below); none is a REAL failure.
- `sandbox-callback-bridge.test.ts`: 28 of 37 pass on Windows. The 9 that fail all need the in-test `createExecRunner` (hard-wired to `/bin/sh`) or host `tar`. Before my edit, a first run showed 12 failures; the 3 extra were load-sensitive timing flakes (50 ms / 200 ms iteration timeouts), which did not recur. See V3.
- `sandbox-managed-runtime.test.ts`: 11 of 52 pass on Windows. The failures are: `EPERM` on `symlink` (no developer-mode privilege), `sync operation source path is not a confined absolute path: C:\...` (production confinement uses `path.posix`, so a Windows host path is rejected by design), and 5 s test timeouts because `execFile("sh", ...)` never resolves. All ENV.
- `sandbox-file-sync.test.ts`: 5 of 11 pass (all `assertSyncOperationsConfined` cases). The 6 native-sync tests need `cp` and `sh` and symlinks. ENV.
- `remote-managed-runtime.test.ts`: 1 of 3 passes. The other 2 fail because production `prepareRemoteManagedRuntime` checks a host `localPath` with `path.posix.isAbsolute`, which rejects `C:\...`. ENV (verified independent of my edit: the failure message is the production guard).
- `mcp-isolation.integration.test.ts`: 2 pass, 1 skipped (Codex CLI not installed). The Claude CLI case ran against a real `claude` 2.1.296 and takes about 15 s because the CLI idles until the cap.
- No Linux run was possible (WSL Ubuntu exists but the checkout's `node_modules` are Windows binaries). Edits to the files that cannot run here were verified by `pnpm --filter @paperclipai/adapter-utils typecheck` (passes) and by vitest collecting all 52 / 37 / 11 cases without error. They must be confirmed by the t3-nightly slow-tests job on Linux.
- Not verified: Codex CLI branch of `mcp-isolation` (CLI absent).

## 4 Comprehensive assessment

Cross-cutting defects by rubric code (count = distinct findings in this shard).

| Code | Count | Summary |
| --- | --- | --- |
| V1 Validity | 1 | Two sandbox-managed-runtime tests set `PAPERCLIP_MULTI_PROJECT_WORKSPACE_SYNC=1`. Only `server/src/services/heartbeat.ts` reads that flag; `adapter-utils` does not, so the toggle was inert and its comment was misleading. Removed. |
| V2 Meaningful assertions | 7 | `login-runner-lifecycle`: two type-echo tests (literal compared to itself), a "disposes one time" test that only calls its own mock, a lifecycle-order test that orders its own calls, two late-rejection tests whose `expect(() => rejectWork()).not.toThrow()` cannot fail. `sandbox-managed-runtime`: `stagedContentSeen` push-then-assert tautology. `mcp-isolation`: silent `return` when a CLI is missing reports a pass. Plus loose regex alternations in confinement tests (see V7/V6). |
| V3 Determinism | 5 | Real timers with tight thresholds: bridge worker tests at 50 ms and 200 ms; negative assertions via `startedWithin(..., 300)`; fixed `setTimeout` sleeps of 50/250/300 ms; Claude CLI cap of 4 s killed slow startups. |
| V4 Isolation | 2 | `remote-managed-runtime`: `vi.clearAllMocks()` kept a per-test `mockImplementation`, leaking into the next test. `process.env` toggling in two managed-runtime tests (removed with V1). |
| V5 Mock fidelity | 1 | `remote-managed-runtime`: `./ssh.js` replaced by a hand-built four-export object. Now a partial mock via `importOriginal`. Remaining mocks are interface-faithful (`node:fs` already uses `importOriginal`). |
| V6 Clarity | 2 | Confinement tests accepted two error messages via `a\|b` regex although the code path is deterministic. Test name "installs globally as root" matched an `elif` fragment by suffix. |
| V7 Coverage balance | 4 gaps | `runtime-progress` (custom step/interval, zero total, clamp, explicit complete/fail args), `sanitizeInheritedPaperclipEnv` (allow-list, look-alike prefixes, non-mutation), `buildSandboxNpmInstallCommand` (bootstrapped branch skips sudo). Added cheaply. Remaining gaps in section 7. |
| V8 Portability | 4 files | POSIX-only (`/bin/sh`, `sh -c`, `cp -a`, `tar`, symlinks, `git`) in bridge, managed-runtime, file-sync, install-command. Unguarded. Noted, not skipped (skips would hide ENV failures; CI is Linux). One genuine portability bug fixed in `mcp-isolation` (unquoted paths with spaces in the acpx agent command). |
| V9 Maintainability | 3 | Eight copies of a `waitFor` helper in the bridge test (hoisted to one). About eight near-identical in-memory queue client literals and about twenty near-identical filesystem client literals remain (noted, not refactored: large diff, no behaviour defect). One unused variable (`directories`) removed. |

## 5 Summary of results

| Path | Tests | Verdict | Defect codes | Action taken |
| --- | --- | --- | --- | --- |
| packages/adapter-utils/src/login-runner-lifecycle.test.ts | 16 | REWRITTEN | V2 | Late-rejection tests now collect real `unhandledRejection` events; outcome and result tests made structural (exact key set; compile-time `Record`/`satisfies`). Two tautologies left, noted. Passes (16/16). |
| packages/adapter-utils/src/mcp-isolation.integration.test.ts | 3 | REWRITTEN | V2, V3, V8 | Missing CLI now `ctx.skip(...)` instead of silent pass; acpx agent command paths quoted (spaces); Claude cap 4 s to 15 s, test timeout 20 s to 30 s. Passes here: 2 pass, 1 skip (Codex absent). |
| packages/adapter-utils/src/remote-managed-runtime.test.ts | 3 | REWRITTEN | V4, V5 | `./ssh.js` mock now partial (`importOriginal`); `resetAllMocks` replaces `clearAllMocks`. 1 pass, 2 ENV fail (Windows path guard in production code). |
| packages/adapter-utils/src/runtime-progress.test.ts | 16 | REWRITTEN | V7 | Added 4 tests for gaps. Passes (16/16). |
| packages/adapter-utils/src/sandbox-callback-bridge.test.ts | 37 | VALID_WITH_NOTES | V3, V8, V9 | Hoisted 8 duplicate `waitFor` copies into one helper; removed unused variable. 28 pass, 9 ENV fail (`/bin/sh`, `tar`). |
| packages/adapter-utils/src/sandbox-file-sync.test.ts | 11 | REWRITTEN | V6, V8 | Parent-traversal confinement test tightened to the one correct message. 5 pass, 6 ENV fail. |
| packages/adapter-utils/src/sandbox-install-command.test.ts | 4 | REWRITTEN | V6, V7 | Root-branch assertion now anchors on `elif`; added bootstrapped-branch test. Passes (4/4). |
| packages/adapter-utils/src/sandbox-managed-runtime.test.ts | 52 | VALID_WITH_NOTES | V1, V2, V3, V6, V8, V9 | Removed inert env toggle (2 tests), removed tautology, tightened 2 confinement regexes. Many ENV failures on Windows (11 pass). Notes recorded below. |
| packages/adapter-utils/src/server-utils-env.test.ts | 3 | REWRITTEN | V7 | Added allow-list and non-mutation tests. Passes (3/3). |

Verdict basis: `sandbox-managed-runtime` and `sandbox-callback-bridge` received hygiene edits only (their substantive suites are unchanged and cannot run on this host), so they are VALID_WITH_NOTES. The other seven files had defects fixed or tests added and are REWRITTEN.

## 6 Per-test detail (tests that are not clean)

| File | Test | Code | Finding | Action |
| --- | --- | --- | --- | --- |
| login-runner-lifecycle | LoginRunnerOutcome names the four terminal outcomes | V2 | Compared a literal array to its own size. | Rewritten as exact `Record<LoginRunnerOutcome, true>` (typecheck fails if a member is added or removed). |
| login-runner-lifecycle | LoginRunnerResult carries the fixed status fields | V2 | Echoed a literal. | Now `satisfies LoginRunnerResult` plus exact key set (documents the "no URL/code/token field" contract). |
| login-runner-lifecycle | consumes a late work rejection (pre-aborted signal) | V2 | `expect(() => rejectWork()).not.toThrow()` cannot fail. | Asserts no `unhandledRejection` is emitted after the late rejection. |
| login-runner-lifecycle | consumes a late work rejection (timeout) | V2 | Same. | Same fix. |
| login-runner-lifecycle | disposes a driver one time | V2 | Calls its own mock directly; the SUT has no dispose invoker. | Left, noted: cannot be made meaningful without production code. |
| login-runner-lifecycle | races to a terminal state, then disposes the driver | V2 | The test sequences `dispose` itself; only the race half tests the SUT. | Left, noted. |
| login-runner-lifecycle | timeout cases | V3 | 5 ms real timer against a never-settling promise. | Acceptable (cannot flake into a wrong result); noted. |
| mcp-isolation | Claude and Codex cases | V2 | `if (!version) return;` reported a pass when the CLI is absent. | `ctx.skip(reason)`. |
| mcp-isolation | passes disjoint MCP server sets through acpx | V8 | Agent command string unquoted; paths with spaces broke spawn on Windows. | Quoted both paths. |
| mcp-isolation | keeps concurrent Claude CLI MCP configs strict | V3 | 4 s kill cap truncated slow startups before MCP connect (failed here). | Cap 15 s (upper bound only; CLI exits after the stub 401). |
| mcp-isolation | keeps concurrent Claude CLI MCP configs strict | V9 | Version gate `^2.1.(\d+)` and `>= 207` pin the CLI line; Claude 2.2 or 3 would fail. | Not changed (widening a matcher is out of scope); see section 7. |
| remote-managed-runtime | stages each additional project... | V4 | `mockImplementation` leaked into the next test (`clearAllMocks`). | `resetAllMocks` (restores the default impls from `vi.fn(impl)`; verified in a scratch test). |
| remote-managed-runtime | all | V5 | Hand-built `ssh.js` stand-in. | Partial mock via `importOriginal`. |
| remote-managed-runtime | stages each additional... / skips a relative path | V8 (ENV) | Fails on Windows: production guard `path.posix.isAbsolute(localPath)` rejects `C:\`. | None (production behaviour). |
| runtime-progress | (gaps) | V7 | No test of `stepPercent`, `minIntervalMs`, zero total, percent clamp, explicit `complete/fail` bytes. | Added 4 tests. |
| sandbox-callback-bridge | 8 tests with a local `waitFor` | V9 | Identical helper pasted 8 times. | One describe-level helper. |
| sandbox-callback-bridge | round-trips localhost bridge requests... | V9 | Unused `directories` variable. | Removed. |
| sandbox-callback-bridge | times out a stalled poll...; trips the watchdog...; processes a fast request with no false-positive timeout | V3 | Real wall-clock thresholds (50 ms, 50 ms, 200 ms) over real filesystem. First Windows run failed 3 of these; second did not. | Not changed; flagged for Linux CI stability watch. |
| sandbox-callback-bridge | writes fast 503...; serializes remote response writes...; processes a fast request | V3 | Fixed sleeps (250/300 ms) and bounded 5 ms polling used to prove absence of late writes. | Left; negative-by-sleep assertions are inherent. |
| sandbox-callback-bridge | 9 tests (round-trips, serializes, rejects non-JSON, 502 timeout, 502 malformed, entrypoint hash reuse, corrupted entrypoint, process-session script x2) | V8 | `createExecRunner` hard-codes `/bin/sh` and host `tar --no-xattrs`. | ENV on Windows; left. |
| sandbox-file-sync | rejects a parent-traversal escape | V6 | Regex `confined absolute path\|escapes its confinement root`; `path.posix.normalize` makes the outcome deterministic (`escapes its confinement root`). | Tightened. |
| sandbox-file-sync | 6 native-sync tests | V8 | Need `cp -RL/-a`, `sh -c`, symlinks. | ENV; left. |
| sandbox-install-command | installs globally as root, via sudo..., | V6 | Asserted `if [ "$(id -u)" -eq 0 ]...` which only matched because the code emits `elif`. | Anchored on `elif`. |
| sandbox-install-command | (gap) | V7 | Bootstrapped-npm branch (must not use sudo) untested. | Added test (also asserts it precedes the sudo branch). |
| sandbox-managed-runtime | authors the advisory access intent ro...; stages multiple referenced projects... end-to-end | V1, V4 | Set `PAPERCLIP_MULTI_PROJECT_WORKSPACE_SYNC` which `adapter-utils` never reads. | Env toggle removed; comment corrected. |
| sandbox-managed-runtime | round-trips a non-codex asset through generic provision + restore contributions | V2 | `stagedContentSeen.push("provisioned")` then `expect(...).toEqual(["provisioned"])`. | Removed (the real assertions on the extracted files remain). |
| sandbox-managed-runtime | the merged workspace confine guard covers both tar mappings | V6 | Two regexes accepted either error message. | Tightened to `escapes its confinement root`. |
| sandbox-managed-runtime | keeps the sandbox runtime core free of Codex-specific string literals | V2 / V6 | Greps the production source text. An architecture fitness check, not behaviour. | Kept, noted: a rename of the file or a comment containing the word fails it. |
| sandbox-managed-runtime | five-operation bound; serial order; absent-start checks | V3 | `startedWithin(..., 300)` is a negative-by-timeout assertion. A slow machine can only false-pass, never false-fail. | Left. |
| sandbox-managed-runtime | 41 tests | V8 | Need `sh`, `tar`, `git`, symlinks and a POSIX host path. | ENV on Windows; left. |

## 7 Evaluation and recommendations

Product findings (observations; none require a test to be bent):

1. Host-path handling uses `path.posix` in `remote-managed-runtime.ts` (`isAbsolute(localPath)`) and in `assertSyncOperationsConfined` for host-side source paths. A Windows host would reject every real local path. If Windows hosts are ever a supported control-plane OS, these guards need `path.isAbsolute` for local paths. The fork's deployment target is Linux (kmv8), so this is low priority; recorded for the product owner.
2. The server-side kill-switch `PAPERCLIP_MULTI_PROJECT_WORKSPACE_SYNC` (`server/src/services/heartbeat.ts`) is the only reader. Tests of this package should never need it.

Coverage gaps (not added, because they need production-side doubles or are not cheap):

- `login-runner-lifecycle.ts` has no dispose-invoking helper, so "the runner disposes the driver exactly once on every terminal state" is untestable here; it must be covered by the two concrete login-runner packages. Recommend a test there (or move the contract into this module) and then delete the two tautological dispose tests.
- `sandbox-callback-bridge`: no test for the in-sandbox server rejecting a missing `authorization` header (only a wrong token), and no test for oversized request bodies.
- `sandbox-managed-runtime`: ~20 inline filesystem client literals and ~8 in-memory bridge queue clients are near-duplicates. A shared `makeFilesystemClient()` (one already exists at the top of the file and is used by only 5 tests) would remove about 600 lines. Deferred as a drive-by refactor.
- Recommend a Windows-skip guard (`describe.skipIf(process.platform === "win32")`) for the POSIX-only suites only if the team wants local Windows runs to be quiet; CI is Linux so it was not added.
- Watch the three bridge tests with 50 ms to 200 ms thresholds (section 6) in t3-nightly; if they flake, make the thresholds injectable fake timers rather than widening them.
- The Claude CLI version pin in `mcp-isolation` should become a minimum-version comparison (`>= 2.1.207`) rather than a `2.1.x` regex.

Overall: the shard's assertions are valid for the current fork. No obsolete tests were found.

## 8 Summary of activities

Files rewritten (test files only; no production code, config or snapshots touched):

- `login-runner-lifecycle.test.ts`: real unhandled-rejection detection; structural contract tests.
- `mcp-isolation.integration.test.ts`: explicit skip, quoted agent command, realistic Claude timeout cap.
- `remote-managed-runtime.test.ts`: partial `ssh.js` mock, full mock reset between tests.
- `runtime-progress.test.ts`: +4 tests (custom step/interval, zero total, clamp, explicit complete/fail bytes).
- `sandbox-callback-bridge.test.ts`: single shared `waitFor`; unused variable removed.
- `sandbox-file-sync.test.ts`: confinement matcher tightened.
- `sandbox-install-command.test.ts`: `elif` anchor, +1 test.
- `sandbox-managed-runtime.test.ts`: inert env toggle removed (and test bodies re-indented), tautology removed, 2 matchers tightened.
- `server-utils-env.test.ts`: +2 tests.

Deletions: none (no test removed; one tautological assertion pair inside a test removed, justified in section 6).

Commands run (repo root, one vitest process at a time) and outcomes:

| Command | Outcome |
| --- | --- |
| `npx vitest run packages/adapter-utils/src/login-runner-lifecycle.test.ts` | 16 passed |
| `npx vitest run packages/adapter-utils/src/mcp-isolation.integration.test.ts` | 2 passed, 1 skipped (Codex CLI absent); about 21 s |
| `npx vitest run packages/adapter-utils/src/remote-managed-runtime.test.ts` | 1 passed, 2 failed (ENV: Windows path guard) |
| `npx vitest run packages/adapter-utils/src/runtime-progress.test.ts packages/adapter-utils/src/sandbox-install-command.test.ts packages/adapter-utils/src/server-utils-env.test.ts` | 23 passed |
| `npx vitest run packages/adapter-utils/src/sandbox-callback-bridge.test.ts` | before edit 25 passed / 12 failed; after edit 28 passed / 9 failed (all ENV `/bin/sh` and `tar`) |
| `npx vitest run packages/adapter-utils/src/sandbox-file-sync.test.ts` | 5 passed, 6 failed (ENV: `cp`, `sh`, symlink) |
| `npx vitest run packages/adapter-utils/src/sandbox-managed-runtime.test.ts` | 11 passed, 41 failed (ENV: symlink EPERM, posix confinement, `sh` timeouts) |
| `pnpm --filter @paperclipai/adapter-utils typecheck` | passed |
| scratch vitest (deleted) | confirmed `vi.resetAllMocks()` restores `vi.fn(impl)` defaults in vitest 4.1.10 |

## 9 Approvals

| Role | Name | Signature | Date |
| --- | --- | --- | --- |
| Test author / reviewer | | | |
| Quality assurance | | | |
| Product owner | | | |
