# Test Summary Report: shard server-09 (IEEE 829)

## 1 Report identifier and scope

- Report id: server-09
- Project: `@paperclipai/server` (vitest project `server`), t3-nightly slow-tests audit
- Files: 5 (environment probe, routes, run orchestrator, runtime driver contract, duplex bridge input)
- Test cases: 129 after edits (112 before; +17 added, 0 removed). Table expansion: the driver-contract file builds 2 cases from a `contractCases` loop plus 1 SSH case.
- Date: see git

## 2 Summary

All five files were read in full and checked against the current source (`services/environment-probe.ts`, `environment-run-orchestrator.ts`, `environment-runtime.ts`, `routes/environments.ts`). No file tests removed or upstream-only behaviour: every subject exists and every assertion matches current behaviour.

Verdicts: VALID 0, VALID_WITH_NOTES 2 (routes, duplex), REWRITTEN 3 (probe, orchestrator, driver contract), OBSOLETE_REMOVED 0, NEEDS_DECISION 0.

## 3 Variances

- Embedded-Postgres suites (`environment-runtime-driver-contract`, `environment-runtime-duplex-bridge-input`) could not be verified on this Windows host: `beforeAll` timed out at 30 s while starting embedded Postgres (ENV, Windows start-up/contention; both files were run in one process). The remaining tests in those files were reported skipped/passed by vitest (2 passed, 6 skipped overall). The driver-contract edit (`it.skipIf`) is therefore verified only by a clean module load, not by a green DB run.
- SSH fixture contract case needs a POSIX sshd lab; not exercised here.
- Server suites run only in t3-nightly; rerun the three DB-free files in CI context after merge (`pnpm --filter @paperclipai/plugin-sdk ensure-build-deps` first).

## 4 Comprehensive assessment (defects by rubric code)

| Code | Count | Notes |
|---|---|---|
| V1 Validity | 0 | Cloud-tenant / managed-config / kubernetes-marker behaviour in routes tests is still implemented in `routes/environments.ts`, so tests are valid; see recommendation R3. |
| V2 Meaningful assertions | 2 | Driver-contract SSH test returned early (vacuous pass) when SSH lab unsupported; lease-list route test asserted only the service call, not the response. Both fixed. |
| V3 Determinism | 0 | Routes server binds port 0; no timers or network. |
| V4 Isolation | 3 | Orchestrator: `clearAllMocks` kept `resolveEnvironmentExecutionTarget` implementations across tests (fixed with `mockReset`). Routes: process env vars `PAPERCLIP_CLOUD_TENANT_SERVER_TOKEN`, `PAPERCLIP_MANAGED_CONFIG`, `PAPERCLIP_EXECUTION_MODE` leaked from host (fixed in top `beforeEach`). Duplex: DB state is shared and the "default" test relies on running first (noted). |
| V5 Mock fidelity | 0 | Orchestrator `environmentService` mock is a hand-built stand-in but only the orchestrator's four used methods; acceptable, noted. |
| V6 Clarity | 2 | Orchestrator test named "non-sandbox driver" actually exercises `plugin` only (renamed). Routes stream-flag test covers two behaviours (noted). |
| V7 Coverage balance | 3 | Orchestrator had no tests for `resolveEnvironment`, `acquireForRun`, `releaseForRun`; probe had no negative paths for runtime-lease sandbox and missing plugin worker manager. Added. |
| V8 Portability | 1 | Contract SSH case is POSIX-only; now reported as skipped instead of passing. |
| V9 Maintainability | 2 | Orchestrator repeats a 25-line `buildWorkspaceRealizationRequest` fixture four times; routes file repeats SSH and secure-plugin config literals. Noted, not refactored. |

## 5 Summary of results

| File | Tests | Verdict | Defect codes | Action |
|---|---|---|---|---|
| server/src/__tests__/environment-probe.test.ts | 12 (7 + 5 new) | REWRITTEN | V7 | Added 5 negative/boundary tests; 12/12 pass |
| server/src/__tests__/environment-routes.test.ts | 85 | VALID_WITH_NOTES | V2, V4, V6, V9 | Hermetic env reset in `beforeEach`; lease list asserts body; 85/85 pass |
| server/src/__tests__/environment-run-orchestrator.test.ts | 24 (11 + 13 new) | REWRITTEN | V4, V6, V7 | `mockReset` of target mock, rename, stronger provision assertion, 13 new tests; 24/24 pass |
| server/src/__tests__/environment-runtime-driver-contract.test.ts | 3 | REWRITTEN | V2, V8 | SSH case `it.skipIf` instead of silent early return; not runnable here (ENV) |
| server/src/__tests__/environment-runtime-duplex-bridge-input.test.ts | 5 | VALID_WITH_NOTES | V4 | Unedited; 2 pure tests valid, 3 DB tests unverified (ENV) |

## 6 Per-test detail (tests that are not clean)

| File | Test | Code | Finding | Action |
|---|---|---|---|---|
| environment-run-orchestrator | non-sandbox driver skips workspace realization... | V6 | Name overstated: local and ssh do realize | Renamed to "plugin driver ..." |
| environment-run-orchestrator | runs a remote provision command after workspace realization | V2 | Did not assert `timeoutMs` / `bypassSession`, which the source sets deliberately | Added both |
| environment-run-orchestrator | realization failure; target resolution failure; surfaces remote provision failures | V4 | Mock return value of `resolveEnvironmentExecutionTarget` inherited from previous test | `mockReset` in `beforeEach` |
| environment-run-orchestrator | (new) resolveEnvironment x5, acquireForRun x3, releaseForRun x5 | V7 | Previously untested public methods | Added |
| environment-probe | (new) no companyId; acquire failure; release failure does not mask success; plugin sandbox without worker manager; plugin env without worker manager | V7 | Negative paths of `probeEnvironment` untested | Added |
| environment-runtime-driver-contract | SSH satisfies the acquire/release host contract | V2, V8 | Returned early with only a `console.warn`, so it passed vacuously | `it.skipIf(!supported)` plus module-level warn |
| environment-routes | lists leases for an environment... | V2 | Asserted only the service call | Added response body assertions |
| environment-routes | (all) | V4 | Host env vars could flip behaviour of cloud-tenant gate | Cleared in top `beforeEach` |
| environment-routes | keeps the host-owned stream flag and drops a removed flag... | V6 | Two behaviours in one test | Noted |
| environment-routes | marker-clear "allows ..." tests (3) | V2 | Assert only `update` was called, not the arguments | Noted |
| environment-runtime-duplex-bridge-input | defaults the per-run bridge input to the file bridge | V4 | Passes only if run before the other DB tests (shared DB) | Noted |

## 7 Evaluation and recommendations

- R1 (coverage): `environment-run-orchestrator` still lacks tests for `acquireLease`/`resolveTransport` transport error wrapping with a non-null transport, and for `lease_cleanup_failed` (code defined, never thrown in source; possibly dead error codes `probe_failed`, `unsupported_environment`, `unsupported_adapter_environment`, `lease_release_failed`).
- R2 (routes): Extract shared SSH / secure-plugin config fixtures (V9); strengthen the three marker-clear tests to assert the patched metadata.
- R3 (product, not a defect): Cloud-tenant, managed-config and kubernetes-mode floors in `routes/environments.ts` are upstream cloud-product concepts. They remain in the fork and are tested, but the owner should confirm they are intended to stay; if removed, about 25 nested tests become obsolete.
- R4 (duplex file): reset the instance setting in `beforeEach` of a separate default test to remove the ordering dependence.
- No suspected production bugs found.

## 8 Summary of activities

Files rewritten:
- environment-probe.test.ts: added 5 negative-path tests (V7).
- environment-run-orchestrator.test.ts: mock reset, rename, assertion strengthening, 13 new tests for resolve/acquire/release (V4, V6, V7).
- environment-runtime-driver-contract.test.ts: honest skip for SSH case (V2, V8).
- environment-routes.test.ts (notes only, small edits): env hermeticity and lease response assertions.

Deletions: none.

Commands (repo root, Windows):
- `npx vitest run server/src/__tests__/environment-run-orchestrator.test.ts`: 24 passed.
- `npx vitest run server/src/__tests__/environment-probe.test.ts`: 12 passed.
- `npx vitest run server/src/__tests__/environment-routes.test.ts`: 85 passed (before and after edit).
- `npx vitest run ...driver-contract ...duplex-bridge-input`: ENV failure, embedded Postgres `beforeAll` timeout (30 s); 2 passed, 6 skipped.

## 9 Approvals

Prepared by: ______________________  Date: __________

Reviewed by: ______________________  Date: __________

Approved by: ______________________  Date: __________
