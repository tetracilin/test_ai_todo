# Test Summary Report: shard server-22 (IEEE 829)

## 1 Report identifier and scope

| Item | Value |
|---|---|
| Report id | server-22 |
| Project | `@paperclipai/server` (vitest project `server`) |
| Suite | t3-nightly "slow-tests" full vitest run, shard 22 |
| Files in shard | 31 (all under `server/src/__tests__/`) |
| Test cases | 219 (static count of `it`/`test` declarations; `it.each` is not used in this shard) |
| Date | see git |
| Baseline | current `develop` (hard fork, no longer upstream) |
| Rubric | V1 validity, V2 meaningful assertions, V3 determinism, V4 isolation, V5 mock fidelity, V6 clarity, V7 coverage balance, V8 portability, V9 maintainability |

## 2 Summary

Every file was read in full and checked against the production source it exercises. Seven files were rewritten (small, targeted edits), two need a product decision, and the remaining 22 are valid (11 clean, 11 with notes).

| Verdict | Files |
|---|---|
| VALID | 11 |
| VALID_WITH_NOTES | 11 |
| REWRITTEN | 7 |
| OBSOLETE_REMOVED | 0 |
| NEEDS_DECISION | 2 |

Headline findings:

1. `openapi-routes.test.ts` "covers the mounted server routes exactly" fails for a REAL reason on this checkout. Four fork-owned route files (`artifacts.ts`, `discord-integrations.ts`, `scheduling.ts`, `wopi.ts`) have no entry in the test's `apiPrefixes` map, and four routes are missing from the generated OpenAPI spec. The gate is correct; the product must decide between documenting the routes and adding explicit exclusions.
2. `pipelines.ts` `buildCaseDeepLink` hard-codes the upstream company prefix `/PAP/`. `pipelines-service.test.ts` pins that value. Fork companies have arbitrary prefixes, so the drift-notice link is wrong for every company that is not `PAP`.
3. One assertion was a widened matcher (`[200, 201]` where the route only returns 201). It is now exact.
4. Several tests silently depended on POSIX or on the process cwd. They are now explicitly guarded or cwd-independent.

## 3 Variances

| Variance | Cause | Class |
|---|---|---|
| Embedded-Postgres suites could not be executed: `merged-pr-confirmation-sweep` (1 PG test), `multilingual-issues-routes` (8), `pipeline-case-outputs` (1) all timed out in `beforeAll` at 20 s. Not run, but read in full: `onboarding-seed-route` (14), `permissions-upgrade-boundary-routes` (3), `low-trust-red-team-routes` (11), `pipelines-routes` (19), `pipelines-service` (32) | Embedded PG start-up is slower than the 20 s hook timeout on this Windows host while other audit agents run concurrently | ENV |
| `kimi-local-skill-sync`, `opencode-local-skill-sync`, `pi-local-skill-sync` (3 tests), `paperclip-skill-utils` "removes stale maintainer-only symlinks" fail with `EPERM: operation not permitted, symlink` | Windows without symlink privilege (Developer Mode or admin). Production code also uses `fs.symlink`. Unchanged, no edit | ENV |
| `pi-local-skill-sync` was not run separately | Same symlink mechanism as kimi/opencode; classified by inspection | ENV (inferred) |
| `low-trust`, `onboarding-seed`, `permissions-upgrade`, `pipelines-*` correctness is assessed by reading only | See first row | ENV |
| `local-service-supervisor` first test and the five pi/opencode fake-CLI tests are now skipped on win32 and therefore not exercised here | They need `#!/bin/sh` / `#!/usr/bin/env node` shebang execution or POSIX process groups. They run on the Linux CI/nightly host | ENV |
| t3-ci does not run server tests; this shard only runs in t3-nightly | Pipeline design (see CLAUDE.md) | Info |

## 4 Comprehensive assessment (cross-cutting defects)

| Code | Count | Defect |
|---|---|---|
| V1 | 3 | `pipelines-service` pins hard-coded upstream `/PAP/` link prefix; `openapi-routes` route registry (`apiPrefixes`) is stale versus fork route files; `logger-tz` and `parse-status-filter` headers cite upstream issue numbers (informational only) |
| V2 | 3 | `openclaw-invite-prompt-route` widened matcher `[200,201]` (x2, fixed); `logger-tz` third test asserts `Intl.DateTimeFormat`, not the production logger |
| V3 | 3 | `paperclip-skill-utils` depended on `process.cwd()` (fixed); `low-trust` wake test polls up to 30 s (bounded, acceptable); `live-events-ws` uses `setImmediate` flush counts (deterministic but implementation-coupled) |
| V4 | 1 | `paperclip-skill-utils` passed only from repo root (same fix as V3). Env save/restore in `paperclip-env`, `pi-local-execute`, `opencode env`, `local-service-supervisor` is correct |
| V5 | 4 | `monthly-spend-service` hand-built chainable DB stub with `adapterType: "claude-local"` (not a valid adapter id); `openclaw-invite-prompt-route` hand-built select-chain DB stub and full `services/index.js` replacement; `llms-routes` replaces `agents` and `adapters/index` without `importOriginal`; `live-events-ws` replaces the logger module. All pass today but rot when exports change |
| V6 | 3 | `pipelines-routes` "exposes the pipeline and case route surface" is a 130-line multi-reason kitchen-sink test; `pipelines-service` several long multi-scenario tests; `low-trust` large attempt tables (acceptable, labelled by id) |
| V7 | 3 | `join-request-dedupe` has no no-match / empty-input case; `mcp-http` has no malformed-JSON case; `paperclip-env` has no `HOST`/`PORT` fallback case even though the harness saves and restores them |
| V8 | 8 | POSIX-only fake CLIs and process-group tests (fixed with `skipIf(win32)`); symlink tests (ENV note); `permissions-upgrade` hard-codes `/tmp/paperclip-test-home` |
| V9 | 4 | `openclaw-gateway-adapter` dead empty `afterEach` (removed) and two near-duplicate mock gateway servers (kept); `llms-routes` duplicates mock registration via `vi.mock` plus `vi.doMock`; `skill-utils` asserts on documentation prose (brittle, but purposeful) |

Security-relevant tests (`low-trust`, `permissions-upgrade`, `live-events-ws`, `pipelines-routes` cross-company 404 table) are strong: they assert denial, absence of canary strings and absence of durable side effects, and use positive controls.

## 5 Summary of results

| File | Tests | Verdict | Defect codes | Action taken |
|---|---|---|---|---|
| server/src/__tests__/join-request-dedupe.test.ts | 3 | VALID | V7 | none (passes) |
| server/src/__tests__/json-schema-secret-refs.test.ts | 5 | VALID | none | none (passes) |
| server/src/__tests__/kimi-local-skill-sync.test.ts | 1 | VALID_WITH_NOTES | V8 | none; fails on Windows with symlink EPERM (ENV) |
| server/src/__tests__/live-events-ws.test.ts | 6 | VALID_WITH_NOTES | V5, V3 | none (passes) |
| server/src/__tests__/llms-routes.test.ts | 2 | VALID_WITH_NOTES | V5, V9 | none (passes). Hermes Gateway static docs assertions match fork policy |
| server/src/__tests__/local-service-supervisor.test.ts | 6 | REWRITTEN | V8 | first test guarded `skipIf(win32)`; second test's silent `return` converted to `skipIf(win32)` |
| server/src/__tests__/log-redaction.test.ts | 4 | VALID | none | none (passes) |
| server/src/__tests__/logger-tz.test.ts | 3 | VALID_WITH_NOTES | V2, V1 | none (passes); see section 6 |
| server/src/__tests__/low-trust-red-team-routes.test.ts | 11 | VALID_WITH_NOTES | V3, V6 | none; not run (PG, ENV) |
| server/src/__tests__/managed-config.test.ts | 31 | VALID | none | none (passes) |
| server/src/__tests__/mcp-http.test.ts | 7 | VALID | V7 | none (passes). Count includes 2+5 declared cases |
| server/src/__tests__/merged-pr-confirmation-sweep.test.ts | 7 | VALID_WITH_NOTES | V8 | none; 6 pure tests pass, 1 PG test skipped on timeout (ENV) |
| server/src/__tests__/monthly-spend-service.test.ts | 2 | VALID_WITH_NOTES | V5 | none (passes) |
| server/src/__tests__/multilingual-issues-routes.test.ts | 8 | VALID | none | none; not run (PG, ENV) |
| server/src/__tests__/onboarding-seed-route.test.ts | 14 | VALID | none | none; not run (PG, ENV) |
| server/src/__tests__/openapi-routes.test.ts | 5 | NEEDS_DECISION | V1 | none. 4 pass, 1 REAL failure (see section 6) |
| server/src/__tests__/openclaw-gateway-adapter.test.ts | 7 | REWRITTEN | V9 | removed dead empty `afterEach` and unused import; passes |
| server/src/__tests__/openclaw-invite-prompt-route.test.ts | 6 | REWRITTEN | V2, V5 | two `expect([200,201]).toContain` replaced by exact `toBe(201)` (route returns `res.status(201)`); passes |
| server/src/__tests__/opencode-local-adapter-environment.test.ts | 3 | REWRITTEN | V8 | probe test with `#!/bin/sh` fake guarded `skipIf(win32)`; other 2 pass |
| server/src/__tests__/opencode-local-adapter.test.ts | 5 | VALID | none | none (passes) |
| server/src/__tests__/opencode-local-skill-sync.test.ts | 1 | VALID_WITH_NOTES | V8 | none; symlink EPERM on Windows (ENV) |
| server/src/__tests__/paperclip-env.test.ts | 5 | VALID | V7 | none (passes) |
| server/src/__tests__/paperclip-skill-utils.test.ts | 6 | REWRITTEN | V3, V4, V8 | repo files resolved from `import.meta.url` instead of `process.cwd()`; symlink test still ENV on Windows |
| server/src/__tests__/parse-status-filter.test.ts | 10 | VALID | none | none (passes) |
| server/src/__tests__/permissions-upgrade-boundary-routes.test.ts | 3 | VALID_WITH_NOTES | V8 | none; not run (PG, ENV) |
| server/src/__tests__/pi-local-adapter-environment.test.ts | 2 | REWRITTEN | V8 | whole describe guarded `skipIf(win32)` (shebang fake CLI) |
| server/src/__tests__/pi-local-execute.test.ts | 3 | REWRITTEN | V8 | whole describe guarded `skipIf(win32)` (shebang fake CLI) |
| server/src/__tests__/pi-local-skill-sync.test.ts | 1 | VALID_WITH_NOTES | V8 | none; symlink EPERM on Windows (ENV, inferred) |
| server/src/__tests__/pipeline-case-outputs.test.ts | 1 | VALID | none | none; not run (PG, ENV) |
| server/src/__tests__/pipelines-routes.test.ts | 19 | VALID_WITH_NOTES | V6 | none; not run (PG, ENV) |
| server/src/__tests__/pipelines-service.test.ts | 32 | NEEDS_DECISION | V1 | none; not run (PG, ENV); one test pins suspect `/PAP/` prefix |

Note on `mcp-http`: the file declares 7 `it` blocks counting the `describe` bodies as read (2 header tests, 5 parser tests).

## 6 Per-test detail (tests that are not clean)

| File | Test | Code | Finding | Action |
|---|---|---|---|---|
| openapi-routes | covers the mounted server routes exactly | V1 (REAL) | `unknownRouteFiles` = artifacts.ts, discord-integrations.ts, scheduling.ts, wopi.ts. `missingInSpec` = `GET /api/issues/{id}/subtasks`, `GET /api/issues/{id}/subtasks/progress`, `POST /api/companies/{companyId}/issues/{issueId}/evidence-links/upload`, `POST /api/issues/{id}/dossier/scope-changes`. The routes are mounted in `app.ts`; the OpenAPI document and the test registry were not updated when the fork added them | Not bent. NEEDS_DECISION: document the routes in `routes/openapi.ts` and add prefixes, or add them to `explicitOpenApiCoverageExclusions` as for pipelines/cases |
| pipelines-service | posts upstream drift notices to active dependent work issues only | V1 | Expects body link `/PAP/pipelines/...`. Source `buildCaseDeepLink` returns the literal `/PAP/` (upstream company prefix), but test companies have prefix `P<random>`. Link is dead for any non-PAP company | Not changed. NEEDS_DECISION: fix source to use the company issue prefix, then update the expectation |
| openclaw-invite-prompt-route | allows CEO agent callers and creates an agent-only invite; allows board callers with invite permission | V2 | Accepted 200 or 201; route returns only 201 | Fixed: exact 201 with body in the failure message |
| paperclip-skill-utils | five docs/skill tests | V3, V4 | Read `skills/...`, `docs/api/issues.md` relative to `process.cwd()`; fails under `pnpm --filter @paperclipai/server exec vitest` | Fixed with `REPO_ROOT` from `import.meta.url` |
| paperclip-skill-utils | removes stale maintainer-only symlinks | V8 | `fs.symlink` EPERM without Windows symlink privilege | ENV; not changed |
| local-service-supervisor | keeps request-logging runtime stdio usable... | V8 | Timed out at 15 s on Windows (POSIX shell command, process groups) | Guarded `skipIf(win32)` |
| local-service-supervisor | does not wait for an unrelated process... | V8 | `if (win32) return` reported a pass without running | Converted to `skipIf(win32)` so it reports as skipped |
| opencode-local-adapter-environment | classifies ProviderModelNotFoundError probe output... | V8 | `#!/bin/sh` fake CLI cannot be exec'd on Windows | Guarded `skipIf(win32)` |
| pi-local-adapter-environment | both tests | V8 | Node shebang fake `pi` cannot be exec'd on Windows | Guarded `describe.skipIf(win32)` |
| pi-local-execute | all three tests | V8 | Same; `Failed to start command` | Guarded `describe.skipIf(win32)` |
| openclaw-gateway-adapter | (file level) | V9 | Empty `afterEach` ("no global mocks") | Removed |
| logger-tz | SYS: prefix produces timezone-sensitive output | V2 | Asserts `Intl.DateTimeFormat` behaviour, not the logger or pino-pretty; cannot fail due to a repo change | Kept (not obsolete); recommend replacing with a real pino-pretty formatter check |
| logger-tz | (file header) | V1 | Cites upstream issue 2879 | Informational |
| monthly-spend-service | both tests | V5 | Hand-built select-chain stub; `adapterType: "claude-local"` is not a real adapter id | Not changed; passes |
| llms-routes | both tests | V5, V9 | Services replaced via both `vi.mock` and `vi.doMock`, no `importOriginal` | Not changed; passes |
| live-events-ws | authorizes a cloud-proxied browser... | V2 | Passes by absence of a rejection (`endedChunks` empty) with the socket forced non-writable; weak positive evidence | Not changed |
| pipelines-routes | exposes the pipeline and case route surface | V6 | One 130-line test with many independent reasons to fail | Not changed |
| pipelines-routes | bulk reviews partial successes... | V3 | Creates 50 cases through HTTP in a loop (slow, not flaky) | Not changed |
| low-trust-red-team-routes | redacts quarantined low-trust output... | V3 | `waitFor` polls up to 30 s on gateway payload and run status; bounded, no fixed sleeps | Not changed |
| permissions-upgrade-boundary-routes | (file level) | V8 | Hard-coded `PAPERCLIP_HOME=/tmp/paperclip-test-home` | Not changed |
| join-request-dedupe | (file) | V7 | No case for no match or empty rows | Gap recorded |
| mcp-http | (file) | V7 | No malformed JSON body case | Gap recorded |
| paperclip-env | (file) | V7 | `HOST`/`PORT` are saved but never asserted | Gap recorded |
| kimi / opencode / pi skill-sync | one test each | V8 | Symlink EPERM on Windows | ENV; not changed |

## 7 Evaluation and recommendations

Product findings:

1. OpenAPI coverage gate is red on `develop` for fork-owned routes (Discord integrations, scheduling, artifacts, WOPI, subtasks, evidence-link upload, dossier scope-changes). Owner decision needed. Until then this is a red signal in t3-nightly.
2. Hard-coded `/PAP/` company prefix in `buildCaseDeepLink` (`server/src/services/pipelines.ts`) is an upstream leftover that produces broken deep links for fork tenants. Fix the source, then update the pinned assertion in `pipelines-service.test.ts`.

Test-quality recommendations (not done, to keep diffs minimal):

1. Add a Windows-aware symlink helper or a shared `skipIf(!canSymlink)` for the four symlink tests so contributor Windows runs report a skip, not a failure.
2. Replace the `logger-tz` Intl test with an assertion against the real pino-pretty formatter under two `TZ` values.
3. Split the kitchen-sink `pipelines-routes` test by route group.
4. Convert hand-built mocks (`llms-routes`, `monthly-spend-service`, `openclaw-invite-prompt-route`, `live-events-ws`) to `importOriginal`-based partial mocks.
5. Raise the embedded-PG `beforeAll` timeout via the shared helper, or document the expected host speed; 20 s is too tight for loaded Windows hosts.
6. Cheap coverage additions: no-match case for join-request dedupe, malformed body for mcp-http, `HOST`/`PORT` precedence for paperclip-env.

Fork-policy check: the Hermes Gateway docs assertions in `llms-routes` and the adapter ids used across the shard (`codex_local`, `process`, `openclaw_gateway`, `opencode_local`, `pi_local`, `kimi_local`) match the current registry. The shard contains no tests for removed upstream subjects.

## 8 Summary of activities

Files rewritten (all test-only):

| File | Reason |
|---|---|
| local-service-supervisor.test.ts | Explicit win32 skips; the silent early `return` no longer reports a false pass |
| openclaw-gateway-adapter.test.ts | Removed dead `afterEach` and its import |
| openclaw-invite-prompt-route.test.ts | Exact 201 assertion instead of `[200, 201]` |
| opencode-local-adapter-environment.test.ts | win32 guard for `#!/bin/sh` fake CLI test |
| paperclip-skill-utils.test.ts | cwd-independent repo paths via `import.meta.url` |
| pi-local-adapter-environment.test.ts | win32 guard for shebang fake CLI |
| pi-local-execute.test.ts | win32 guard for shebang fake CLI |

Deletions: none. No assertion was weakened; no test case count changed (skips are platform-conditional only).

Commands run (repo root, one vitest process at a time):

| Command | Outcome |
|---|---|
| `npx vitest run` on 12 pure files (join-request, json-schema, kimi, live-events, llms, log-redaction, logger-tz, managed-config, mcp-http, monthly-spend, parse-status-filter, paperclip-env) | 78 passed, 1 failed (kimi symlink, ENV) |
| `npx vitest run` on opencode x3, pi x3, skill-utils, openapi, openclaw-gateway, openclaw-invite, local-service-supervisor (before edits) | 11 failures: openapi (REAL), 1 supervisor timeout (ENV), 1 opencode probe (ENV), 3 symlink (ENV), 5 pi shebang (ENV) |
| `npx vitest run` openclaw-gateway + openclaw-invite (before edits) | 13 passed |
| `npx vitest run` merged-pr, multilingual, pipeline-case-outputs | 6 passed, 10 skipped, 3 suites failed on 20 s PG `beforeAll` timeout (ENV) |
| `npx vitest run` on the 7 edited files (after edits) | 24 passed, 8 skipped (win32 guards), 1 failed (symlink EPERM, ENV, unchanged) |

## 9 Approvals

| Role | Name | Signature | Date |
|---|---|---|---|
| Test lead | ____________ | ____________ | ____________ |
| Product owner (decisions in section 7) | ____________ | ____________ | ____________ |
| Reviewer | ____________ | ____________ | ____________ |
