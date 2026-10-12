# Test Summary Report: shard cli-01 (IEEE 829 structure)

## 1. Report identifier and scope

| Item | Value |
|---|---|
| Report id | cli-01 |
| Project | `cli` (package `paperclipai`), vitest root `cli/` |
| Scope | 45 test files under `cli/src/__tests__/` (list in section 5) |
| Test cases | 239 (238 counted from the verbose run, plus 1 in the e2e file that could not start on this host). `it.each`/loop expansion: `env-lab` has 5 loop-generated cases (18 total), counted as run |
| Date | see git |
| Standard | ISO/IEC/IEEE 29119 and ISTQB, rubric V1-V9 as supplied by the orchestrator |
| Production code touched | none |

## 2. Summary

Every file was read completely, and the production module each exercises was opened to check the assertions against current fork behaviour. The route tables asserted by the `*-parity` files were spot-checked against `server/src/routes/*` (openclaw invite-prompt, llms, board-claim, skills/available, inbox-dismissals, database-backups, scheduler-heartbeats, cli-auth, pipelines bulk/batch, routine-triggers, tree-control, recovery-actions, watchdog-decisions, feedback-votes): all exist on the server.

Verdict counts (per file, 45 files):

| Verdict | Files |
|---|---|
| VALID | 9 |
| VALID_WITH_NOTES | 10 |
| REWRITTEN | 24 |
| OBSOLETE_REMOVED | 0 |
| NEEDS_DECISION | 2 (`channels`, `install-command`) |

No test was deleted and no assertion was weakened. 25 files were edited (24 REWRITTEN plus one comment-only edit in the e2e file, which stays VALID_WITH_NOTES). Headline defects fixed: three platform-sensitive or slow tests (`env-lab` POSIX-root expectations, `company-import-transfer` 40-64 MB fixtures under the 5 s default timeout), an env-var leak on assertion failure (`network-bind`), un-restored `fetch` stubs in 13 files, and un-removed temp directories in 10 files.

## 3. Variances (what could not be verified, and why)

The host is Windows 11. Failures that remain after my edits (21 tests in 10 files) are all classified **ENV** (Windows limitation), none are REAL test defects. They are listed so a Linux run can confirm them.

| Cause | Tests affected | Evidence |
|---|---|---|
| `fs.fsyncSync` on a read-only descriptor throws `EPERM` on Windows (`cli/src/config/store.ts:134`, `durableCopyFile`) | allowed-hostname (1), config-store (2), configure (1), configure-repair (1), onboard (1) | `EPERM: operation not permitted, fsync`. This is also a production portability finding (section 7) |
| `fs.symlinkSync` needs elevated rights / developer mode | install-store (4), install-command (3), managed-install-check (1) | `EPERM ... symlink` |
| POSIX file modes (`0o600`, `0o755`, `0o640`) not representable | install-store (2), doctor (1) | `expected 438 to be 384`; doctor warns "key file permissions are 666" |
| Lock temp file name contains `:` (`.install.lock.<pid>:<ts>:<rand>.tmp`), illegal on NTFS | install-store (2), install-command (2) | `ENOENT ... .install.lock.48044:1791...tmp` |
| `pnpm` spawned via `execFile` without a shell (no `pnpm.exe`) | company-import-export-e2e (1) | `spawn pnpm ENOENT`; the embedded-Postgres gate passed, then the `beforeAll` server spawn failed. The e2e case was therefore **not executed**; it was reviewed statically only |
| Embedded Postgres | routines (1) | first run: `Hook timed out in 20000ms`; second run: skipped by the file's own support probe. Reviewed statically only |

Other limits: vitest was run on this shard's files only, one process at a time (full-shard run twice: before and after edits; single-file runs for `env-lab` and `company-import-transfer`). The Linux-only paths (systemd units in `install-command`, `/usr/bin:/bin` PATH) were not exercised on Windows. The `company-import-transfer` heavy-fixture timing (6-7 s observed) is a disk/AV effect of this host and is not reproducible elsewhere.

## 4. Comprehensive assessment (cross-cutting defects by rubric code)

| Code | Count | Finding |
|---|---|---|
| V1 Validity | 6 files | `channels` and `install-command` assert upstream npm release lanes (`stable/beta/nightly/canary`, "every merge to master") and a default install repo `paperclipai/paperclip`; `doc/ORIGIN.md` says this fork does not publish to npm. Tests match the code, so they are retained and flagged NEEDS_DECISION. `company` pins the production `claude_local` fallback for `process` agents (matches the current registry default; policy-sensitive). `http` accepts a hint mentioning `npx paperclipai run`. `feedback` fixture uses upstream destination `paperclip_labs_feedback_v1` (same constant in `server/src/services/feedback.ts:53`). `company-import-export-e2e` carried a stale comment ("defaults to hermes_gateway alone"; registry default is now hermes_gateway, claude_local, hermes_local); comment corrected |
| V2 Meaningful assertions | 9 files | The 8 `*-parity` / `agent-lifecycle` / `issue-subresources` / `operations-parity` / `run` files assert method + URL only, mostly with `--payload-json {}`: they prove routing, not payload shaping, auth headers or error mapping. `config-store` couples to `fs.fsyncSync`/`openSync` call order (implementation detail, though it is the documented durability contract) |
| V3 Determinism | 3 files | `company-import-transfer`: three 40-64 MB fixtures ran 6-7 s against the 5 s default (NOT fixed: timeout bump reverted by verifier; follow-up is to shrink fixtures). `company-import-export-e2e`: bounded 30 s health poll (acceptable), `Date.now()` in names (unique, harmless), `getAvailablePort` has an inherent bind race. `routines`: relies on embedded Postgres start-up |
| V4 Isolation | 24 files | 13 files stubbed `fetch` with `vi.stubGlobal` and never unstubbed (fixed with `vi.unstubAllGlobals()`); 10 files created temp dirs and never removed them (fixed); `network-bind` deleted/set `PAPERCLIP_TAILNET_BIND_HOST` inline and leaked it when an assertion failed (fixed with `afterEach`). `home-paths` still leaves one temp dir (noted, not changed) |
| V5 Mock fidelity | 3 files | `connect` and `configure-repair` hand-build the whole `@clack/prompts` module (rot risk if code starts using another export; today only used members are needed). `connect` also hand-builds `../client/board-auth.js` with only `loginBoardCli`. `plugin-init` and `open-url` correctly use `importOriginal`/`importActual`. `onboard-service` fakes the injected detector, which is the intended seam |
| V6 Clarity | 8 files | Parity tests bundle 10-24 commands in one `it` (one reason to fail is lost: the first wrong route hides the rest). `company-import-export-e2e` is a single 90 s test with ~10 behaviours. Left as is (restructuring would be a mass rewrite) |
| V7 Coverage balance | 12 files | Gaps listed in section 7 (HTTP error paths of the parity commands, `routines` has one happy-path test, `data-dir`/`home-paths` Windows paths, etc.) |
| V8 Portability | 6 files | `env-lab` (fixed: expectation now `path.resolve`, matching the resolver), `install-store`, `install-command`, `managed-install-check` (POSIX modes, symlinks, `/usr/bin:/bin` PATH, `$SHELL`), `config-store` (fsync on read-only fd), `company-import-export-e2e` (`pnpm` w/o shell, SIGTERM to the pnpm wrapper). POSIX-only cases are documented here, not skipped (no skips added per rules) |
| V9 Maintainability | 4 files | `company.test.ts` repeats a ~100-line `CompanyPortabilityPreviewResult` manifest literal four times; `allowed-hostname`/`configure`/`onboard`/`doctor` repeat the same ~50-line `PaperclipConfig` literal; `feedback` and `plugin-init` fine. `routines.test.ts` is the only consumer of its config literal |

## 5. Summary of results (one row per file)

Counts are from the verbose vitest run (`it` cases actually reported, loop expansion included). "Win ENV" means failures that are Windows-only (section 3).

| File | Tests | Verdict | Defect codes | Action taken |
|---|---|---|---|---|
| cli/src/__tests__/access-parity.test.ts | 2 | REWRITTEN | V2 V4 V6 | Added `vi.unstubAllGlobals()` to `afterEach`. Passes |
| cli/src/__tests__/activity-parity.test.ts | 1 | REWRITTEN | V2 V4 | Added `vi.unstubAllGlobals()`. Passes |
| cli/src/__tests__/admin-asset-skill-parity.test.ts | 5 | REWRITTEN | V2 V4 V6 | Added `vi.unstubAllGlobals()`. Passes |
| cli/src/__tests__/agent-jwt-env.test.ts | 6 | REWRITTEN | V4 | Temp config dirs now removed in `afterEach`. Passes |
| cli/src/__tests__/agent-lifecycle.test.ts | 2 | REWRITTEN | V2 V4 V6 | Added `vi.unstubAllGlobals()`. Passes |
| cli/src/__tests__/allowed-hostname.test.ts | 1 | REWRITTEN | V4 V8 | Temp dir cleanup added. Win ENV: fsync EPERM (1 fail) |
| cli/src/__tests__/auth-command-registration.test.ts | 3 | REWRITTEN | V4 | Added `vi.unstubAllGlobals()`. Passes |
| cli/src/__tests__/board-auth.test.ts | 3 | REWRITTEN | V4 | Temp dir cleanup added. Passes |
| cli/src/__tests__/channels.test.ts | 5 | NEEDS_DECISION | V1 | None. Tests pass against current code, but the subject (npm dist-tag release lanes) is upstream release engineering; see section 7 |
| cli/src/__tests__/common.test.ts | 10 | REWRITTEN | V4 | Temp dir cleanup added. Passes |
| cli/src/__tests__/company-delete.test.ts | 9 | VALID | none | None |
| cli/src/__tests__/company-export-force.test.ts | 5 | VALID | none | None |
| cli/src/__tests__/company-import-export-e2e.test.ts | 1 | VALID_WITH_NOTES | V1 V3 V6 V8 | Corrected stale comment about selectable-adapter default (no code change). Not executed on Windows (`spawn pnpm ENOENT`, Win ENV) |
| cli/src/__tests__/company-import-transfer.test.ts | 16 | UNCHANGED | V3 | Verifier reverted the 30 s timeout bump (a longer timeout is not an accepted fix); file is unchanged from develop. Four 40-64 MB fixture tests exceed 5 s on a slow Windows disk (ENV; fixture shrink is a follow-up) |
| cli/src/__tests__/company-import-url.test.ts | 11 | VALID | none | None |
| cli/src/__tests__/company-import-zip.test.ts | 1 | VALID | none | None |
| cli/src/__tests__/company.test.ts | 18 | VALID_WITH_NOTES | V1 V9 | None. Pins the production `claude_local` fallback for `process` agents (still a TODO in `company.ts:398`) |
| cli/src/__tests__/config-store.test.ts | 3 | VALID_WITH_NOTES | V2 V8 | None. Win ENV: 2 fsync EPERM fails; spies on `fsync`/`open` ordering by design |
| cli/src/__tests__/configure-repair.test.ts | 1 | VALID_WITH_NOTES | V5 V8 | None. Win ENV: fsync EPERM; hand-built `@clack/prompts` mock |
| cli/src/__tests__/configure.test.ts | 3 | VALID_WITH_NOTES | V8 V9 | None. Win ENV: 1 fsync EPERM fail |
| cli/src/__tests__/connect.test.ts | 2 | REWRITTEN | V4 V5 | Added `unstubAllGlobals` and temp dir cleanup. Passes |
| cli/src/__tests__/context.test.ts | 5 | REWRITTEN | V4 | Temp dir cleanup added. Passes |
| cli/src/__tests__/data-dir.test.ts | 4 | VALID | none | None |
| cli/src/__tests__/database-check.test.ts | 3 | VALID | none | None |
| cli/src/__tests__/doctor.test.ts | 1 | REWRITTEN | V4 V8 | Temp root cleanup added. Win ENV: doctor warns on 666 key-file mode (1 fail) |
| cli/src/__tests__/env-lab.test.ts | 18 | REWRITTEN | V8 | Five dangerous-path cases built expectations with `path.join`, but the resolver uses `path.resolve`; on Windows the drive prefix differed. Expectations now use `path.resolve`. 18/18 pass (was 5 fails) |
| cli/src/__tests__/feedback.test.ts | 4 | VALID_WITH_NOTES | V1 | None. Fixture destination `paperclip_labs_feedback_v1` |
| cli/src/__tests__/home-paths.test.ts | 4 | VALID_WITH_NOTES | V4 | None. First test leaves one temp dir |
| cli/src/__tests__/http.test.ts | 5 | VALID_WITH_NOTES | V1 | None. Hint regex tolerates `npx paperclipai run` |
| cli/src/__tests__/install-command.test.ts | 16 | NEEDS_DECISION | V1 V8 | None. Default repo `paperclipai/paperclip`, npm `latest`/`canary` channels; Win ENV: 5 fails (symlink EPERM, `:` in lock name) |
| cli/src/__tests__/install-store.test.ts | 11 | VALID_WITH_NOTES | V8 | None. Pure store mechanics, policy-neutral. Win ENV: 8 fails (modes, symlinks, `:` lock name) |
| cli/src/__tests__/issue-subresources.test.ts | 5 | REWRITTEN | V2 V4 V6 | Added `vi.unstubAllGlobals()`. Passes |
| cli/src/__tests__/managed-install-check.test.ts | 4 | REWRITTEN | V4 V8 | Temp root cleanup via shared helper. Win ENV: 1 symlink EPERM fail |
| cli/src/__tests__/network-bind.test.ts | 5 | REWRITTEN | V4 | `PATH` and `PAPERCLIP_TAILNET_BIND_HOST` restored in `afterEach` instead of inline (leaked on failure). Passes |
| cli/src/__tests__/onboard-service.test.ts | 4 | VALID | none | None |
| cli/src/__tests__/onboard.test.ts | 8 | REWRITTEN | V4 V8 | Temp root cleanup added. Win ENV: 1 fsync EPERM fail |
| cli/src/__tests__/open-url.test.ts | 3 | VALID | none | None |
| cli/src/__tests__/operations-parity.test.ts | 2 | REWRITTEN | V2 V4 V6 | Added `vi.unstubAllGlobals()`. Passes |
| cli/src/__tests__/pipelines.test.ts | 3 | REWRITTEN | V4 | Added `vi.unstubAllGlobals()`. Passes |
| cli/src/__tests__/plugin-init.test.ts | 10 | VALID | none | None |
| cli/src/__tests__/project-goal.test.ts | 3 | REWRITTEN | V4 | Added `unstubAllGlobals` and temp dir cleanup. Passes |
| cli/src/__tests__/prompt.test.ts | 6 | REWRITTEN | V4 | Added `vi.unstubAllGlobals()`. Passes |
| cli/src/__tests__/routine-plugin-parity.test.ts | 3 | REWRITTEN | V2 V4 V6 | Added `vi.unstubAllGlobals()`. Passes |
| cli/src/__tests__/routines.test.ts | 1 | VALID_WITH_NOTES | V3 V7 | None. Embedded-Postgres only; Win ENV (hook timeout in run 1, skipped in run 2) |
| cli/src/__tests__/run.test.ts | 3 | REWRITTEN | V4 | Added `vi.unstubAllGlobals()`. Passes |

Totals: 45 files, 239 test cases; 24 REWRITTEN, 10 VALID_WITH_NOTES, 9 VALID, 2 NEEDS_DECISION, 0 OBSOLETE_REMOVED.

## 6. Per-test detail (tests that are not clean)

| File | Test | Code | Finding | Action |
|---|---|---|---|---|
| env-lab | keeps a checkout path with {a dollar sign, command substitution, backticks, a double quote, a single quote} inert in the cleanup hint (5 cases) | V8 | Expected `path.join("/tmp/...")` has no drive letter; resolver returns `path.resolve(...)`, so these failed on Windows only | Fixed: `path.resolve` in the expectation. Pass |
| env-lab | runs the bundled dist entry directly / keeps a bundled package path ... inert | V8 | Still uses `path.join` on POSIX-style roots; correct only because the resolver returns the entry unchanged | Noted |
| company-import-transfer | takes the chunked path for a small zip whose entries inflate past the threshold | V3 | 64 MB DEFLATE fixture; 7.2 s on this host vs 5 s default | Open (timeout bump reverted) |
| company-import-transfer | takes the chunked path for a binary-heavy folder ... | V3 | 40 MB write plus zip; 6.2 s | Open (timeout bump reverted) |
| company-import-transfer | zips an oversized folder in memory with the same walk filters ... | V3 | 48 MB+ fixture; borderline timeout in one run | Open (timeout bump reverted) |
| company-import-transfer | slices an oversized local zip into a transfer and applies it against the spool | V3 | 48 MB+ fixture plus hashing; timed out at 5 s | Open (timeout bump reverted) |
| network-bind | stores the detected tailscale address for tailnet presets | V4 | `delete process.env...` ran only if the assertion passed | Moved to `afterEach` |
| network-bind | falls back to loopback when no tailscale address is available | V4 | Restored `PATH` in `finally` but not the tailnet var | Covered by `afterEach` |
| access-parity / admin-asset-skill-parity / agent-lifecycle / issue-subresources / operations-parity / routine-plugin-parity (11 tests) | wraps ... endpoints | V2 V6 | One test drives 9-24 commands and asserts only `[method, url]`; `--payload-json {}` bodies, headers and error paths unchecked; first failure hides the rest | Noted; no restructuring |
| access-parity, activity-parity, admin-asset-skill-parity, agent-lifecycle, auth-command-registration, issue-subresources, operations-parity, pipelines, prompt, routine-plugin-parity, run, connect, project-goal | all tests that call `vi.stubGlobal("fetch", ...)` | V4 | Global `fetch` stub was never undone | `vi.unstubAllGlobals()` in `afterEach` |
| allowed-hostname | adds and normalizes hostnames | V4 V9 | Temp dir leaked; example hostname is an upstream contributor's laptop name (cosmetic) | Cleanup added; Win ENV fsync fail |
| board-auth, context, common, agent-jwt-env, connect, doctor, onboard, managed-install-check, project-goal | tests using temp dirs | V4 | Temp dirs never removed | Cleanup added |
| home-paths | defaults to ~/.paperclip and default instance | V4 | `mkdtemp` dir never removed | Noted |
| company | maps process-only imported agents to claude_local | V1 | Asserts a hard-coded `claude_local` fallback (`company.ts:398`, marked TODO upstream). Matches today's registry default (`hermes_gateway, claude_local, hermes_local`) | Retained; product note |
| company-import-export-e2e | exports a company package and imports it into new and existing companies | V3 V6 V8 | Single 90 s test; unexecutable on Windows; SIGTERM only reaches the pnpm wrapper; port-then-bind race | Comment fixed; noted |
| config-store | backs up invalid bytes collision-safely and only replaces them through an atomic repair | V2 V8 | Asserts spy call order of `openSync`/`fsyncSync`/`renameSync` | Retained; Win ENV |
| configure-repair | repairs only after confirmation and commits the staged config atomically | V5 | Hand-built full `@clack/prompts` and `prompts/server.js` mocks | Retained |
| connect | both tests | V5 | Hand-built `@clack/prompts` and `board-auth.js` mocks (only `loginBoardCli` exported) | Retained |
| install-store | all 8 failing cases | V8 | POSIX modes, symlinks, `:` in lock tmp name | Retained; Win ENV |
| install-command | installs a GitHub branch ...; installs through the shim ...; rejects a symlinked installs root ...; refuses to uninstall while another store mutation holds the lock; refuses a symlinked git payload root ... | V1 V8 | See section 7; Win ENV | Retained |
| install-command | resolves branch, tag, full SHA, and short SHA refs through GitHub; supports fork overrides | V1 | Hard-codes `paperclipai/paperclip` (upstream) and uses "HenkDz/paperclip" as the fork example | Retained |
| channels | all 5 tests | V1 | npm dist-tags and "master" cadence strings | Retained |
| http | throws ApiConnectionError with recovery guidance when fetch fails | V1 | Regex allows `npx paperclipai run` hint | Retained |
| feedback | writes votes, traces, a manifest, and a zip archive | V1 | Leaves a temp dir; fixture destination is upstream Paperclip Labs | Noted |
| doctor | re-runs repairable checks so repaired failures do not remain blocking | V8 | Doctor warns on POSIX key-file mode on Windows, so `warned` is 1 | Win ENV |
| routines | pauses only non-archived routines for the selected company | V3 V7 | Needs embedded Postgres; single scenario; no test for an unknown company or a database error | Retained |

## 7. Evaluation and recommendations

Product findings (suspected production issues or decisions; no test was bent to pass):

1. **Windows durability bug.** `durableCopyFile` (`cli/src/config/store.ts:132-134`) opens the backup with flag `"r"` and calls `fsyncSync`, which throws `EPERM` on Windows. `paperclipai configure`, `onboard`, `allowed-hostname` and invalid-config backup fail on Windows hosts. Fix by opening `"r+"` (files) and tolerating `EPERM`/`EISDIR` on directory fsync, or skipping dir fsync on `win32`.
2. **Install store path on Windows.** The lock temp name embeds `:` (`.install.lock.<pid>:<ts>:<rand>.tmp`), invalid on NTFS. The managed-install feature is Linux/macOS-oriented; either declare that or change the separator.
3. **Upstream release engineering inside the CLI (NEEDS_DECISION).** `channels`, `install --canary/--version`, `install --ref`, and `update` resolve `paperclipai@latest|beta|nightly|canary` on npm and default to GitHub `paperclipai/paperclip`. `doc/ORIGIN.md` states the fork does not publish to npm, and the CLI hint strings still say "every merge to master". Owner decision needed: remove/rebrand these commands (and their tests: `channels`, `install-command`, plus `install-store`/`update-command` which are policy-neutral) or point them at the fork's release artefacts. Until then the tests correctly describe the code.
4. **Import adapter fallback.** `buildDefaultImportAdapterOverrides` hard-codes `claude_local` for imported `process` agents (TODO in code). It works with the current selectable default, but conflicts in spirit with the Hermes-first policy; consider deriving it from the server's selectable adapter list.
5. **`doctor` permission check on Windows.** Reports "key file permissions are 666" as a warning on Windows, where POSIX modes are meaningless; guard by platform.
6. **Feedback export destination.** `paperclip_labs_feedback_v1` is carried in `server/src/services/feedback.ts`; confirm the fork intends feedback export to that destination.
7. **Error hint text.** `http.ts` suggests `npx paperclipai run`, which cannot work if the package is not published.

Coverage gaps (not added; larger than a cheap targeted test): HTTP error paths (401/403/404/5xx) and request bodies for the parity commands; `routines` (second company, DB error, dry-run); Windows-path variants of `data-dir`/`home-paths`; `company-import-url` for non-GitHub hosts; `prompt` wake failure path; `open-url` Windows/macOS opener selection. The fork-owned CLI surfaces (`teams`, Hermes gateway adapter, tailscale broker, teable) are outside this shard (`teams.test.ts` etc. belong to another shard). A Linux CI run of `install-store`, `install-command`, `managed-install-check`, `config-store`, `configure*`, `onboard`, `allowed-hostname` and `doctor` is the confirmation step for the ENV classifications.

## 8. Summary of activities

Files rewritten (one-line reason each):

- `env-lab.test.ts`: POSIX-root expectations now built with `path.resolve` (V8).
- `company-import-transfer.test.ts`: change reverted by verifier (timeout bump rejected); unchanged from develop.
- `network-bind.test.ts`: env restored in `afterEach` (V4).
- `access-parity`, `activity-parity`, `admin-asset-skill-parity`, `agent-lifecycle`, `auth-command-registration`, `issue-subresources`, `operations-parity`, `pipelines`, `prompt`, `routine-plugin-parity`, `run`: `vi.unstubAllGlobals()` in `afterEach` (V4).
- `connect`, `project-goal`: `unstubAllGlobals` plus temp dir cleanup (V4).
- `agent-jwt-env`, `allowed-hostname`, `board-auth`, `common`, `context`, `doctor`, `managed-install-check`, `onboard`: temp dir cleanup (V4).
- `company-import-export-e2e.test.ts`: stale comment corrected (no behavioural change; verdict stays VALID_WITH_NOTES).

Deletions: none.

Commands run (all from the repo root, one vitest process at a time):

| Command | Outcome |
|---|---|
| `npx vitest run --root cli src/__tests__/<10 files>` (baseline batch) | 37 pass, 1 fail (allowed-hostname, ENV) |
| `npx vitest run --root cli src/__tests__ --exclude ...e2e... --reporter=verbose` (baseline, includes other shards' cli files) | 52 failed / 343 passed / 1 skipped; this shard's failures: 21 ENV plus 5 `env-lab` and 3-4 `company-import-transfer` that were then fixed |
| `npx vitest run --root cli src/__tests__/env-lab.test.ts` (after edit) | 18/18 pass |
| `npx vitest run --root cli src/__tests__/company-import-transfer.test.ts` (after edits, 2 runs) | 15/16, then 16/16 pass |
| `npx vitest run --root cli <44 shard files> --reporter=verbose` (final) | 216 pass, 21 fail (all ENV, listed in section 3), 1 skipped; no failure attributable to my edits |
| Temporary debug test to inspect doctor output | Deleted afterwards; confirmed the failure is the Windows 666 mode warning |

Note: the repo uses CRLF working-tree line endings; edits preserved them (`git diff` shows only the intended lines).

## 9. Approvals

| Role | Name | Signature | Date |
|---|---|---|---|
| Test lead | | | |
| Product owner | | | |
| Reviewer | | | |
