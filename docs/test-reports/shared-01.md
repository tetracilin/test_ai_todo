# Test Summary Report: shard shared-01 (IEEE 829)

## 1 Report identifier and scope

- Report id: `shared-01`
- Project: `packages/shared` (vitest project `@paperclipai/shared`)
- Suite: t3-nightly "slow-tests" audit, branch `test/slow-tests-audit`
- Files in shard: 44
- Test cases in shard: 378 after edits (370 before; 8 added). `it.each` tables are counted per expansion.
- Date: see git.
- Standard: ISO/IEC/IEEE 29119 and ISTQB, rubric V1 to V9 (validity, meaningful assertions, determinism, isolation, mock fidelity, clarity, coverage balance, portability, maintainability).

## 2 Summary

Every file was read in full and checked against the production module it imports. The shard is healthy: all 44 files and all 378 cases pass on Windows. No test asserted upstream-only behaviour, no test was obsolete, and none was deleted. Five files were edited for determinism, isolation, validity and one coverage gap.

| Verdict | Files |
|---|---|
| VALID | 28 |
| VALID_WITH_NOTES | 11 |
| REWRITTEN | 5 |
| OBSOLETE_REMOVED | 0 |
| NEEDS_DECISION | 0 |

Product finding (not a test defect): telemetry is enabled by default and targets upstream-owned endpoints (section 7).

## 3 Variances

- Run on Windows 11. `gitignore-runtime` needs the `git` binary and a git checkout; it passed here.
- Baseline run of the whole `@paperclipai/shared` project (66 files) showed 7 failures plus 1 unhandled EPERM, all in `worktree-port-registry.test.ts` and `worktree-seed-source.test.ts`. Both are outside this shard (owned by another agent). Classification: ENV (Windows symlink privilege and rename-over-existing semantics). They were not touched.
- Type-level assertions (`@ts-expect-error`, `AssertMissingKey`) are enforced by `tsc --noEmit` (the package `include` is `src`, so tests are compiled), not by vitest. `tsc --noEmit` in `packages/shared` was run after the edits and was clean.
- Coverage percentages were not collected.

## 4 Comprehensive assessment (cross-cutting defects by rubric code)

| Code | Count | Summary |
|---|---|---|
| V1 Validity | 3 | `environment-support` used a nonexistent adapter id `openclaw` (vacuous pass, fixed); upstream ticket and PR references (PAP-17256, PAP-2411, PR #9946) remain in comments of `loopback-bind` and `telemetry/client` (cosmetic); `adapter-registry` sample data uses upstream-style image and cluster names (data only). |
| V2 Meaningful assertions | 2 | `client-types` runtime assertion is trivial (real check is `@ts-expect-error`); `agent.adapter-auth-session` "owner read type" case asserts a literal it just built. Both are backed by `tsc`. |
| V3 Determinism | 3 | `routine-variables` compared against the live clock (UTC midnight and year-end race, fixed); `frontmatter` reads real SKILL.md files; `gitignore-runtime` shells out to git. |
| V4 Isolation | 3 | `home-paths` leaked its temp dir (fixed); `telemetry/client` and `telemetry/client-contract` stubbed `fetch` globally without `unstubAllGlobals` (fixed). |
| V5 Mock fidelity | 0 | Only `fetch` is stubbed (telemetry); the SUT is never mocked. `portability-zip` uses a purpose-built zip writer that mirrors the browser writer. |
| V6 Clarity | 2 | `app-definitions.test.ts` is written in minified one-line style; `environment-support` has one snake_case test name. |
| V7 Coverage balance | 2 | `resolveTelemetryConfig` opt-out gating was untested (added); `telemetry/retention` covers only two events. |
| V8 Portability | 1 | `gitignore-runtime` requires git on PATH and a real checkout. |
| V9 Maintainability | 5 | Overlap between `client.test.ts` and `client-contract.test.ts`; repeated literals in `pipeline-health`; source-text grep in `adapter-agnostic-keys`; README substring pins in `readme-contract`; exact slug list in `app-definitions`. |

## 5 Summary of results

| File | Tests | Verdict | Defect codes | Action taken |
|---|---|---|---|---|
| packages/shared/src/adapter-agnostic-keys.test.ts | 2 | VALID_WITH_NOTES | V9 | None. Second test greps server/UI source for the import; brittle but guards a real contract. |
| packages/shared/src/adapter-auth-check-code.test.ts | 1 | VALID | none | None. |
| packages/shared/src/adapter-types.test.ts | 5 | VALID | none | None. |
| packages/shared/src/agent-eligibility.test.ts | 13 | VALID | none | None. Good negative and boundary coverage (cycle, missing manager, unknown status). |
| packages/shared/src/app-definitions-url.test.ts | 3 | VALID | none | None. |
| packages/shared/src/app-definitions.test.ts | 5 | VALID_WITH_NOTES | V6, V9 | None. Minified formatting and an exact slug list; matches the current generated catalog. |
| packages/shared/src/config-schema.test.ts | 4 | VALID | none | None. |
| packages/shared/src/decision.test.ts | 5 | VALID | none | None. |
| packages/shared/src/document-anchors.test.ts | 9 | VALID | none | None. |
| packages/shared/src/dossier-view.test.ts | 11 | VALID | none | None. Fork-owned dossier behaviour; matches `dossier-view.ts`. |
| packages/shared/src/env-file.test.ts | 5 | VALID | none | None. The `#` comment case pins the dotenv semantics documented in the source. |
| packages/shared/src/environment-custom-images.test.ts | 4 | VALID | none | None. |
| packages/shared/src/environment-support.test.ts | 7 | REWRITTEN | V1, V6 | Replaced nonexistent adapter id `openclaw` with the real `openclaw_gateway`. |
| packages/shared/src/external-objects.test.ts | 10 | VALID | none | None. |
| packages/shared/src/feature-catalog.test.ts | 10 | VALID | none | None. Catalog is cross-checked against the live zod schema. |
| packages/shared/src/frontmatter.test.ts | 21 | VALID_WITH_NOTES | V3, V9 | None. Round-trip test scans real SKILL.md files (stable, repo-coupled). 3 expansions from `it.each`. |
| packages/shared/src/gitignore-runtime.test.ts | 1 | VALID_WITH_NOTES | V8 | None. Needs git on PATH and a git checkout. |
| packages/shared/src/home-paths.test.ts | 1 | REWRITTEN | V4 | Remove the mkdtemp directory in `afterEach`. |
| packages/shared/src/humanize-connection.test.ts | 8 | VALID | none | None. |
| packages/shared/src/issue-attribution.test.ts | 8 | VALID | none | None. |
| packages/shared/src/issue-references.test.ts | 7 | VALID | none | None. |
| packages/shared/src/issue-subtask-progress.test.ts | 5 | VALID | none | None. |
| packages/shared/src/issue-thread-interactions.test.ts | 22 | VALID | none | None. Includes `it.each` of 5 resolver policies. |
| packages/shared/src/issue-write-denial.test.ts | 17 | VALID | none | None. |
| packages/shared/src/markdown-work-products.test.ts | 23 | VALID | none | None. Includes two 4-row `it.each` tables. |
| packages/shared/src/pipeline-health.test.ts | 5 | VALID_WITH_NOTES | V9 | None. Repeated fixture literals could use a factory. |
| packages/shared/src/portability-fidelity.test.ts | 6 | VALID | none | None. |
| packages/shared/src/portability-zip.test.ts | 15 | VALID | none | None. Strong negative coverage (truncation, forged EOCD, bombs, duplicate paths). |
| packages/shared/src/project-mentions.test.ts | 5 | VALID | none | None. |
| packages/shared/src/resource-memberships.test.ts | 4 | VALID | none | None. |
| packages/shared/src/responsible-user-denial.test.ts | 10 | VALID | none | None. |
| packages/shared/src/routine-variables.test.ts | 16 | REWRITTEN | V3 | Built-in `date` and `timestamp` tests now use a frozen clock instead of the live clock. |
| packages/shared/src/runtime-exposure/loopback-bind.test.ts | 17 | VALID_WITH_NOTES | V1 | None. Comments cite upstream ticket PAP-17256; behaviour is current. |
| packages/shared/src/runtime-exposure/ports.test.ts | 7 | VALID | none | None. |
| packages/shared/src/settings-visibility.test.ts | 6 | VALID | none | None. |
| packages/shared/src/summary-slot.test.ts | 5 | VALID | none | None. |
| packages/shared/src/telemetry/client-contract.test.ts | 8 | REWRITTEN | V4, V9 | Added `vi.unstubAllGlobals()` to the `afterEach` hooks. Overlap with `client.test.ts` noted. |
| packages/shared/src/telemetry/client-types.test.ts | 1 | VALID_WITH_NOTES | V2 | None. Value is the compile-time `@ts-expect-error`; runtime assertion is trivial. |
| packages/shared/src/telemetry/client.test.ts | 33 | REWRITTEN | V1, V4, V7, V9 | Added `vi.unstubAllGlobals()`; added 8 cases for `resolveTelemetryConfig` opt-out gating (25 original). |
| packages/shared/src/telemetry/readme-contract.test.ts | 1 | VALID_WITH_NOTES | V9 | None. Pins README substrings; guards documentation drift. |
| packages/shared/src/telemetry/retention.test.ts | 4 | VALID_WITH_NOTES | V7 | None. Only two events covered. |
| packages/shared/src/types/agent.adapter-auth-session.test.ts | 8 | VALID_WITH_NOTES | V2 | None. The owner-prompt case asserts a literal; its value is compile-time. |
| packages/shared/src/validators/access.test.ts | 13 | VALID | none | None. |
| packages/shared/src/validators/adapter-registry.test.ts | 4 | VALID_WITH_NOTES | V1 | None. Sample data uses an upstream-style image and cluster URL; data only, not asserted as policy. |
| packages/shared/src/validators/approval.test.ts | 3 | VALID | none | None. |

Total: 378 test cases (JSON reporter count, all passing).

## 6 Per-test detail (tests that are not clean)

| File | Test | Code | Finding | Action |
|---|---|---|---|---|
| environment-support.test.ts | rejects providers for adapters without remote-managed environment support | V1 | Used adapter id `openclaw`, which is not a registered adapter type; it passed for any unknown string. | Changed to `openclaw_gateway`. |
| routine-variables.test.ts | getBuiltinRoutineVariableValues returns date in YYYY-MM-DD format | V3 | Compared against `new Date()`; flaky across UTC midnight. | Fake timers, fixed instant. |
| routine-variables.test.ts | getBuiltinRoutineVariableValues returns a human-readable timestamp... | V3 | Year taken from the live clock; flaky at year end. | Fake timers, fixed instant. |
| home-paths.test.ts | resolves config and runtime data directly under the instance root | V4 | Leaked a temp directory per run. | Removed in `afterEach`. |
| telemetry/client.test.ts, client-contract.test.ts | all fetch-stubbing cases | V4 | `vi.stubGlobal("fetch")` never unstubbed. | `vi.unstubAllGlobals()` in `afterEach`. |
| telemetry/client.test.ts | (new) resolveTelemetryConfig opt-out gating, 8 cases | V7 | Opt-out switches (`PAPERCLIP_TELEMETRY_DISABLED`, `DO_NOT_TRACK`, CI variables, file `enabled:false`, endpoint override, caps retained) were untested. | Added with `vi.stubEnv`, CI variables cleared first. |
| telemetry/client-types.test.ts | keeps dynamic telemetry separate from registered events | V2 | Runtime assertion is `toBeInstanceOf`; the real check is `@ts-expect-error`. | None; relies on tsc. |
| types/agent.adapter-auth-session.test.ts | returns the prompt only through the owner read type | V2 | Asserts a literal it constructed. | None; compile-time value only. |
| adapter-agnostic-keys.test.ts | is imported by the server and UI instead of being re-declared | V9 | Source-text grep. | None. |
| telemetry/readme-contract.test.ts | documents generated event helper exports that exist | V9 | README substring pin. | None. |
| pipeline-health.test.ts | all failed-automation cases | V9 | Fixture literal repeated across cases. | None (separate refactor). |
| telemetry/client.test.ts | retry and batchId cases | V9 | Overlaps with `client-contract.test.ts`. | None. |
| gitignore-runtime.test.ts | ignores files under .paperclip-runtime/ | V8 | Needs git and a checkout. | None. |
| telemetry/retention.test.ts | codex.credential_health, interaction.* | V7 | Two events only. | None. |

## 7 Evaluation and recommendations

Product findings:

1. Telemetry is enabled by default and sends to upstream-owned endpoints. `packages/shared/src/telemetry/client.ts` hard-codes `https://telemetry.paperclip.ing/ingest` and an AWS API Gateway URL as `DEFAULT_ENDPOINTS`, and `resolveTelemetryConfig` disables only on `PAPERCLIP_TELEMETRY_DISABLED=1`, `DO_NOT_TRACK=1`, CI variables or `enabled:false`. For a hard fork that is no longer upstream, a human should decide whether the default should be off or the endpoints replaced. No test was bent; the new tests pin the current opt-out behaviour.
2. `app-definitions.test.ts` pins an exact list of 11 app slugs. That is fork policy today; any catalog change will correctly break it.

Coverage gaps (not filled):

- `telemetry/retention` covers two event classes.
- `environment-support` has no table-driven check over every adapter in `REMOTE_MANAGED_ADAPTERS`.

Recommendations: convert the `client-types` and owner-prompt cases to `expectTypeOf` so the type guarantee shows in the vitest report; extract a fixture factory in `pipeline-health`; reformat `app-definitions.test.ts` in a separate style PR; consider merging the duplicated retry and batchId cases of `client.test.ts` and `client-contract.test.ts`.

## 8 Summary of activities

Files rewritten:

- `packages/shared/src/home-paths.test.ts`: temp directory cleanup (V4).
- `packages/shared/src/routine-variables.test.ts`: frozen clock for built-in variables (V3).
- `packages/shared/src/telemetry/client.test.ts`: unstub globals; add `resolveTelemetryConfig` opt-out tests (V4, V7).
- `packages/shared/src/telemetry/client-contract.test.ts`: unstub globals (V4).
- `packages/shared/src/environment-support.test.ts`: real adapter id in the negative case (V1).

Deletions: none.

Commands and outcomes (repo root, Windows):

- `npx vitest run --project @paperclipai/shared`: 602 passed, 7 failed (all in out-of-shard `worktree-seed-source` and `worktree-port-registry`, ENV), 1 unhandled EPERM (ENV).
- `npx vitest run` over the four telemetry/home-paths/routine files: 58 passed.
- `npx vitest run packages/shared/src/environment-support.test.ts`: 7 passed.
- `npx vitest run` over all 44 shard files with the JSON reporter: 378 passed, 0 failed.
- `npx tsc --noEmit` in `packages/shared`: clean (run before the environment-support one-line change, which only swaps a string literal).

## 9 Approvals

- Test author: ______________________  Date: __________
- Reviewer: ______________________  Date: __________
- Product owner: ______________________  Date: __________
