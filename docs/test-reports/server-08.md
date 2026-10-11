# Test Summary Report - shard server-08 (IEEE 829 structure)

## 1 Report identifier and scope

- Report id: server-08
- Project: `@paperclipai/server` (vitest project `server`), directory `server/src/__tests__/`
- Suite: t3-nightly "slow-tests" full vitest run, shard 08 of the server project
- Files in shard: 28
- Test cases: 268 (docker-build-stamp counts as 4 because of one `it.each` over 3 workflows; the others are plain `it`)
- Date: see git
- Rubric: ISO/IEC/IEEE 29119 and ISTQB principles V1-V9 (validity, meaningful assertions, determinism, isolation, mock fidelity, clarity, coverage balance, portability, maintainability)

## 2 Summary

Every file was read in full and checked against the production source it imports (services, routes, scripts, Dockerfile, shared support tables). The subjects all still exist in this fork. No test asserts upstream-only behaviour (the docker-build-stamp test was already moved to the three t3-* workflows).

Headline verdicts (28 files):

| Verdict | Files |
|---|---|
| VALID | 9 |
| VALID_WITH_NOTES | 12 |
| REWRITTEN | 7 |
| OBSOLETE_REMOVED | 0 |
| NEEDS_DECISION | 0 |

Real defects fixed: 3 (a wrong cleanup handle that leaked three embedded Postgres clusters, a `not.toBe(200)` assertion that a 500 also satisfied, a silent-pass live SSH smoke test). Robustness fixes: 4 (see section 8).

## 3 Variances (what could not be verified, and why)

- Host is Windows 11. All embedded-PostgreSQL suites fail in `beforeAll` here with "Hook timed out" (20 s or 30 s as coded; still 30 s with `--hookTimeout=120000` because the files pin the timeout on the hook itself). Classified ENV (Windows embedded-PG start/contention), not REAL. Affected files: decision-training, decisions-service, documents-service, document-annotations-service, environment-custom-images-service (its 3 DB-free tests pass). Their assertions were reviewed statically only. My edits to decisions-service and environment-custom-images-service were verified only to compile and load (the run reaches `beforeAll`).
- environment-live-ssh cannot reach any SSH target here (no explicit `PAPERCLIP_ENV_LIVE_SSH_*`, env-lab fixture does not start), so it is skipped by the new explicit skip. The real SSH path is unverified locally.
- docker-entrypoint ran on Windows through Git Bash `sh` with stubbed `id/usermod/gosu`; passes, but real root/uid behaviour is only exercised in Linux CI.
- dev-watch-ignore hit Windows symlink privilege (EPERM) before the fix; the fix uses `junction`, which is ignored on POSIX.
- Server suites do not run in t3-ci (only in t3-nightly). Nothing in this shard was verified against CI.

## 4 Comprehensive assessment (cross-cutting defects by rubric code)

| Code | Count | Summary |
|---|---|---|
| V1 Validity | 0 failing | All subjects exist; the remote-managed adapter list asserted in environment-execution-target matches `packages/shared/src/environment-support.ts`. Only a gap: nothing asserts the fork's Hermes adapters are local-only (V7). |
| V2 Meaningful assertions | 2 | environment-live-ssh returned early and passed with zero assertions when no SSH config resolved; environment-custom-image-routes accepted any non-200 for a malformed body (a 500 passed). Both fixed. |
| V3 Determinism | 3 | terminal-ws `waitForAssertion` was bounded by 20 event-loop turns (fixed to wall-clock); terminal-ws expiry test and document-annotations-service first test rely on short real sleeps (noted). |
| V4 Isolation | 3 | environment-custom-images-service never stopped its three embedded PG clusters (`started.stop` does not exist; fixed to `started.cleanup`); decisions-service leaked `PAPERCLIP_DECISION_SIGNING_SECRET` (fixed); dev-watch-ignore leaked a temp tree per run (fixed). |
| V5 Mock fidelity | 3 files | document-annotation-routes, environment-custom-image-routes, environment-instance-routes hand-build the whole `../services/index.js` module instead of `importOriginal`. Evidence of rot: document-annotation-routes logs `external object document sync failed: db.transaction is not a function` because the real external-objects service runs against `{}`. Not changed (broad rewrite); recorded as a recommendation. environment-execution-target* mock only one resolver and keep the rest real (good). |
| V6 Clarity | 5 | loops inside single `it` (remote-managed adapters, SSH/sandbox null case); one stale comment in docker-entrypoint ("stat probe", fixed); `flushMicrotasks` is a `setTimeout(0)` (duplex); mixed snake_case test names (capabilities, execution-target); a double-purpose final assertion in effective-run-config-fingerprints. |
| V7 Coverage balance | 6 gaps | See section 7. One cheap gap added (empty BETTER_AUTH_SECRET_FILE). |
| V8 Portability | 3 | docker-entrypoint is POSIX `sh` only (passes through Git Bash); dev-watch-ignore symlinks (fixed); live-ssh used `HOME ?? "/tmp"` (fixed with `os.homedir()`). |
| V9 Maintainability | 8 | Duplicated app/actor wiring x6 in decision-training; duplicated selector literal x14 in document-annotations-service; `seed()` copied three times in environment-custom-images-service; duplicate tests in environment-execution-target-capabilities (two identical "resolution rejects -> no snapshot") and in environment-execution-target (parenting tests overlap the three `test_exec_*` baselines); redundant `expiresAt: new Date(0)` update in decisions-service; near-duplicate docker-entrypoint PAPERCLIP_HOME test. All noted, none removed (rule: do not reduce cases). |

## 5 Summary of results

Run column meaning: P = passed locally, ENV = fails only because the embedded PostgreSQL cannot start on this Windows host (not a test defect).

| Path | Tests | Verdict | Defect codes | Action taken |
|---|---|---|---|---|
| server/src/__tests__/decision-training.test.ts | 14 | VALID_WITH_NOTES | V9, V7 | None. ENV, not runnable here. Six copies of the express+actor wiring; no test for a decision with zero comments before the cutoff. |
| server/src/__tests__/decision-wakeup.test.ts | 2 | VALID | - | None. P. |
| server/src/__tests__/decisions-service.test.ts | 34 | REWRITTEN | V4, V9, V6 | Restore ambient `PAPERCLIP_DECISION_SIGNING_SECRET` in afterAll. ENV; edit compile-checked only. Notes: `selectSpy.toHaveBeenCalledTimes(2)` couples to query count; redundant `new Date(0)` update. |
| server/src/__tests__/dev-runner-output.test.ts | 4 | VALID | - | None. P. |
| server/src/__tests__/dev-runner-paths.test.ts | 2 | VALID | - | None. P. |
| server/src/__tests__/dev-runner-snapshot.test.ts | 4 | VALID | - | None. P. |
| server/src/__tests__/dev-runner-worktree.test.ts | 6 | VALID | - | None. P. (`/tmp/...` strings are file content only, not touched on disk.) |
| server/src/__tests__/dev-server-status.test.ts | 4 | VALID_WITH_NOTES | V9 | None. P. `tempDirs = []` is an implicit `any[]`. |
| server/src/__tests__/dev-watch-ignore.test.ts | 1 | REWRITTEN | V8, V4 | `junction` links (fixes Windows EPERM) and temp-dir cleanup in afterEach. P after fix. |
| server/src/__tests__/discord-notification-events.test.ts | 2 | VALID | - | None. P. |
| server/src/__tests__/disposition-repair.test.ts | 3 | VALID_WITH_NOTES | V9 | None. P. Repeated jitter bound literals; jitter is deterministic per fingerprint, not random. |
| server/src/__tests__/docker-build-stamp.test.ts | 4 (2 definitions) | VALID | - | None. P. Already retargeted at t3-ci, t3-nightly and t3-release. |
| server/src/__tests__/docker-entrypoint.test.ts | 12 | REWRITTEN | V7, V6, V8 | Added "fails closed when BETTER_AUTH_SECRET_FILE is empty" (entrypoint branch was untested); fixed stale "stat probe" comment. P (12/12). POSIX `sh` only. |
| server/src/__tests__/document-annotation-routes.test.ts | 7 | VALID_WITH_NOTES | V5 | None. P. Hand-built services mock; unmocked external-object sync logs a swallowed TypeError. |
| server/src/__tests__/document-annotations-service.test.ts | 12 | VALID_WITH_NOTES | V3, V9, V7 | None. ENV, not runnable here. First test sleeps 50 ms to prove the writer is blocked; no stale/remap anchor test. |
| server/src/__tests__/documents-service.test.ts | 4 | VALID | - | None. ENV (embedded PG hook timeout at 20 s). |
| server/src/__tests__/documents.test.ts | 3 | VALID | - | None. P. |
| server/src/__tests__/effective-run-config-fingerprints.test.ts | 5 | VALID_WITH_NOTES | V6 | None. P. Last test ends with an unrelated `canonicalizeEffectiveRunConfigCategory` assertion (two reasons to fail). |
| server/src/__tests__/embedded-postgres-supervisor.test.ts | 3 | VALID_WITH_NOTES | V7 | None. P. `onRestartAttemptFailed`, `beforeRestart` and `onUnexpectedExit` are unasserted; shutdown-during-recovery untested. |
| server/src/__tests__/environment-config.test.ts | 13 | VALID_WITH_NOTES | V7 | None. P. No out-of-range port or unknown-driver cases; only two rejection cases. |
| server/src/__tests__/environment-custom-image-routes.test.ts | 20 | REWRITTEN | V2, V5 | Local error handler maps ZodError to 400 like the production `errorHandler`; unknown-key relink assertion tightened from `not.toBe(200)` to `toBe(400)`. P (20/20). |
| server/src/__tests__/environment-custom-image-terminal-ws.test.ts | 8 | REWRITTEN | V3 | `waitForAssertion` now wall-clock bounded (2 s, 5 ms poll) instead of 20 iterations. P (8/8). The ~1.1 s real-time expiry test keeps a ~1.3 s margin (noted). |
| server/src/__tests__/environment-custom-images-service.test.ts | 27 | REWRITTEN | V4, V9 | `started.stop` -> `started.cleanup` (3 places); `stop` is not a member of `EmbeddedPostgresTestDatabase`, so the embedded clusters were never stopped. 3 DB-free tests P, 24 ENV. `seed()` duplicated 3x. |
| server/src/__tests__/environment-execution-target-capabilities.test.ts | 17 | VALID_WITH_NOTES | V9, V6 | None. P. Two tests identical in behaviour; mixed naming style. |
| server/src/__tests__/environment-execution-target-duplex.test.ts | 11 | VALID_WITH_NOTES | V6 | None. P. `flushMicrotasks` is a macrotask; "ssh runner factory" tests an adapter-utils function. |
| server/src/__tests__/environment-execution-target.test.ts | 38 | VALID_WITH_NOTES | V6, V9 | None. P. Loop-in-`it` for adapter lists; overlapping parenting tests; last test characterises the pre-fix leak as a mechanism guard (intentional). |
| server/src/__tests__/environment-instance-routes.test.ts | 7 | VALID_WITH_NOTES | V5, V7 | None. P. Hand-built services mock; no agent-create or foreign-company 403 test. |
| server/src/__tests__/environment-live-ssh.test.ts | 1 | REWRITTEN | V2, V8 | Early `return` after `console.warn` (green with zero assertions) replaced by `ctx.skip(reason)`; `HOME ?? "/tmp"` replaced by `os.homedir()`. Reports skipped here. |

## 6 Per-test detail (tests that are not clean)

| File | Test | Code | Finding | Action |
|---|---|---|---|---|
| environment-live-ssh | connects to the configured SSH environment and verifies basic runtime tools | V2 | Passed with no assertion when config or fixture was unavailable (`return` after `console.warn`). | Replaced by `ctx.skip(...)`; the skip is visible in reports. |
| environment-live-ssh | (helper resolveEnvLabStatePath) | V8 | `process.env.HOME ?? "/tmp"` is POSIX-only. | `os.homedir()`. |
| environment-custom-image-routes | defaults the confirmation flag to false and rejects unknown body keys | V2 | `expect(status).not.toBe(200)`: the local error handler turned the ZodError into a 500, so a server crash also passed. | Handler maps ZodError to 400; assertion is `toBe(400)`. |
| environment-custom-image-terminal-ws | bridges websocket input...; applies the latest resize... (all users of waitForAssertion) | V3 | `waitForAssertion` gave up after 20 `setImmediate` turns, which can be exhausted on a loaded host. | Time-bounded retry. |
| environment-custom-image-terminal-ws | keeps established terminal sessions alive past connect-token expiry and closes them at setup expiry | V3 | Depends on real time: ~750 ms connect expiry, 2.5 s setup expiry, 400 ms grace. Margin ~1.3 s. | Noted. Fake timers are not usable with a live `ws` server. |
| environment-custom-images-service | all 24 DB tests | V4 | `stopDb = started.stop` (undefined) so `afterAll` was a no-op and three embedded PG clusters leaked per run. | `started.cleanup`. |
| decisions-service | all 34 | V4 | `beforeEach` sets `PAPERCLIP_DECISION_SIGNING_SECRET`, never restored. | Restored in afterAll. |
| decisions-service | loads target staleness in a bounded query for the open-decision list | V6 | Asserts `db.select` was called exactly twice: tied to implementation. | Noted. |
| decisions-service | expires TTL and target-gone decisions and wakes the origin agent | V9 | `expiresAt: new Date(0)` update is overwritten by `expireDecisionNow`. | Noted. |
| dev-watch-ignore | includes both the worktree UI paths and their real shared targets | V8, V4 | `fs.symlinkSync` EPERM on Windows without privilege; temp tree never removed. | `junction`, afterEach cleanup. |
| docker-entrypoint | (new) fails closed when BETTER_AUTH_SECRET_FILE is empty | V7 | Entrypoint has an "is empty" branch that no test covered. | Test added. |
| docker-entrypoint | remaps the node user and chowns /paperclip before gosu... | V6 | Comment said "stat probe"; the stub is `find`. | Comment fixed. |
| docker-entrypoint | honours PAPERCLIP_HOME for the ownership probe | V9 | Same arrange and assert as "chowns a root-owned home before gosu even with the default UID/GID". | Noted. |
| document-annotation-routes | all 7 | V5 | Hand-built `../services/index.js`; the real external-object sync runs with `db={}` and logs `db.transaction is not a function` (swallowed). | Noted; see section 7. |
| document-annotations-service | fails closed when a concurrent document update wins before annotation thread creation commits | V3 | 50 ms sleep to assert the call is still pending; a slow host passes that line vacuously (the 409 and zero-thread asserts still hold). | Noted. |
| effective-run-config-fingerprints | excludes generated run values, sensitive tokens, timestamps, and session path noise | V6 | Final `canonicalizeEffectiveRunConfigCategory` assertion is a separate behaviour. | Noted. |
| embedded-postgres-supervisor | bounds recovery attempts and reports the final failure | V7 | Does not assert `onRestartAttemptFailed` fired 3 times. | Noted. |
| environment-execution-target-capabilities | omits the snapshot when the resolution rejects / carries no snapshot for session-output streaming when the resolution rejects | V9 | Same arrange and assert. | Noted. |
| environment-execution-target-duplex | (helper) flushMicrotasks | V6 | Implemented as `setTimeout(0)`. | Noted. |
| environment-execution-target | resolves sandbox targets for every remote-managed adapter...; returns null for adapters without remote-managed environment support | V6 | Loop inside one `it`; the first failing adapter masks the rest (the assertion message carries the adapter name, which mitigates it). | Noted. |
| environment-execution-target | parents the exec span to the active step span...; opens an unparented exec span... | V9 | Overlap with `test_exec_inside_measured_step_parents_to_step_context` and `test_exec_in_root_region_is_unparented_today`. | Noted, kept. |
| environment-execution-target | leaks the ended step onto a continuation exec without the boundary wrap | V6 | Characterises a defect (the leak) as expected behaviour; documented as a mechanism guard for the wrapped tests. | Noted, kept. |
| environment-instance-routes | all 7 | V5, V7 | Hand-built services mock; no agent mutation or foreign-company 403 case. | Noted. |

## 7 Evaluation and recommendations

Product findings: none. No suspected production bug and no product decision is needed for this shard.

Recommendations (not done in this pass):

1. V5, highest value: replace the hand-built `vi.mock("../services/index.js", ...)` in document-annotation-routes, environment-custom-image-routes and environment-instance-routes with `importOriginal` plus overrides, as environment-execution-target-duplex already does for plugin-environment-driver. The swallowed `db.transaction is not a function` warning in document-annotation-routes is the first sign of drift.
2. Add a shared app/actor builder in decision-training (six copies) and a selector fixture in document-annotations-service. Needs a working embedded PG to verify, so deferred.
3. Coverage gaps worth adding when a Linux or WSL host is available: anchor remap/stale paths in document-annotations-service; `onUnexpectedExit`, `beforeRestart` and shutdown-during-recovery in embedded-postgres-supervisor; invalid port and unknown driver in environment-config; agent-create and foreign-company 403 in environment-instance-routes.
4. Fork policy check: `adapterSupportsRemoteManagedEnvironments` does not list the Hermes adapters; the test covers only `process` for the negative case. If Hermes should explicitly stay local-only, add `hermes_local` and `hermes_gateway` to the null-target test (a product decision, so not added here).
5. Run the five embedded-PG suites on Linux (the only ones this pass could not execute). The three `stopDb` fixes should also stop leaking PG data directories in t3-nightly.
6. environment-live-ssh now skips when no SSH target resolves; nightly will show it as skipped instead of green. If a live target is expected in nightly, set `PAPERCLIP_ENV_LIVE_SSH_*` there.

## 8 Summary of activities

Files rewritten (all test-only; no production code, config, workflow or snapshot touched):

- decisions-service.test.ts: restore the ambient decision signing secret in afterAll.
- dev-watch-ignore.test.ts: `junction` links for Windows and temp cleanup.
- docker-entrypoint.test.ts: one new test (empty secret file) and a comment fix.
- environment-custom-image-routes.test.ts: ZodError -> 400 in the local handler; `toBe(400)`.
- environment-custom-image-terminal-ws.test.ts: wall-clock bounded `waitForAssertion`.
- environment-custom-images-service.test.ts: `started.stop` -> `started.cleanup` (3 places).
- environment-live-ssh.test.ts: `ctx.skip` instead of a silent return; `os.homedir()`.

Deletions: none.

Commands run (repo root, one vitest process at a time):

- `npx vitest run` on the 10 small files (decision-wakeup, dev-runner-*, dev-server-status, dev-watch-ignore, discord-notification-events, disposition-repair, docker-build-stamp): 31 passed, 1 failed (dev-watch-ignore, ENV: EPERM symlink) before the fix; 1/1 passed after.
- docker-entrypoint (after edit): 12/12 passed.
- environment-live-ssh, documents-service, embedded-postgres-supervisor, effective-run-config-fingerprints, documents: 12 passed, 4 skipped; documents-service failed in `beforeAll` (ENV). After the edit live-ssh reports 1 skipped.
- decision-training with `--hookTimeout=120000`: 14 skipped, `beforeAll` timed out at the hard-coded 30 s (ENV).
- environment-custom-image-routes (after edit): 20/20 passed.
- environment-custom-image-terminal-ws (after edit): 8/8 passed.
- environment-custom-images-service (after edit): 3 passed, 24 skipped, 3 `beforeAll` timeouts (ENV; nothing attributable to the edit).
- document-annotation-routes, environment-instance-routes, environment-execution-target-capabilities, environment-execution-target-duplex, environment-execution-target, environment-config, decisions-service (after edit): 93 passed, 34 skipped; decisions-service `beforeAll` timeout (ENV).

## 9 Approvals

- Prepared by: ______________________  Date: __________
- Reviewed by (QA): __________________  Date: __________
- Approved by (owner): _______________  Date: __________
