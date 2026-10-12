# Test Summary Report: adapter-utils-02 (IEEE 829)

## 1 Report identifier and scope

| Item | Value |
| --- | --- |
| Report id | adapter-utils-02 |
| Project | packages/adapter-utils (vitest project `@paperclipai/adapter-utils`) |
| Files in shard | 17 |
| Test cases (after audit) | 311 (292 before audit, 19 added). Table expansions: duplex-frame-codec 38 = 2 fixture checks + 22 decode cases (one per fixture vector) + 1 round-trip coverage check + 8 re-encode cases (one per round-trip vector) + 5 streaming checks; startup-characterization fingerprint table = 10 cases |
| Date | see git |
| Rubric | ISO/IEC/IEEE 29119 and ISTQB, V1 to V9 as defined in the audit brief |

## 2 Summary

Every file was read in full and checked against the production module it exercises (`billing.ts`, `command-redaction.ts`, `env-bindings.ts`, `login-capability.ts`, `local-process-sandbox.ts`, `git-workspace-sync.ts`, `execution-target.ts`, `command-managed-runtime.ts`, `sandbox-callback-bridge.ts`, `acpx-engine/*`). All subjects still exist in this fork and no assertion encodes upstream-only behaviour or a stale fork default (no V1 defects). None of the shard exercises Hermes Gateway adapter policy, adapter defaults, teable, teams-catalog or the tailscale broker.

Verdict counts (files): VALID 2, VALID_WITH_NOTES 8, REWRITTEN 7, OBSOLETE_REMOVED 0, NEEDS_DECISION 0.

Headline defects fixed: one 11-run monolithic fingerprint test that exceeded the 5 s default timeout (V3/V6) was split into 10 independent table cases; dead helpers and a dead `vi.mock` were removed (V9); a platform-dependent expectation was made portable (V8); a misleading arithmetic comment was corrected (V9); 19 cheap negative/boundary tests were added for `billing`, `env-bindings` and the previously untested `redactCommandText` (V7).

## 3 Variances

This machine is Windows 11. The full shard was run once before editing (baseline) and the edited files were re-run afterwards.

- Baseline: 292 tests, 212 passed, 76 failed, 4 skipped. After edits: the failures are the same set of ENV failures (see below); no new failure was introduced and no REAL failure was observed.
- 76 failures in 6 files are all classified **ENV (Windows)**, none REAL:
  - `tar -c ... -f C:\...` is parsed by bsdtar as `host:path` ("Cannot connect to C: resolve failed"): command-managed-runtime (stage/syncIn cases), startup-characterization (8 remote-lane cases).
  - Runner maps `sh`/`bash` to `/bin/sh` and `/bin/bash`, which do not exist: execution-target-sandbox (process-session bridge, callback bridge, run-log wrapper cases), execution-target-stdin-race (host-write cases), command-managed-runtime (`rm`, `mv`, `wc` scripts with `C:\` paths).
  - `core.autocrlf` checkout converts `base\n` to `base\r\n`: git-workspace-sync "creates a shallow standalone clone". The 5 other git-workspace-sync failures need `sh -c` bundle scripts (`execFile("sh", ...)`).
  - `local-process-sandbox` unconditionally rejects non-Linux platforms: 7 cases (now guarded, see section 8) plus one `path.resolve` expectation (fixed).
- Therefore the following could NOT be verified dynamically here and rely on Linux CI (t3-nightly slow-tests): the 29 remaining failing cases of execution-target-sandbox, 16 of command-managed-runtime, 8 of startup-characterization, 4 of execution-target-stdin-race, 6 of git-workspace-sync, and the 7 Linux-gated local-process-sandbox cases. Edits to those files were limited to comment-only (command-managed-runtime) or to code that does run on Windows (startup-characterization fingerprint table: 10/10 pass; local-process-sandbox parser case: passes).
- Opt-in cases (`PAPERCLIP_TEST_BWRAP`, `PAPERCLIP_TEST_SANDBOX_BUILD`) are skipped by design (4 cases). No workflow under `.github/` sets `PAPERCLIP_TEST_BWRAP`, so these never run in CI (see section 7).

## 4 Comprehensive assessment (cross-cutting defects)

| Code | Count | Summary |
| --- | --- | --- |
| V1 Validity | 0 | All subjects exist; assertions match current source. Several comments cite upstream tracker ids (PAP-3222, PAP-4037) that are not meaningful in the fork (cosmetic). |
| V2 Meaningful assertions | 4 | settlement-sequence x2 and turn-sequence x1 contain assertions that cannot fail (credential never injected, dead `borrowedResource`); execution-target-sandbox "defaults the wait budget" asserts only that generated source contains the substring `35000`. |
| V3 Determinism | 9 | startup-characterization monolithic test (fixed); real-time windows in execution-target-sandbox (300 ms buffering sleeps x2, 50 ms span-end wait, 5 ms degrade wait, 400 ms heartbeat timeout), execution-target-stdin-race (200 and 300 ms negative-wait windows x3, 300 ms injected delay x2), turn-characterization real 1 s wall-clock timeout, probabilistic concurrent-reader race. All are bounded and have generous ceilings; none fixed-port. |
| V4 Isolation | 2 | startup-characterization uses `mockImplementationOnce` with `vi.clearAllMocks()`: an unconsumed once-implementation from a failed test can leak into the next; env stubs elsewhere are restored correctly (`vi.unstubAllEnvs`, try/finally). |
| V5 Mock fidelity | 1 | startup-timing "keeps the ended step store in a timer" deliberately pins a known AsyncLocalStorage leak (documents a defect rather than desired behaviour). Fakes elsewhere delegate to real implementations (`importActual` spies, real child processes). No SUT is mocked. |
| V6 Clarity | 3 | monolithic fingerprint test (fixed); startup-timing test name `normalizeProviderFamily maps every non-built-in key to plugin` also asserts built-in passthrough; mixed naming styles (`test_*` snake case vs sentence). |
| V7 Coverage balance | 4 | billing, env-bindings and `redactCommandText` lacked negative/boundary cases (added 19 tests); keeps-detection test never covers the "detection fails, install runs" branch. |
| V8 Portability | 6 | 6 files hard-code `/bin/sh`, `/bin/bash`, `tar`, `sh -c` or POSIX paths with no guard (all fail on Windows); local-process-sandbox Linux-only cases (guarded) and parser expectation (fixed). |
| V9 Maintainability | 10 | dead `pathExists`, `createLocalSandboxRunner`, `vi.mock` spies and imports (removed); inline copy of the same API server boilerplate x6 and proxy port/token regex scrape x5 in execution-target-sandbox; 7 identical SSH target literals (extracted); duplicate runner implementations in command-managed-runtime; duplicate attribute-key tests in startup-timing; inconsistent arithmetic comment (fixed); duplex codec vectors tested in three places. |

## 5 Summary of results

| Path | Tests | Verdict | Defect codes | Action taken |
| --- | --- | --- | --- | --- |
| packages/adapter-utils/src/acpx-engine/settlement-sequence.test.ts | 9 | VALID_WITH_NOTES | V2 | none; two credential-gate tests cannot fail (section 6) |
| packages/adapter-utils/src/acpx-engine/spawn-smoke.test.ts | 2 | VALID_WITH_NOTES | V9 | none; couples to fixture stderr text |
| packages/adapter-utils/src/acpx-engine/startup-characterization.test.ts | 26 (was 17) | REWRITTEN | V3 V6 V9 (fixed); V4 V8 (noted) | split monolithic fingerprint test into 10 `it.each` cases; removed dead `pathExists` |
| packages/adapter-utils/src/acpx-engine/startup-timing.test.ts | 42 | VALID_WITH_NOTES | V5 V6 V9 | none |
| packages/adapter-utils/src/acpx-engine/turn-characterization.test.ts | 11 | REWRITTEN | V9 | removed dead `createLocalSandboxRunner`, dead `vi.mock`/spies and their imports |
| packages/adapter-utils/src/acpx-engine/turn-sequence.test.ts | 4 | VALID_WITH_NOTES | V2 | none |
| packages/adapter-utils/src/billing.test.ts | 6 (was 3) | REWRITTEN | V7 | added 3 negative/boundary tests |
| packages/adapter-utils/src/command-managed-runtime.test.ts | 27 | VALID_WITH_NOTES | V8 V9 | corrected wrong exec-count comments (comment-only edit) |
| packages/adapter-utils/src/command-redaction.test.ts | 15 (was 10) | REWRITTEN | V7 | added 5 tests for the previously untested exported `redactCommandText` |
| packages/adapter-utils/src/duplex-frame-codec.test.ts | 38 | VALID | none | none |
| packages/adapter-utils/src/env-bindings.test.ts | 10 (was 8) | REWRITTEN | V7 | added numeric/invalid version selector test and CRLF test |
| packages/adapter-utils/src/execution-target-sandbox.test.ts | 52 | VALID_WITH_NOTES | V2 V3 V8 V9 | none; large file, 29 cases un-runnable on Windows so refactor was not attempted |
| packages/adapter-utils/src/execution-target-stdin-race.test.ts | 10 | VALID_WITH_NOTES | V3 V8 | none |
| packages/adapter-utils/src/execution-target.test.ts | 11 | REWRITTEN | V9 | extracted 7 duplicated SSH target literals into one file-level fixture |
| packages/adapter-utils/src/git-workspace-sync.test.ts | 19 | VALID_WITH_NOTES | V4 V8 | none |
| packages/adapter-utils/src/local-process-sandbox.test.ts | 14 | REWRITTEN | V8 | Linux guard on 7 cases (`it.runIf`); portable `path.resolve` expectation in parser case |
| packages/adapter-utils/src/login-capability.test.ts | 15 | VALID | none | none |

## 6 Per-test detail (tests that are not clean)

| File | Test | Code | Finding | Action |
| --- | --- | --- | --- | --- |
| settlement-sequence | test_two_compatible_runs_do_not_share_run_scoped_credentials | V2 | `credentials: [credential]` is copied from the closure that the test itself supplies, so `expect(runB.credentials).not.toContain("run-api-key-A")` cannot fail; only the per-run `token` assertion is real. | noted |
| settlement-sequence | test_no_run_scoped_credential_appears_in_reuse_payload_or_telemetry | V2 | The secret string is never placed into the ledger, payload or report, so both `not.toContain` checks are vacuous. The `transferred` disposition assertion is real. | noted |
| turn-sequence | test_run_turn_finalizes_no_resource | V2 | `borrowedResource` is unreachable by `runTurn` and `released` can never become true; the real proof is the exact call-order assertion. Dead variable. | noted |
| startup-characterization | busts the fingerprint when any representative folded dimension changes | V3 V6 | 11 sequential executor runs in one test timed out at 5000 ms; one failure hid which dimension broke. | rewritten as 10 `it.each` cases, each 2 runs, all pass |
| startup-characterization | `pathExists` helper | V9 | Dead helper kept alive with `void pathExists`. | removed |
| startup-characterization | create_runtime failure, partial-bridge failure | V4 | `mockImplementationOnce` queued on shared spies; `vi.clearAllMocks()` does not reliably drop an unconsumed once-implementation if a run fails before consuming it. | noted |
| startup-characterization | 8 remote-lane cases | V8 | Require POSIX `tar` and `/bin/bash`; no guard. ENV failures on Windows. | noted |
| startup-timing | keeps the ended step store in a timer scheduled inside the step body | V5 | Locks a known AsyncLocalStorage leak ("so the fix and its guard test stay honest"); will need deletion or inversion when the leak is fixed. | noted |
| startup-timing | sets each step-span attribute key with the closed prefix and a type suffix; emits exactly the allowlisted span-attribute key set | V9 | Overlap the "carries only the allowlisted attributes" test. | noted |
| startup-timing | normalizeProviderFamily maps every non-built-in key to plugin | V6 | Name omits that the same test asserts built-in passthrough. | noted |
| startup-timing | ends the span and sets an error status | V9 | Magic number 2 for `SpanStatusCode.ERROR` (also in runtime span runner test). | noted |
| turn-characterization | aborts a hung turn on the wall-clock timer | V3 | Uses a real `timeoutSec: 1` timer with a 15 s test timeout; bounded but not fake-timer driven. | noted |
| turn-characterization | afterEach comment | V9 | Comment describes remote process-session cleanup that this file no longer exercises. | noted |
| turn-characterization | createLocalSandboxRunner, vi.mock of execution-target | V9 | Dead helper and dead spy mock copied from execute.test.ts. | removed |
| spawn-smoke | spawns a real Node ACP agent | V9 | Asserts exact stderr fragments (`nes/close`, `paperclip-acp-echo-agent started`) owned by a fixture in `scripts/mcp-fixtures`. | noted |
| billing | (gaps) | V7 | No coverage of `OPENAI_API_BASE`, `OPENAI_API_BASE_URL`, blank key, null fallback. | 3 tests added |
| env-bindings | (gaps) | V7 | No coverage of numeric `version`, rejected version selector, CRLF. | 2 tests added |
| command-redaction | (gaps) | V7 | Exported `redactCommandText` (CLI flags, Bearer header, sk-/ghp_ shapes, custom replacement) had no direct test. | 5 tests added |
| command-managed-runtime | test_single_stream_writeFile_collapses_roundtrips_under_96MiB | V9 | Comments said 2+3=5 execs while the assertion computes 3+ceil = 6. | comments corrected |
| command-managed-runtime | keeps adapter detection on the profile-backed shell path | V7 | Only the "detected, install skipped" branch is covered. | noted |
| command-managed-runtime | 16 cases | V8 | Runner hard-codes `/bin/sh`; `tar`; `C:\` paths. ENV on Windows. | noted |
| command-managed-runtime | whole file | V9 | Two separate runner implementations (inline execFile runner in the first test and `makeSpawnRunner`). | noted |
| execution-target-sandbox | defaults the wait budget to 35 s and honors the environment key override | V2 | `expect(source).toContain("35000")` is a substring check that can pass for unrelated text; the behavioural half (150 ms override) is real. | noted |
| execution-target-sandbox | buffers sandbox process session output until the local proxy connects; buffers streamed output until the local proxy connects | V3 | Real 300 ms sleep to let the child finish before connecting. | noted |
| execution-target-sandbox | ends the sandbox.agentProcess span at stop() even when the process lingers; delivers the final batch and a warning when run log polling degrades | V3 | Real 50 ms and 5 ms waits. | noted |
| execution-target-sandbox | applies the same loss behavior on a heartbeat timeout | V3 | Real 400 ms heartbeat timeout; ceiling 20 s. | noted |
| execution-target-sandbox | 5 process-session cases that scrape port and token | V9 | Regex scrape of generated proxy source (`port: (\d+)`, `const token = ...`) couples tests to source text; repeated 5 times. | noted |
| execution-target-sandbox | 6 bridge cases | V9 | The same `createServer` plus `address()` boilerplate copied 6 times. | noted |
| execution-target-sandbox | 29 cases | V8 | `/bin/bash` runner mapping; process-session wrapper script. ENV failures on Windows. | noted |
| execution-target-sandbox | embedded gateway codec passes every vector | V9 | Duplicates `duplex-frame-codec.test.ts` against the embedded copy of the source; acceptable because it covers the generated copy. | noted |
| execution-target-stdin-race | delivers a stdin file that appears empty first; holds a later stdin file until the earlier file appears; does not close the stream on a later stdinEnd | V3 | Negative assertions after a fixed 200/300 ms delay; a slow runner could pass vacuously. | noted |
| execution-target-stdin-race | never exposes a partial .json file under a concurrent reader | V3 | Probabilistic race detector: a regression might not be observed in a given run. | noted |
| execution-target-stdin-race | 4 host cases | V8 | `/bin/sh`, `/bin/bash`. ENV on Windows. | noted |
| git-workspace-sync | creates a shallow standalone clone from the local HEAD snapshot | V8 | `readFile` equals `"base\n"`; a global `core.autocrlf=true` yields `base\r\n`. The test cannot configure the clone it asserts on. | noted |
| git-workspace-sync | 5 bundle cases | V8 | `execFile("sh", ["-c", ...])`. ENV on Windows. | noted |
| git-workspace-sync | creates the concurrent-history merge commit with a deterministic identity | V4 | Mutates `process.env` identity keys; restored in finally. Safe. | none |
| local-process-sandbox | parses read-only and writable extra paths | V8 | Expected `"/opt/cache"` but the parser resolves for the host platform. | expectation now uses `path.resolve` |
| local-process-sandbox | 7 cases that call `buildLocalProcessSandboxSpawnTarget` | V8 | Production throws on every non-Linux platform before validation; tests failed on macOS/Windows. | guarded with `it.runIf(process.platform === "linux")` |
| local-process-sandbox | prevents reads outside the workspace; runs the TypeScript build; denies direct network egress; allows only configured network targets | V7 | Only the real isolation proofs; skipped unless `PAPERCLIP_TEST_BWRAP` is set, and no workflow sets it. | noted (section 7) |

## 7 Evaluation and recommendations

Quality of the shard is high: assertions are specific, fakes delegate to real implementations, temp dirs and env are restored, no test uses a fixed network port, and the characterization suites document intent well. The audit found no stale upstream behaviour.

Product findings:

1. **Platform check precedes validation in `buildLocalProcessSandboxSpawnTarget`** (`local-process-sandbox.ts:347`). Option validation (`networkAllowlist`, outbound restore mapping) is only reachable on Linux, so configuration errors surface as "supported only on Linux" on other platforms. Not a bug for a Linux-only feature; decide whether validation should precede the platform check so errors are portable. No test was bent.
2. **Bubblewrap isolation integration tests never run in CI.** The four tests that prove filesystem and network confinement need `PAPERCLIP_TEST_BWRAP`, which no workflow sets (grep of `.github` found nothing). Security-critical behaviour is therefore only covered by argument-shape assertions. Recommend a separate `ci`-labelled PR that installs bubblewrap on the runner and exports the variable in t3-nightly slow-tests.
3. Windows developers cannot run 76 of the shard's tests locally (tar host:path parsing, `/bin/sh`). Consider documenting "run these in WSL/Linux" in `doc/DEVELOPING.md` or guarding with one shared `it.runIf(process.platform !== "win32")` helper.

Coverage gaps (not added because not cheap or need Linux to verify): detection-failure branch of `prepareCommandManagedRuntime` (install runs, then detection re-checked); `sanitizeGitRemoteUrl` with IPv6 hosts and empty userinfo; deterministic (fake clock) variants of the 200/300 ms negative-wait windows in `execution-target-stdin-race`; a behavioural test for the credential gate that actually injects a run-scoped credential (settlement-sequence).

Recommended follow-ups, in priority order: (a) extract a shared `startApiServer()` helper and a shared `connectToProcessSessionProxy()` helper in `execution-target-sandbox.test.ts` (about 400 lines of duplication) when a Linux run is available to verify; (b) replace the two vacuous settlement-sequence assertions with ones that register a credential in the ledger payload; (c) delete the `borrowedResource` dead code in turn-sequence.

## 8 Summary of activities

Files rewritten (all test-only):

- `acpx-engine/startup-characterization.test.ts`: monolithic fingerprint test split into a 10-case `it.each` table (attributable failures, each run inside the default timeout); dead `pathExists` removed. Meaningful assertions unchanged.
- `acpx-engine/turn-characterization.test.ts`: removed dead `createLocalSandboxRunner`, dead `vi.mock` spy block and unused imports.
- `billing.test.ts`: +3 tests (alternate base-URL variables, blank key, fallback/null).
- `command-redaction.test.ts`: +5 tests for `redactCommandText`.
- `env-bindings.test.ts`: +2 tests (version selectors, CRLF).
- `execution-target.test.ts`: 7 duplicated SSH literals replaced by one fixture.
- `local-process-sandbox.test.ts`: Linux guard on 7 cases; portable path expectation.
- `command-managed-runtime.test.ts` (verdict VALID_WITH_NOTES): comment-only correction of exec-count arithmetic.

Deletions: no test case was deleted. Only dead helper code and a dead `vi.mock` spy block (never referenced by any assertion) were removed.

Commands run (from repo root, Windows):

- Baseline: `npx vitest run --project @paperclipai/adapter-utils <all 17 files>`: 292 tests, 212 passed, 76 failed (all ENV), 4 skipped.
- `npx vitest run billing.test.ts env-bindings.test.ts command-redaction.test.ts`: 31 passed.
- `npx vitest run acpx-engine/startup-characterization.test.ts`: 26 tests, 18 passed, 8 ENV failures (the same 8 remote-lane cases as baseline); the 10 new fingerprint cases pass.
- `npx vitest run acpx-engine/turn-characterization.test.ts`: 11 passed.
- `npx vitest run execution-target.test.ts`: 11 passed.
- `npx vitest run local-process-sandbox.test.ts command-managed-runtime.test.ts`: local-process-sandbox 3 passed, 11 skipped (7 Linux-gated, 4 opt-in); command-managed-runtime 11 passed, 16 ENV failures, unchanged from baseline.
- `npx tsc --noEmit -p packages/adapter-utils/tsconfig.json` filtered to the edited files: no diagnostics.

Process deviation: my first scripted edit of `startup-characterization.test.ts` truncated the file (CRLF working copy defeated a marker search). I restored that single file from HEAD with `git checkout -- <file>` before redoing the edit correctly. No other file was touched by git commands, and nothing was added, committed or stashed. Other shards' modified files visible in `git status` are not mine.

## 9 Approvals

| Role | Name | Signature | Date |
| --- | --- | --- | --- |
| Test author / auditor | | | |
| Reviewer | | | |
| Product owner | | | |
