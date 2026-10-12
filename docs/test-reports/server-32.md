# Test Summary Report - shard server-32 (IEEE 829 structure)

## 1 Report identifier and scope

| Item | Value |
|---|---|
| Report id | server-32 |
| Project | server (vitest project `@paperclipai/server`) |
| Subject | Mixed server shard: recovery services, runtime exposure (tailscale broker), adapter registry/bootstrap, hot restart, run logs/scratch, cloud-tenant actor, setup-token route, discord routes, WP-close export, worktree seed |
| Files in shard | 45 |
| Test cases | 434 current (424 before this audit; +10 added). Expansions counted: `it.each` tables in request-promise-memo (7 rows), issue-thread-interaction-resolution (5 + 2 rows), issue-thread-interactions (6 rows), provider-failure-classification (3 rows), stranded-notice (6 rows), successful-run-handoff (4 rows), cloud-tenant-actor (3 rows), managed-resource-drift (4 rows). Of the 434, 12 are platform-guarded (8 broker-client, 4 live loopback-listener) and are skipped on Windows. |
| Date | see git |
| Rubric | ISO/IEC/IEEE 29119 / ISTQB, codes V1-V9 |

## 2 Summary

All 45 files were read in full and checked against the production modules they import (recovery/*, runtime-exposure/*, adapters/registry.ts, adapter-registry-bootstrap.ts, middleware/auth.ts, hot-restart.ts, heartbeat-run-runtime-status.ts, lib/request-promise-memo.ts, claude-agent-id-header.ts, routes, etc.). The subjects all exist in this fork and the assertions match current behaviour; no upstream-only assertion or stale adapter default (V1) was found in this shard. The one adapter-policy-sensitive test (`adapters/registry.test.ts`) asserts only the codex/claude login capabilities, which are independent of the Hermes default-adapter policy.

Verdicts: VALID 19, VALID_WITH_NOTES 16, REWRITTEN 10, OBSOLETE_REMOVED 0, NEEDS_DECISION 0.

Defects fixed (10 files rewritten, all test-only, no deletions): a vacuous `it.each` (the parameter was never used), 7 mis-titled parameter rows that claimed to prove actor sensitivity of a memo keyed by object identity, a fixed 50 ms sleep replaced by bounded polling, a wall-clock-dependent expiry assertion, an opaque boolean assertion that hid the real error, Linux/POSIX-only tests lacking a platform guard, and 10 new tests closing cheap coverage gaps (bootstrap file branch, enabled:false reconcile, claude header edge cases, cloud-tenant debounce).

## 3 Variances (what could not be verified and why)

The run host is Windows 11 and was heavily loaded by concurrent audit agents (embedded Postgres, pwsh cold start). Whole-shard baseline run: 4 files failed, 13 tests failed, 10 skipped (all classified **ENV**, none REAL).

| Item | Class | Detail |
|---|---|---|
| `__tests__/wp-close-export.test.ts` DB suite (10 tests) | ENV | `beforeAll` embedded-Postgres startup exceeded its hard-coded 30 s hook timeout on three separate attempts (including once alone). The 5 fixture tests (no DB) pass. My edit (bounded `vi.waitFor` replacing a 50 ms sleep) is therefore **not dynamically verified**; `vi.waitFor` with an async callback returning the value is the documented vitest 4 API. Expected to run in Linux t3-nightly. |
| `services/hot-restart.test.ts` (5 of 17 fail) | ENV | On win32 `readProcessStartedAt` shells to `powershell.exe` then `pwsh.exe` with a production timeout of 1 500 ms. Cold PowerShell start measured 1.5 s to 2.5 s here, so the child is killed with SIGTERM. The 12 passing tests inject `platform`/`runCommand`; the 5 failing ones use the real probe on `process.pid`. Not edited. See product finding P1. |
| `runtime-exposure/broker-client.test.ts` (6 of 8 failed at baseline) | ENV | Node on Windows cannot bind a plain filesystem path (`...tsh-broker-<uuid>.sock`) as a Unix-domain socket (`connect ENOENT`). I added `describe.skipIf(process.platform === "win32")` (V8 guard, subject is a Linux-host socket client). Consequently my edit to this file (the `silentTimeout` helper now returns the error instead of a boolean) is **not dynamically verified** here; the file was collected/transformed successfully. |
| `runtime-exposure/loopback-listener.test.ts` live suite (2 of 4 failed at baseline) | ENV | `diagnoseRuntimeListenerBinds` reads `/proc/net/tcp{,6}` (Linux only). Live-socket describe now guarded with `skipIf(platform !== "linux")`. The 10 pure-parser tests pass on every platform. |
| All other 36 unedited files | - | Pass in the baseline run (`worktree-seed-server-spawn` passes on Windows including its `git` + bash provisioning). |

Commands run: baseline `npx vitest run <all 45 files>` (one process, 637 s); targeted reruns of every edited file (cloud-tenant-actor, adapter-registry-bootstrap x2, heartbeat-run-runtime-status, broker-client, loopback-listener: 48 pass, 12 skipped; claude-agent-id-header, request-promise-memo, issue-thread-interaction-resolution: 27 pass); hot-restart alone; wp-close-export alone x2.

## 4 Comprehensive assessment (cross-cutting, by rubric code)

| Code | Count | Finding |
|---|---|---|
| V1 Validity | 0 defects | All subjects exist and match current behaviour. Cloud-tenant, Kubernetes execution-policy and managed-environment code paths still exist in the fork and are covered; whether they remain product scope is a roadmap question (section 7), not a test defect. |
| V2 Meaningful assertions | 2 fixed, 3 noted | (fixed) `issue-thread-interaction-resolution` first `it.each` ran five identical bodies because the row value was never used and the evaluator is kind-agnostic; kind is now passed into the interaction. (fixed) `request-promise-memo` 7-row table claimed "never reuses a decision after an actor change" but the memo is keyed by request object identity (WeakMap), so no actor field is inspected; titles and a comment now state what is actually proven. (noted) `managed-environments` "logs, not throws" asserts only a call count; `execution-policy-bootstrap` never asserts `updateGeneral` was called with the execution mode; `routines-formatter-cache` second half asserts zero constructions (valid). |
| V3 Determinism | 1 fixed, 6 noted | (fixed) wp-close-export 50 ms sleep -> bounded poll. (fixed) heartbeat-run-runtime-status compared a 2026-06 fixture to the real wall clock; now pins `now`. (noted) run-log-store 50/60 ms negative-assertion sleeps (3), `settle()`/`tick()` via `setImmediate` in setup-token-route and managed-environments, http/execute 1 ms real timeout (abort-driven, effectively deterministic), loopback-listener live tests use a fixed port derived from the exposure range. |
| V4 Isolation | 0 defects | Env vars, fake timers, temp dirs and module registry are restored (`vi.resetModules`, `finally { vi.useRealTimers() }`, `afterEach` rm). `adapter-registry-bootstrap.reconcile` repeated `mockReset()` inline; moved to `beforeEach`. Cloud-tenant debounce state is a `WeakMap` per Db object so each test's new fake Db is isolated. |
| V5 Mock fidelity | 6 noted | Hand-built Db fakes with positional/chained shapes (cloud-tenant-actor, discord-integrations `selectRows` FIFO queue, issue-thread-interactions `selectCallCount`, board-auth, responsible-user-denial) will rot if the services reorder queries; they are all dependencies, never the SUT. `write-path-membership` and `setup-token-route` replace `services/index.js` wholesale with hand-listed exports instead of `importOriginal` (risk: a new export consumed by the route fails at import, as happened to other tests). `registry`/`broker` fakes in exposure-manager and broker-client are typed against the real interfaces (good). |
| V6 Clarity | 2 fixed, 5 noted | (fixed) broker-client timeout test asserted `resolves.toBe(true)` over an opaque helper; it now asserts the real `BrokerClientError` and `cli_timeout` code. (fixed) memo table titles. (noted) multi-scenario loops inside one `it`: setup-token-route "rejects an archived, a local, an ssh, and a fake-provider environment", managed-environments "moves a local (or dangling) default", "reverts a stamped managed default", hot-restart "distinguishes recycled PIDs" (13 asserts), exposure-manager none. |
| V7 Coverage balance | 4 added, gaps in section 7 | Added: bootstrap `PAPERCLIP_ADAPTERS_FILE` success / inline-wins / unreadable-file; reconcile `enabled:false`; claude header (no config, CR/LF-only id, case-insensitive duplicate); cloud-tenant debounce hit and expiry. |
| V8 Portability | 4 files | wp-close-export (embedded PG), worktree-seed-server-spawn (bash, chmod, node shebang hook), hot-restart (real probe uses `process.pid`), broker-client (Unix socket) and loopback-listener (/proc). The latter two were guarded; the first three were noted only. |
| V9 Maintainability | 8 noted | Row literals repeated 4x in issue-thread-interactions; duplicate expectation `label: "Corrective handoff run"` twice in successful-run-handoff; `hasPersistedMonitor` skip asserted in 3 tests; dynamic `await import` inside execution-allowlist helpers tests; `// Option A / Change B / PAP-xxxxx / #8033` comments reference external design docs and issues that do not exist in this fork's tracker. |

## 5 Summary of results

| File | Tests | Verdict | Defects | Action |
|---|---|---|---|---|
| server/src/__tests__/worktree-seed-server-spawn.test.ts | 1 | VALID_WITH_NOTES | V8 | None. Passes on Windows. Relies on bash + node-shebang git hook; POSIX-oriented but green here. |
| server/src/__tests__/wp-close-export.test.ts | 15 | REWRITTEN | V3, V8 | Replaced fixed 50 ms sleep with bounded `vi.waitFor` poll. DB suite not runnable here (ENV, embedded PG timeout); 5 fixture tests pass. |
| server/src/__tests__/write-build-stamp.test.ts | 5 | VALID | none | None. |
| server/src/__tests__/write-path-membership.test.ts | 8 | VALID_WITH_NOTES | V5, V9 | None. Wholesale `services/index.js` mock. |
| server/src/adapters/claude-agent-id-header.test.ts | 9 (was 6) | REWRITTEN | V7 | Added 3 tests: missing config, CR/LF-only id passes through, case-insensitive existing header. |
| server/src/adapters/http/execute.test.ts | 1 | VALID_WITH_NOTES | V3, V7 | None. Only the timeout path is covered (see section 7). |
| server/src/adapters/plugin-loader.test.ts | 4 | VALID | none | None. |
| server/src/adapters/registry.test.ts | 2 | VALID_WITH_NOTES | V7 | None. Covers only codex_local / claude_local login capability. |
| server/src/instrumentation.test.ts | 9 | VALID | none | None. |
| server/src/lib/request-promise-memo.test.ts | 12 (was 11) | REWRITTEN | V2, V6, V7 | Retitled 7-row table and documented identity-keyed semantics; added different-keys-on-same-request test. |
| server/src/middleware/cloud-tenant-actor.test.ts | 21 (was 19) | REWRITTEN | V5, V7 | Added debounce-hit (purge never debounced) and debounce-expiry (fake timers) tests. Hand-built Db noted. |
| server/src/routes/adapters.test.ts | 3 | VALID | none | None. |
| server/src/routes/discord-integrations.test.ts | 16 | VALID_WITH_NOTES | V5, V9 | None. FIFO `selectRows` queue couples tests to query order; magic `toHaveLength(9)`. |
| server/src/routes/setup-token-route.test.ts | 28 | VALID_WITH_NOTES | V3, V5, V6 | None. Strong end-to-end security coverage; one multi-scenario test. |
| server/src/services/adapter-login-lease.test.ts | 6 | VALID | none | None. |
| server/src/services/adapter-models-env.test.ts | 5 | VALID | none | None. |
| server/src/services/adapter-registry-bootstrap.reconcile.test.ts | 4 (was 3) | REWRITTEN | V4, V7 | `mockReset` to `beforeEach`; added `enabled:false` test and no-mutation assertion on the throw path. |
| server/src/services/adapter-registry-bootstrap.test.ts | 7 (was 4) | REWRITTEN | V7 | Added 3 tests for the `PAPERCLIP_ADAPTERS_FILE` branch (read, precedence, unreadable). |
| server/src/services/attention-resolver-audience.test.ts | 6 | VALID | none | None. |
| server/src/services/board-auth.test.ts | 2 | VALID_WITH_NOTES | V5 | None. Minimal Db fake. |
| server/src/services/environment-custom-image-terminal-sessions.test.ts | 11 | VALID | none | None. Explicit clock injection, no wall clock. |
| server/src/services/execution-allowlist.test.ts | 15 | VALID | V9 | None. |
| server/src/services/execution-policy-bootstrap.test.ts | 12 | VALID_WITH_NOTES | V2, V7 | None. `updateGeneral` call never asserted. |
| server/src/services/heartbeat-run-runtime-status.test.ts | 6 | REWRITTEN | V3 | Pinned `now` on the final expiry read (was real wall clock vs 2026-06 fixture). |
| server/src/services/heartbeat-stop-metadata.test.ts | 7 | VALID | none | None. |
| server/src/services/hot-restart.test.ts | 17 | VALID_WITH_NOTES | V6, V8 | None. 5 ENV failures (pwsh probe timeout on Windows), 12 pass. |
| server/src/services/issue-thread-interaction-resolution.test.ts | 15 (10 `it`) | REWRITTEN | V2 | The 5-row `it.each` now passes the row's kind into the interaction (rows were identical). |
| server/src/services/issue-thread-interactions.test.ts | 13 (8 `it`) | VALID_WITH_NOTES | V5, V9 | None. |
| server/src/services/managed-environments.test.ts | 21 | VALID_WITH_NOTES | V2, V3, V6 | None. |
| server/src/services/managed-resource-drift.test.ts | 5 | VALID_WITH_NOTES | V7 | None. Boundary: resourceId set with null currentHash not covered. |
| server/src/services/onboarding-greeting.test.ts | 4 | VALID | none | None. |
| server/src/services/recovery/model-profile-hint.test.ts | 3 | VALID | none | None. |
| server/src/services/recovery/provider-failure-classification.test.ts | 9 | VALID | none | None. Clocks injected. |
| server/src/services/recovery/review-path-recovery.test.ts | 4 | VALID | none | None. |
| server/src/services/recovery/service.pause-durability.test.ts | 6 | VALID_WITH_NOTES | V9 | None. Comments cite external "Option A / Change B". |
| server/src/services/recovery/stranded-notice.test.ts | 13 | VALID | none | None. |
| server/src/services/recovery/successful-run-handoff.test.ts | 31 | VALID_WITH_NOTES | V9 | None. Duplicated expectations. |
| server/src/services/responsible-user-denial-run-outcomes.test.ts | 3 | VALID | none | None. |
| server/src/services/routines-formatter-cache.test.ts | 2 | VALID | none | None. |
| server/src/services/run-log-store.test.ts | 15 | VALID_WITH_NOTES | V3 | None. Three short negative-assertion sleeps. |
| server/src/services/run-scratch.test.ts | 5 | VALID | none | None. |
| server/src/services/runtime-exposure/broker-client.test.ts | 8 | REWRITTEN | V6, V8 | Timeout test now asserts the real error object/code; whole describe guarded on win32 (Unix socket). Not run here (skipped on Windows). |
| server/src/services/runtime-exposure/exposure-manager.test.ts | 21 | VALID_WITH_NOTES | V9 | None. |
| server/src/services/runtime-exposure/loopback-listener.test.ts | 14 | REWRITTEN | V3, V8 | Live-socket describe guarded to Linux (reads /proc); fixed-port rationale documented. 10 parser tests unchanged and pass. |
| server/src/services/runtime-exposure/port-pair.test.ts | 10 | VALID | none | None. |

## 6 Per-test detail (tests that are not clean)

| File | Test name | Code | Finding | Action |
|---|---|---|---|---|
| wp-close-export | persists a wp-close-export document on the WP issue once it closes | V3 | Fixed 50 ms sleep to wait for a best-effort post-commit hook; races on slow hosts and over-waits on fast ones. | Replaced with `vi.waitFor` (5 s bound, 25 ms interval). |
| wp-close-export | (DB suite, 10 tests) | V8 | Needs embedded Postgres; hard-coded 30 s `beforeAll`. | None; ENV on this host. |
| request-promise-memo | never reuses a decision across requests after a %s change (7 rows) | V2, V6 | Memo keys by request object (WeakMap); actor patches never influence the result, so the rows were identical and the title overclaimed. | Retitled "does not share a decision with a distinct request object whose %s differs"; comment documents identity-keyed semantics. |
| issue-thread-interaction-resolution | allows the creator and creating run under anyone for %s (5 rows) | V2 | Callback ignored the row; five identical runs. Evaluator has no `kind` input. | Row `kind` passed into `interaction({ kind })` to prove kind-independence. |
| heartbeat-run-runtime-status | stores scoped ephemeral status and expires stale entries | V3 | Final `getHeartbeatRunRuntimeStatus("run-1")` used the real clock against a 2026-06 fixture. | Pinned `now` just past the 90 s TTL. |
| adapter-registry-bootstrap.reconcile | all three | V4 | `mockReset()` repeated inline in each test. | Moved to `beforeEach`. |
| adapter-registry-bootstrap.reconcile | throws when a declared adapter has no installed implementation | V7 | Did not prove fail-before-mutate. | Added `setAdapterDisabled` not-called assertion. |
| runtime-exposure/broker-client | times out when the broker accepts but never responds | V6 | `resolves.toBe(true)` over a helper returning a boolean hides which error was thrown. | Helper returns the error; test asserts `BrokerClientError` and `code: "cli_timeout"`. |
| runtime-exposure/broker-client | all 8 | V8 | Unix-domain socket on a temp file path; impossible on Windows. | `describe.skipIf(win32)`. |
| runtime-exposure/loopback-listener | 4 live-listener tests | V3, V8 | Reads `/proc`; fixed port in the exposure range. | `describe.skipIf(platform !== "linux")` and rationale comment. |
| setup-token-route | rejects an archived, a local, an ssh, and a fake-provider environment | V6 | Four scenarios in one test via loop. | None (assertion message names the scenario). |
| managed-environments | logs, not throws, when the recovery re-ensure fails | V2 | Only asserts the mock was called once; "does not throw" is implicit. | None; vitest fails on unhandled rejection. |
| managed-environments | moves a local (or dangling) instance default... / reverts a stamped managed default... | V6 | Two scenarios per test. | None. |
| execution-policy-bootstrap | does not throw when every company gets a managed environment | V2, V7 | `updateGeneral` (persisting the execution mode) is never asserted. | None; recorded as gap. |
| discord-integrations | all task-create tests | V5, V9 | `selectRows` FIFO queue encodes query order. | None. |
| issue-thread-interactions | answerQuestions / withdraw / expire tests | V5, V9 | `selectCallCount === 1` convention and repeated 20-field row literals. | None. |
| cloud-tenant-actor | (all) | V5 | Hand-built chainable Db fake. | None; new debounce tests follow the same fake. |
| cloud-tenant-actor | (missing) | V7 | No test for the 5 s debounce hit/expiry. | Added 2 tests. |
| claude-agent-id-header | (missing) | V7 | No test for absent config, empty id after stripping, or case-insensitive duplicate. | Added 3 tests. |
| adapter-registry-bootstrap | (missing) | V7 | `PAPERCLIP_ADAPTERS_FILE` branch untested. | Added 3 tests. |
| hot-restart | 5 tests using the real win32 probe | V8 | Use real `process.pid` probe; Windows PowerShell exceeds the 1.5 s production timeout under load. | None; ENV (P1). |
| run-log-store | is OFF by default / throttles / finalize supersedes | V3 | 50-60 ms real sleeps backing negative assertions. | None; bounded, cannot false-fail. |
| successful-run-handoff | exhausted notice / handoff skips | V9 | Duplicate `label: "Corrective handoff run"` expectation; `hasPersistedMonitor` skip asserted in 3 tests. | None. |
| managed-resource-drift | classifies %s | V7 | No case for resourceId present with null currentHash. | None; gap. |
| http/execute | reports configured request timeout as timed_out | V7 | Only path covered. | None; gap. |

## 7 Evaluation and recommendations

Product findings (no test was bent to hide any of them):

* P1 (low, Windows only): `hot-restart.ts` `runProcessCommand` uses a 1 500 ms timeout for `powershell.exe`/`pwsh.exe`. Cold PowerShell start measured 1.5 s to 2.5 s on a loaded Windows 11 host, so process-identity probing fails and `writeHotRestartIntent` rejects. Linux production is unaffected; consider a larger Windows timeout if Windows dev is a supported hot-restart host.
* P2 (design note): `createRequestPromiseMemo` is keyed by request-object identity only. Any code that mutates `req.actor` (membership, role, key scope) between two loads within one request would reuse a stale authorization decision. Callers must treat actor as immutable per request; worth a doc comment on the module.
* P3 (scope question): cloud-tenant provisioning ("Provisioned by Paperclip Cloud"), Kubernetes execution policy and managed Daytona sandboxes are retained from upstream and still tested. Confirm against roadmap.md that they remain fork scope; if not, the tests become removal candidates together with their subjects.

Coverage gaps (not added because they need design decisions or larger fixtures):

* http adapter `execute`: success, non-2xx, network error, and payload/headers paths are untested (only timeout).
* `execution-policy-bootstrap`: persisting the execution mode through `updateGeneral` is unasserted.
* `adapters/registry.test.ts`: no assertion about the fork's selectable-adapter defaults (hermes_gateway, hermes_local); those belong in a registry default test owned by another shard.
* `managed-resource-drift`: inconsistent-input boundary.
* Services mocking `services/index.js` wholesale (`write-path-membership`, `setup-token-route`) should migrate to `importOriginal` spreads so new exports do not break them.
* Extract shared fixtures: interaction row literal (issue-thread-interactions), Db chain fakes (cloud-tenant, discord).
* Move the 30 s embedded-Postgres `beforeAll` timeout into a shared helper constant so it can be raised for slow hosts without editing 100+ files.

## 8 Summary of activities

Files rewritten (test-only edits, no production code, config or snapshot touched; line endings preserved CRLF in the working tree):

* server/src/__tests__/wp-close-export.test.ts - fixed sleep replaced by bounded poll (V3).
* server/src/adapters/claude-agent-id-header.test.ts - 3 coverage tests (V7).
* server/src/lib/request-promise-memo.test.ts - honest titles for identity-keyed memo; 1 added test (V2/V6/V7).
* server/src/middleware/cloud-tenant-actor.test.ts - 2 debounce tests (V7).
* server/src/services/adapter-registry-bootstrap.reconcile.test.ts - `beforeEach` reset, enabled:false test, fail-before-mutate assertion (V4/V7).
* server/src/services/adapter-registry-bootstrap.test.ts - 3 file-branch tests (V7).
* server/src/services/heartbeat-run-runtime-status.test.ts - pinned clock on expiry assertion (V3).
* server/src/services/issue-thread-interaction-resolution.test.ts - row parameter actually used (V2).
* server/src/services/runtime-exposure/broker-client.test.ts - assert real error; win32 guard (V6/V8).
* server/src/services/runtime-exposure/loopback-listener.test.ts - Linux guard on /proc-dependent live tests (V8).

Deletions: none. Tests added: 10 (424 -> 434).

Commands and outcomes:

* `npx vitest run <45 files>` (baseline): 4 files failed, 13 tests failed (all ENV), 408 passed, 10 skipped, 637 s.
* `npx vitest run claude-agent-id-header request-promise-memo issue-thread-interaction-resolution`: 27 passed.
* `npx vitest run cloud-tenant-actor adapter-registry-bootstrap(.reconcile) heartbeat-run-runtime-status broker-client loopback-listener`: 48 passed, 12 skipped (platform guards).
* `npx vitest run hot-restart`: 13 passed, 4-5 ENV failures (pwsh timeout), unchanged file.
* `npx vitest run wp-close-export` (x3): 5 fixture tests passed; DB suite blocked by embedded-PG startup timeout (ENV).

## 9 Approvals

| Role | Name | Signature | Date |
|---|---|---|---|
| Test author / auditor | | | |
| Reviewer | | | |
| Product owner | | | |
