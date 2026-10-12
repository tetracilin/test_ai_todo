# Test Summary Report: shard server-23 (IEEE 829)

## 1 Report identifier and scope

- Report id: server-23
- Project: `@paperclipai/server` (vitest project `server`), t3-nightly slow-tests audit
- Scope: 27 test files under `server/src/__tests__/` (plugin host services, install, lifecycle, routes, SDK harness, tenant isolation)
- Test cases: 256 after rewrite (253 before; one looped case was split into 4 `it.each` cases). `it.each` expansions are counted individually.
- Date: see git

## 2 Summary

Every file was read in full and checked against the production source it exercises (`plugin-host-services`, `plugin-loader`, `plugin-lifecycle`, `plugin-database`, `plugin-environment-driver`, `plugin-local-folders`, `plugin-install-guard`, `plugin-secrets-handler`, `routes/plugins`, plugin SDK `testing`/`worker-rpc-host`/`host-client-factory`). The subject under test exists in the fork for every file. Spot checks for fork drift (bundled plugin packages `plugin-modal`, `plugin-llm-wiki`, `plugin-workspace-diff`, `plugin-authoring-smoke-example`; LLM Wiki migrations 001-003) confirmed they exist. No test asserts upstream-only behaviour or a stale adapter default.

Verdicts: VALID 13, VALID_WITH_NOTES 12, REWRITTEN 2, OBSOLETE_REMOVED 0, NEEDS_DECISION 0.

## 3 Variances

- Embedded Postgres does not start on this Windows host (beforeAll hits its 20 s timeout and every test in the describe is reported "skipped"). 11 files are DB-backed: access-authorization-host-services, config-startup-delivery, database (9 of 22 cases), install-autobuild (route half), install-route-security, managed-agents, managed-routines, managed-skills, orchestration-apis, secrets-handler (integration half), tenant-isolation. They were reviewed statically only and not executed (ENV).
- A full-shard baseline run stalled behind the embedded-Postgres startups and was killed; unedited files were run only in a reduced batch.
- Edited files were run and pass: `plugin-host-services-span.test.ts` + `plugin-routes-authz.test.ts` = 59/59.
- Reduced batch of 14 unedited files: 82 passed, 5 failed. All 5 are ENV: `EPERM: operation not permitted, symlink` (Windows without symlink privilege) in `plugin-install-guard` (2) and `plugin-local-folders` (3). They are not production defects.
- `plugin-install-autobuild` (non-DB half) and the real-`pnpm install` / `npm install` paths were not run.

## 4 Comprehensive assessment

| Code | Count | Cross-cutting finding |
|---|---|---|
| V1 Validity | 0 | No stale or upstream-only expectations found. Ticket ids in comments (LOOA-xxx, PAP-9585, #5549) are historical references only. |
| V2 Meaningful assertions | 0 | No tautologies. Minor: `Promise.all([Promise.resolve(updatedPolicy), ...])` in access-authorization is noise only. |
| V3 Determinism | 6 | Wall-clock `Date.now()` bounds in host-services-span (fixed); real `npm install` against the registry (install-route-security, 150 s timeout); real `pnpm install`/build (install-autobuild); 50 ms sleep-based lock scheduling in orchestration-apis concurrent-cancel test; 1 s poll loop in environment-driver-seam; retry-sleep teardown in orchestration-apis. |
| V4 Isolation | 3 | `host.stop()` not in `finally` (seam, 2 tests); fixtures written into real `packages/plugins/` (autobuild, route-security) cleaned in afterEach but leak on hard abort; module-scoped plugin log buffer (tenant-isolation) handled with explicit flush. |
| V5 Mock fidelity | 3 | `createSessionLookupDb` (agent-sessions), `createSelectQueueDb` (routes-authz) are hand-built query-chain stubs coupled to the exact select/from/where/limit call order; `plugin-database` refresh test passes a hand-built loader deps object `as never`. Real modules otherwise (importOriginal not needed; registries mocked at the service seam). SUT is never mocked. |
| V6 Clarity | 4 | One test looped 4 cases with labels (fixed to `it.each`); one snake_case test title; multi-assert "validates/enforces/dispatches" seam tests; 22-case list in span test is clear. |
| V7 Coverage balance | 4 | See section 7. |
| V8 Portability | 6 | Symlink creation (guard, local-folders, route-security, tenant n/a) needs privilege on Windows; hard-coded `/app/packages/plugins` and `/tmp` literals; `pnpm` binary name; POSIX path fixtures. |
| V9 Maintainability | 3 | Manifest literal duplicated twice in orchestration-apis local-folder tests; repeated `createInstallApp` / `createBuiltPluginFixture` helpers across autobuild and route-security; repeated `createEventBusStub`. |

## 5 Summary of results

| File | Tests | Verdict | Defects | Action |
|---|---|---|---|---|
| plugin-access-authorization-host-services.test.ts | 5 | VALID_WITH_NOTES | V2 (minor), ENV-unrunnable | None. Not executed (embedded PG). |
| plugin-agent-sessions.test.ts | 1 | VALID_WITH_NOTES | V5, V7 | None. Passes. Hand-built query stub; only the success path tested. |
| plugin-config-startup-delivery.test.ts | 3 | VALID | none | None. Not executed (embedded PG). |
| plugin-database.test.ts | 22 | VALID_WITH_NOTES | V8 | None. Not executed in this run (batch excluded it); 13 non-DB cases are pure-function tests, 9 DB cases need embedded PG. Env-driver tests use `/app/...` path literals. |
| plugin-dev-watcher.test.ts | 4 | VALID | none | None. Passes. |
| plugin-environment-driver-ready-recovery.test.ts | 14 | VALID | none | None. Passes (as part of the batch). |
| plugin-environment-driver-sandbox-capabilities.test.ts | 1 | VALID_WITH_NOTES | V6 | None. Snake_case title only. Passes. |
| plugin-environment-driver-seam.test.ts | 6 | VALID_WITH_NOTES | V3, V4, V6 | None. Passes. 1 s poll helper and `host.stop()` outside `finally`. |
| plugin-execution-workspace-bridge.test.ts | 2 | VALID | none | None. Passes. |
| plugin-host-services-span.test.ts | 18 | REWRITTEN | V3 | Pinned `Date` with `vi.useFakeTimers({ toFake: ["Date"] })` so skew/age bounds are evaluated against a fixed clock. 18/18 pass. |
| plugin-install-autobuild.test.ts | 9 | VALID_WITH_NOTES | V3, V4, V8, V9 | None. Not executed. Writes fixtures into the repo tree; route half runs real pnpm. |
| plugin-install-guard.test.ts | 15 | VALID_WITH_NOTES | V8 | None. 2 symlink cases fail on this Windows host with EPERM (ENV). |
| plugin-install-route-security.test.ts | 13 | VALID_WITH_NOTES | V3, V8, V9 | None. Not executed (embedded PG). Last case needs `npm install` of a missing package (real registry call). |
| plugin-lifecycle-restart.test.ts | 2 | VALID | none | None. Passes. |
| plugin-local-folders.test.ts | 13 | VALID_WITH_NOTES | V8 | None. 3 symlink cases fail with EPERM on Windows (ENV). |
| plugin-managed-agents.test.ts | 6 | VALID_WITH_NOTES | V7 | None. Not executed (embedded PG). Adapter-preference test uses explicit adapters, so it is not affected by fork default changes. |
| plugin-managed-routines.test.ts | 3 | VALID | none | None. Not executed (embedded PG). |
| plugin-managed-skills.test.ts | 6 | VALID | none | None. Not executed (embedded PG). |
| plugin-orchestration-apis.test.ts | 29 (28 + 1 it.each x2) | VALID_WITH_NOTES | V3, V9 | None. Not executed (embedded PG). Concurrent-cancel test depends on scheduling (50 ms sleep). |
| plugin-routes-authz.test.ts | 41 (was 38) | REWRITTEN | V6 | Split the 4-case labelled loop into `it.each` so each out-of-scope runContext reference fails independently. 41/41 pass. |
| plugin-sandbox-provider-config-validation.test.ts | 3 | VALID | none | None. Passes. |
| plugin-scoped-api-routes.test.ts | 9 | VALID | none | None. Passes. |
| plugin-sdk-orchestration-contract.test.ts | 5 | VALID | none | None. Passes. |
| plugin-sdk-testing.test.ts | 8 | VALID | none | None. Passes. |
| plugin-secrets-handler.test.ts | 6 | VALID_WITH_NOTES | V7 | None. Not executed in this run; 4 unit cases are DB-free, 2 integration cases need embedded PG. |
| plugin-telemetry-bridge.test.ts | 4 | VALID | none | None. Passes. |
| plugin-tenant-isolation.test.ts | 8 | VALID | none | None. Not executed (embedded PG). |

## 6 Per-test detail (tests that are not clean)

| File | Test | Code | Finding | Action |
|---|---|---|---|---|
| plugin-host-services-span | accepts a pair whose end is a small skew ahead of the host clock; drops an invalid timestamp pair... | V3 | Compared against live `Date.now()` taken in test and in host; margins were wide but still clock-dependent. | Fixed with a pinned system time (Date only). |
| plugin-routes-authz | rejects tool execution when any runContext reference is outside the company scope | V6 | Four scenarios in one test; first failure hid the rest. | Split into `it.each` (4 cases). |
| plugin-install-guard | resolves symlinks to their target; rejects a symlink target that escapes the catalog root once canonicalized | V8 | `EPERM` on Windows without symlink privilege. | None (ENV, noted). |
| plugin-local-folders | detects required symlinks that escape; lists nested entries without following symlink escapes; revalidates temp-file containment | V8 | Same EPERM. The last one relies on a symlink swap race simulation. | None (ENV, noted). |
| plugin-install-route-security | does not apply the cloud floor when PAPERCLIP_MANAGED_CONFIG is absent | V3 | Depends on a real `npm install` of a nonexistent package; outcome depends on network/registry behaviour (up to 150 s). | None. Recommend stubbing the loader's npm step. |
| plugin-install-route-security | rejects a symlink inside the catalog root that points outside it | V8 | Symlink inside the real repo tree; needs privilege on Windows. | None. |
| plugin-install-autobuild | route tests ("auto-builds ...") | V3, V4 | Real `pnpm install --ignore-workspace` and build; fixtures created under `packages/plugins`. | None. Noted. |
| plugin-orchestration-apis | skips the assignee wakeup when the issue is cancelled concurrently | V3 | Ordering relies on starting the row-lock transaction before `createComment`; only scheduling, not outcome, but can race. | None. Recommend awaiting a lock-acquired signal. |
| plugin-environment-driver-seam | dispatches ... worker hooks (x2) | V3, V4 | 1 s deadline poll; `host.stop()` is skipped on assertion failure. | None. |
| plugin-environment-driver-sandbox-capabilities | test_capabilities_propagate_from_manifest_to_ready_driver_projection | V6 | Title style differs from the rest of the suite. | None. |
| plugin-agent-sessions | delivers the message body ... | V5/V7 | Query stub ignores the call shape; no failure path (wakeup rejection, non-done status). | None. |
| plugin-access-authorization-host-services | uses persisted agent policy ... | V2 (minor) | `Promise.all([Promise.resolve(updatedPolicy), ...])` adds noise. | None. |

## 7 Evaluation and recommendations

- Product findings: none. No test disagrees with current production behaviour and no suspected production bug.
- Environment: the Windows embedded-Postgres failure means 11 of 27 files in this shard have no local signal. They are covered by t3-nightly (Linux). Recommend confirming those 11 files green in the latest nightly run.
- Portability: add a shared `trySymlink` capability probe helper for symlink tests so that on privilege-less Windows they are reported as skipped for a stated reason rather than failing with EPERM. Not applied here because the rules forbid adding skips.
- Determinism: stub the npm step in the self-hosted npm-install route test; replace the 50 ms sleep in the concurrent-cancel test with an explicit "lock held" signal.
- Coverage gaps (cheap): agent-sessions has only a success path (add wakeup-reject and `failed` status); plugin-secrets-handler lacks a disabled/uninstalled-plugin case; managed-skills lacks a failure-path case for invalid manifest markdown; plugin-managed-agents covers `process` and `claude_local`/`codex_local` but not the Hermes Gateway default policy (fork-owned) for managed agents.
- Maintainability: extract shared `createInstallApp` / plugin fixture builders for autobuild and route-security; hoist the duplicated LLM Wiki manifest in orchestration-apis.

## 8 Summary of activities

Files rewritten:
- `server/src/__tests__/plugin-host-services-span.test.ts`: pin `Date` (fake timers, Date only) to remove wall-clock dependence in timestamp validation tests.
- `server/src/__tests__/plugin-routes-authz.test.ts`: convert looped four-scenario test to `it.each` for isolated failures.

Deletions: none.

Commands run (from repo root):
- `pnpm --filter @paperclipai/plugin-sdk ensure-build-deps`: ok.
- Baseline `npx vitest run <all 27 files>`: aborted after two embedded-Postgres files reported "skipped" after 20 s each (ENV).
- `npx vitest run plugin-host-services-span plugin-routes-authz`: 2 files, 59 passed.
- `npx vitest run` on 14 unedited non-DB files: 82 passed, 5 failed (ENV, symlink EPERM).

## 9 Approvals

- Prepared by: ____________________  Date: __________
- Reviewed by: ____________________  Date: __________
- Approved by: ____________________  Date: __________
