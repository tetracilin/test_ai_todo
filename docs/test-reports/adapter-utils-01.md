# Test Summary Report - shard adapter-utils-01 (IEEE 829 structure)

## 1 Report identifier and scope

| Item | Value |
|---|---|
| Report id | adapter-utils-01 |
| Project | packages/adapter-utils (vitest project `@paperclipai/adapter-utils`) |
| Subject | ACPX engine (`src/acpx-engine/`) |
| Files in shard | 12 |
| Test cases | 205 (execute.test.ts 126 incl. 4 `skipIf(win32)`; composed 14; fault matrix 18; settlement 12; ledger 8; sandbox site 7; coordinator 4; reuse store 4; host site 3; identity 3; contracts 3; remote-spawn smoke 3) |
| Date | see git |
| Rubric | ISO/IEC/IEEE 29119 / ISTQB, codes V1-V9 |

## 2 Summary

All 12 files were read in full and checked against the production modules in `src/acpx-engine/` (execute.ts, run-coordinator.ts, run-resource-ledger.ts, run-contracts.ts, run-site-host.ts, run-site-sandbox.ts, session-reuse-store.ts, settlement-sequence.ts) and `src/sandbox-managed-runtime.ts`. The subject exists in the fork and assertions match current behaviour (Amendment B close-and-relaunch host lane, staged-runtime reuse, span parenting). `tsc --noEmit` for the package passes, so every `@ts-expect-error` compile-time assertion in `execute-identity`, `run-contracts` and `run-site-sandbox` is live.

Verdicts: VALID 5, VALID_WITH_NOTES 5, REWRITTEN 2, OBSOLETE_REMOVED 0, NEEDS_DECISION 0.

No suspected production bug was found. Two files had small rewrites (stale gemini references, a no-op adapter loop, a dead helper).

## 3 Variances (what could not be verified)

The run host is Windows 11. Baseline run of the whole `acpx-engine/` directory: 84 failures, of which 76 are inside this shard (composed 3, execute 54, fault matrix 12, settlement 7). All were classified **ENV**, none REAL:

* `tar: Cannot connect to C: resolve failed` - the sandbox staging code shells out to tar with a `C:\...` path (`tar -f C:\...`), parsed as `host:path`. Retrying with `C:\Windows\System32` first on PATH moved the failure to the next ENV cause below.
* `sync operation source path is not a confined absolute path: C:\Users\...` - `sandbox-managed-runtime.ts` confines sync paths with `path.posix.isAbsolute`, which rejects Windows paths.
* The test local sandbox runner rewrites `bash` to `/bin/bash`, and the sandbox lane assumes a POSIX host.
* Cascades: assertions such as "expected 0 to be 1" (bridge stop counts, close counts) and "expected false to be true" occur because staging throws before bridges/teardown exist.

Consequences: the 76 sandbox-lane tests could not be executed to green here, so their validity was established by reading code and by comparing before/after failure sets (identical failure sets for the two edited files). They are expected to run in the Linux t3-nightly job. WSL (Ubuntu 22.04) exists on the machine but has no Node, so it could not be used. The 4 `skipIf(process.platform === "win32")` execute tests (symlink/skill materialisation) were skipped by design.

Passing on Windows: all of run-contracts, run-coordinator, run-resource-ledger, run-site-host, run-site-sandbox, session-reuse-store, execute-identity, remote-spawn-smoke (real acpx host spawn), 68 of execute.test.ts, 11 of composed, 6 of fault matrix, 5 of settlement.

## 4 Comprehensive assessment (cross-cutting, by rubric code)

| Code | Count | Finding |
|---|---|---|
| V1 Validity | 2 fixed | Comments in composed/settlement named `gemini-local`, an adapter that no longer exists in this fork (`packages/adapters/` has no gemini-local). Comments corrected. `execute.test.ts` keeps a `not.toHaveProperty("geminiSkillsHome")` negative guard; it remains valid. No stale-default or upstream-only assertions found. |
| V2 Meaningful assertions | 1 fixed, 3 noted | settlement Layer C looped over "codex/claude/gemini" but ran the identical body, so the loop proved nothing adapter-specific (fixed: one run, honest name). `expect(true).toBe(true)` in execute-identity (test 3) and run-contracts (test 2) and `expect(_ok).toBe(true)` (test 3) are runtime placeholders for compile-time assertions; vitest alone cannot fail them, only `tsc` can (documented by the file headers; the package `typecheck` includes `src`). |
| V3 Determinism | 8 noted | Real timers: two 1s `timeoutSec` tests (execute, fault case_10) bounded by 15s; negative-assertion sleeps of 20ms/50ms (execute x2, run-site-sandbox x1); 5ms stagger in two staging-lock tests. Bounded and not racy in practice, but time-dependent. `excludes the nested skills.reconcile wall time` compares float sums with `toBe`; relies on identical summation order. |
| V4 Isolation | 4 noted | `stubBridges()` uses persistent `mockImplementation` and `beforeEach` only calls `vi.clearAllMocks()`, so the stub leaks into later tests in composed, fault matrix, settlement and execute F3. Harmless today because later tests either re-stub or use the host lane, but order-dependent. Env and process.stderr patches are restored in `finally`; temp dirs are removed in `afterEach` with retries. |
| V5 Mock fidelity | 0 defects | `@paperclipai/adapter-utils/execution-target` is partially mocked via `importActual` wrappers that delegate to the real implementations (good). Runtimes are structural fakes but are only the dependency, never the SUT. |
| V6 Clarity | 6 noted | Multi-scenario `for` loops inside one `it` (composed 1, settlement 2, execute 3) give one test name for several failure reasons; scenario names are in assertion messages, which mitigates. Several names use the `test_snake_case` PR-era style. |
| V7 Coverage balance | gaps in section 7 | Negative paths are strong (fault matrix 17 cases, ledger misuse, coordinator no-catch proof). |
| V8 Portability | 5 files | Sandbox-lane tests in execute, composed, fault matrix and settlement are POSIX-only (`/bin/bash`, tar, `sh`) with no guard; `findAncestorBin("/")` and `0o755` fake bins are mildly POSIX-flavoured. Layer B of settlement also needs `sh` and `git`. |
| V9 Maintainability | 9 noted, 1 fixed | The harness block (local sandbox runner, `okHandle`, `completedTurn`, `throwingTurn`, `throwingHandoffContext`, `stubBridges`, `remoteArgs`, `setupRemoteSandbox`) is copy-pasted in four files and re-declared 4 times inside execute.test.ts. Dead helper `runExecutor` (+ 2 unused imports) removed from composed. Two tests are duplicates in effect (`test_task_run_span_is_noop_for_local_target` and `opens no span for a local run...`). Comments cite stale `execute.ts:NNNN` line numbers and upstream review names ("Greptile P1"). |

## 5 Summary of results

| File | Tests | Verdict | Defects | Action |
|---|---|---|---|---|
| src/acpx-engine/composed-run-characterization.test.ts | 14 | REWRITTEN | V1, V4, V6, V8, V9 | Removed dead `runExecutor` helper and 2 unused imports; corrected stale gemini-local comment. 3 ENV failures unchanged (11 pass), same set as baseline. |
| src/acpx-engine/execute-identity.test.ts | 3 | VALID_WITH_NOTES | V2 | None. Compile-time tests; tsc verifies. |
| src/acpx-engine/execute.test.ts | 126 | VALID_WITH_NOTES | V3, V4, V6, V8, V9 | None (not edited). 54 ENV failures, 4 platform skips, 68 pass. |
| src/acpx-engine/remote-spawn-smoke.test.ts | 3 | VALID | none | None. Passes; exercises the real acpx host `spawn()` with the fixture. |
| src/acpx-engine/run-contracts.test.ts | 3 | VALID_WITH_NOTES | V2 | None. Compile-time tests. |
| src/acpx-engine/run-coordinator.test.ts | 4 | VALID | none | None. |
| src/acpx-engine/run-fault-matrix.test.ts | 18 | VALID_WITH_NOTES | V3, V4, V8, V9 | None. 12 ENV failures (all sandbox-lane); host-lane cases, cases 1, 8, 15, 16, 17 and telemetry pass. |
| src/acpx-engine/run-resource-ledger.test.ts | 8 | VALID | none | None. |
| src/acpx-engine/run-site-host.test.ts | 3 | VALID | none | None. Uses fake timers and restores them. |
| src/acpx-engine/run-site-sandbox.test.ts | 7 | VALID_WITH_NOTES | V3 | None. One 50ms real sleep in a negative assertion; microtask-count based overlap check. |
| src/acpx-engine/session-reuse-store.test.ts | 4 | VALID | none | None. |
| src/acpx-engine/settlement-characterization.test.ts | 12 | REWRITTEN | V1, V2, V6, V8, V9 | Layer C no-op adapter loop collapsed to a single honest test (`test_engine_fires_the_registered_sync_back_teardown_exactly_once`); stale gemini comment fixed. 7 ENV failures unchanged (5 pass), same set as baseline. |

## 6 Per-test detail (tests that are not clean)

| File | Test | Code | Finding | Action |
|---|---|---|---|---|
| composed-run-characterization | (helper) `runExecutor` | V9 | Defined but never called. | Removed with its unused imports. |
| composed-run-characterization | file header comment | V1 | Lists a gemini-local adapter test as real coverage; the adapter is gone from the fork. | Comment corrected. |
| composed-run-characterization | stops both bridges once and releases the staging lease on every exit path | V6, V8 | 6 scenarios in one `it`; POSIX-only. Scenario labels in messages. | Noted. |
| composed-run-characterization | THROWS ... partial bridge failure; stops both bridges...; does not re-run the turn teardown... | V8 | ENV failure on Windows (tar / posix confinement). | Noted, not editable. |
| settlement-characterization | test_engine_fires_each_adapter_named_sync_back_teardown_exactly_once | V2, V1 | Loop over codex/claude/gemini ran identical code; adapter name only in the message; gemini nonexistent. | Rewritten as `test_engine_fires_the_registered_sync_back_teardown_exactly_once`. Count unchanged. |
| settlement-characterization | test_pre_turn_failure_after_handle_closes_runtime_except_create_runtime; test_terminal_close_reason_and_discard_persistent_state_per_outcome | V6 | Table-driven loops in one `it`; labels in assertion messages. | Noted. |
| settlement-characterization | test_clean_completed_remote_teardown...; test_teardown_continues_after_one_step_fails_and_records_it; test_teardown_failure_does_not_change_external_result; Layer B x3 | V8 | ENV on Windows (tar/sh/git). The teardown ones duplicate execute.test.ts F3 behaviour. | Noted. |
| settlement-characterization | comments | V9 | Stale `execute.ts:2306-2326` etc. line references. | Noted. |
| execute-identity | test_run_scoped_contribution_is_not_assignable_to_a_reuse_payload | V2 | Runtime body is `expect(true).toBe(true)`; real check is tsc. | Noted (tsc passes). |
| run-contracts | test_only_seal_produces_ready...; test_session_fingerprint_identity_has_no_company_agent_or_task_member | V2 | Same pattern. | Noted. |
| run-site-sandbox | test_sandbox_site_session_new_starts_only_after_the_sync_barrier_settles | V3 | 50ms real sleep before a negative assertion. | Noted. |
| run-site-sandbox | test_sandbox_site_preserves_bridge_overlap_and_callback_sequencing | V3 | Two `await Promise.resolve()` assume a fixed microtask depth. | Noted. |
| run-fault-matrix | case_10_turn_timeout_finalizes_every_resource | V3 | Real 1s `timeoutSec`; 15s test timeout. | Noted. |
| run-fault-matrix | case_02, case_03, case_04, case_05, case_06, case_07, case_09, case_10, case_11, case_12, case_13, case_14 | V8 | ENV failures on Windows. | Noted. |
| run-fault-matrix | file-level | V4 | `stubBridges()` persistent mock leaks to later cases. | Noted. |
| execute.test.ts | reports a self-describing timeout error when the wall-clock timer kills a turn | V3 | Real 1s timer, 15s bound. | Noted. |
| execute.test.ts | test_idle_staged_runtime_cleanup_waits_for_active_turn_release; test_concurrent_same_session_staging_waits_for_active_turn_cleanup | V3 | 20ms real sleep before a negative assertion; `test_concurrent_same_session_staging_is_serialized` uses a 5ms stagger. | Noted. |
| execute.test.ts | excludes the nested skills.reconcile wall time from the root work sum | V3 | Exact float equality of summed durations. | Noted. |
| execute.test.ts | test_task_run_span_is_noop_for_local_target vs opens no span for a local run, even when a trace context is injected | V9 | Duplicate scenario and assertion (`spans.length === 0`). | Noted; not deleted (still valid). |
| execute.test.ts | test_sandbox_startup_span_ends_exactly_once_on_every_exit_path; test_staging_lease_releases_in_finally_on_every_exit_path; test_flush_child_stderr_runs_on_every_exit_path | V6 | Multi-scenario loops. | Noted. |
| execute.test.ts | F3 describe `stubBridges` | V4 | Persistent mock leak (last describe, so harmless). | Noted. |
| execute.test.ts | 54 sandbox-lane tests (see section 3) | V8 | ENV failures on Windows. | Noted. |
| execute.test.ts | 4 `skipIf(win32)` skill/symlink tests | V8 | Properly guarded. | None. |

## 7 Evaluation and recommendations

Product findings: none. No test was bent and no production defect is suspected. The `path.posix.isAbsolute` confinement and `tar -f <drive>:` usage in the sandbox sync code mean the managed-runtime path is genuinely POSIX-only. That is acceptable for this fork (Linux kmv8 runner) but should be a documented platform limitation.

Recommendations (not done, outside a minimal-diff pass):

1. Extract the duplicated harness (local sandbox runner, turn builders, `stubBridges`, `setupRemoteSandbox`, `remoteArgs`) into a test-only support module. It exists 4x across files and 4x inside execute.test.ts.
2. Replace `vi.clearAllMocks()` with a per-test restore of the real bridge wrappers to remove the `stubBridges` leak (confirm the vitest `mockReset` semantics first).
3. Turn the `for (scenario of ...)` loops into `it.each` so each scenario fails under its own name.
4. Add a platform guard to sandbox-lane suites if Windows developer runs matter; otherwise document them as Linux-only.
5. Replace small real sleeps with fake timers or event-based barriers where practical.
6. Coverage gaps (low risk): no unit test of `run-coordinator` where `settle()` itself rejects; no test of `createSessionReuseStore` `evictIdle` when the lease callback rejects; `run-site-host` has no test for `closeWarmEntry` rejection.
7. The sandbox-lane tests (76) must be confirmed green on Linux in t3-nightly slow-tests because they could not be exercised here.

## 8 Summary of activities

Files rewritten:

* `packages/adapter-utils/src/acpx-engine/composed-run-characterization.test.ts` - removed dead `runExecutor` helper and unused type imports; updated stale gemini-local comment. No test removed (14 before, 14 after).
* `packages/adapter-utils/src/acpx-engine/settlement-characterization.test.ts` - Layer C no-op three-adapter loop replaced by a single run with an accurate name; stale gemini comment fixed (12 before, 12 after).

Deletions of test cases: none.

Commands and outcomes:

* `npx vitest run packages/adapter-utils/src/acpx-engine/` (baseline, whole directory including other shards): 84 failed / 202 passed / 4 skipped; all failures ENV on Windows.
* Per-file JSON reporter baseline gave the shard counts in section 5.
* `npx tsc --noEmit` in packages/adapter-utils: pass, before and after the edits.
* `npx vitest run .../composed-run-characterization.test.ts` after edit: 3 failed (ENV, same as baseline) / 11 passed.
* `npx vitest run .../settlement-characterization.test.ts` after edit: 7 failed (ENV, same as baseline) / 5 passed.
* PATH experiment with `C:\Windows\System32` first: confirmed the second ENV cause (posix confinement); no change retained.

## 9 Approvals

| Role | Name | Signature | Date |
|---|---|---|---|
| Test author / auditor | | | |
| Reviewer | | | |
| Product owner | | | |
