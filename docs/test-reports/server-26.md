# Test Summary Report: shard server-26 (IEEE 829 structure)

## 1. Report identifier and scope

- Report id: `server-26`
- Project: `@paperclipai/server` (vitest project `server`)
- Suite: t3-nightly "slow-tests" full vitest run, shard 26 of the server partition
- Files in shard: 20 (all under `server/src/__tests__/`)
- Test cases counted: 252 (each/table expansions counted individually; `task-watchdogs-classifier` has one `it.each` of 5 rows)
- Date: see git history for this file
- Assessed against: current `develop` of the hard fork (not upstream paperclipai/paperclip)

## 2. Summary

All 20 files were read in full and checked against the production modules they exercise (`server-info`, `instrumentation`, `static-index-html`, `services/secrets`, `services/skills-catalog`, `services/smoke-lab`, `services/source-trust`, `services/status-card*`, `services/summary-slots`, `services/task-watchdogs`, `storage/*`, `routes/sidebar-preferences`, `routes/summary-slots`, `index.ts` startup wiring, `@paperclipai/shared/telemetry`).

Verdict counts:

| Verdict | Files |
|---|---|
| VALID | 8 |
| VALID_WITH_NOTES | 7 |
| REWRITTEN | 5 |
| OBSOLETE_REMOVED | 0 |
| NEEDS_DECISION | 0 |

No test asserts upstream-only behaviour. Fork policy surfaces present in the shard (`hermes_gateway` adapter type and `hermes_api_key` user-secret fixtures in `secrets-service`) match the current fork. No test was deleted and no assertion was weakened.

## 3. Variances

- Embedded PostgreSQL does not start on this Windows host within the hook timeout. `beforeAll` timed out (20 s / 30 s, and still 30 s with `--hookTimeout=180000`) for `secrets-service`, `task-watchdogs-scheduler` (both attempted). Four more files use the same helper and were therefore not runnable: `smoke-lab`, `source-trust` (3 PG cases), `status-cards`, `summary-slots`. Classification: ENV (Windows embedded-PG startup/contention with concurrently running shard agents), not REAL.
- Consequence: the edits to `secrets-service`, `smoke-lab` and `task-watchdogs-scheduler` could not be executed. They are small and were checked statically against production code (see section 8). They must be confirmed by the next t3-nightly run.
- `sidebar-preferences-routes` "returns company rail order for board users" times out at the 20 s test timeout on a cold Windows module graph (first dynamic import of routes + middleware). It fails identically in two runs and the other 5 cases pass. Classification: ENV (cold transform cost), file left unedited.
- `server-startup-feedback-export` prints `MaxListenersExceededWarning` (SIGINT/SIGTERM listeners added by repeated `startServer()` calls). Not a failure; noted under V4.
- `status-cards.test.ts` and `summary-slots.test.ts` could not be run at all; verdicts are from static review only.

## 4. Comprehensive assessment (cross-cutting defects by rubric code)

| Code | Count | Summary |
|---|---|---|
| V1 Validity | 0 | No stale upstream behaviour found. |
| V2 Meaningful assertions | 5 | `smoke-lab` tautology `toolName.includes(".") \|\| toolName`; `secrets-service` two `toBeTruthy` + conditional `if (rejected?.status ...)` assertions, and one widened regex (`/active member\|secrets:read\|forbidden/i`); `task-watchdogs-incident-fixture` asserts fixture JSON against itself (2 cases); `service-version` readGitCommit case returns early with no assertion when git is absent; `server-package-build-script` asserts shell text, not behaviour. |
| V3 Determinism | 4 | `task-watchdogs-scheduler` seeded identifiers/issue numbers with `Math.random()` (unique-index collision risk); wall-clock `new Date()` in `status-cards` (todayTokens vs UTC midnight boundary); `sidebar-preferences` first test absorbs cold import against a fixed 20 s timeout; `status-cards`/`summary-slots` date-dependent title regex. |
| V4 Isolation | 3 | `server-startup-feedback-export` leaked `PAPERCLIP_DECISION_SIGNING_SECRET`, `PAPERCLIP_AGENT_JWT_SECRET`, `BETTER_AUTH_SECRET` and runtime API URL env across tests; startup test registers process signal listeners per call; `service-version` changes `process.cwd()` (restored in `finally`). |
| V5 Mock fidelity | 3 | `server-startup-feedback-export` hand-builds `../services/index.js` and `../startup-banner.js` stand-ins (db is correctly partial via `importOriginal`); `sidebar-preferences-routes` and `summary-slot-routes` hand-build `../services/index.js` (acceptable for thin route tests, rot risk noted); `task-watchdogs-incident-fixture` re-implements the fingerprint hash instead of calling the SUT. `secrets-service` uses `vi.spyOn` on real providers, which is the preferred pattern. |
| V6 Clarity | 4 | Omnibus cases: `status-cards` "creates, patches, archives, restores...", "joins issues mentioned..." and "writes a compiled query..."; `secrets-service` "resolves user secret refs through responsible-user values..." (about 170 lines). `secrets-service` "preserves the original resolution error when failure access logging fails" induces the logging failure implicitly via a random FK-violating run id. |
| V7 Coverage balance | n/a | Gaps listed in section 7. |
| V8 Portability | 2 | `skills-catalog-service` hard-coded POSIX path expectation failed on Windows (fixed); `server-startup-feedback-export` symlink test used a silent `return` on win32 (now a visible skip). `server-package-build-script` asserts POSIX `mkdir -p`/`cp -R` text. |
| V9 Maintainability | 3 | `secrets-service` repeats the same AWS `prepared` material literal about 12 times; `summary-slots` pins long prompt copy strings; `status-cards` repeats the query payload literal. |

## 5. Summary of results (one row per file)

| Path | Tests | Verdict | Defect codes | Action taken |
|---|---|---|---|---|
| server/src/__tests__/secrets-service.test.ts | 79 | REWRITTEN | V2, V6, V9 | Two race tests now assert the rejected settlement directly (no `toBeTruthy` + conditional); denial test tightened from broad regex to `status: 403`. Not runnable on host (ENV). |
| server/src/__tests__/server-info.test.ts | 8 | VALID | none | Run: pass. |
| server/src/__tests__/server-package-build-script.test.ts | 1 | VALID_WITH_NOTES | V2, V8 | None. Run: pass. |
| server/src/__tests__/server-startup-feedback-export.test.ts | 16 | REWRITTEN | V4, V5, V8 | File-level `afterEach` restores all env vars it or `startServer()` mutate; symlink case now `it.skipIf(win32)`. Run: 15 pass, 1 skipped (win32). |
| server/src/__tests__/service-version.test.ts | 6 | VALID_WITH_NOTES | V2, V4 | None. Run: pass. |
| server/src/__tests__/shared-telemetry-events.test.ts | 7 | VALID | none | Run: pass. |
| server/src/__tests__/sidebar-preferences-routes.test.ts | 6 | VALID_WITH_NOTES | V3, V5 | None. 5 pass, 1 ENV timeout (cold import). |
| server/src/__tests__/skills-catalog-service.test.ts | 5 | REWRITTEN | V8 | Expected asset path now `path.resolve(...)`. Run: pass (was failing on Windows). |
| server/src/__tests__/smoke-lab.test.ts | 7 | REWRITTEN | V2 | Replaced tautological profile-entry assertion. Not runnable on host (ENV). |
| server/src/__tests__/source-trust.test.ts | 7 | VALID | none | Not edited. 4 helper cases need no DB; 3 PG cases not runnable on host. |
| server/src/__tests__/static-index-html.test.ts | 1 | VALID | none | Run: pass. |
| server/src/__tests__/status-card-update-engine.test.ts | 7 | VALID | none | Run: pass. |
| server/src/__tests__/status-cards.test.ts | 24 | VALID_WITH_NOTES | V3, V6, V9 | None. Not runnable on host (ENV). |
| server/src/__tests__/storage-local-provider.test.ts | 4 | VALID | none | Run: pass. |
| server/src/__tests__/storage-s3-provider.test.ts | 3 | VALID_WITH_NOTES | V7 | None. Run: pass. |
| server/src/__tests__/summary-slot-routes.test.ts | 13 | VALID | V5 (minor) | Run: pass. |
| server/src/__tests__/summary-slots.test.ts | 18 | VALID_WITH_NOTES | V3, V9 | None. Not runnable on host (ENV). |
| server/src/__tests__/task-watchdogs-classifier.test.ts | 19 | VALID | none | Run: pass. |
| server/src/__tests__/task-watchdogs-incident-fixture.test.ts | 3 | VALID_WITH_NOTES | V2, V5 | None. Run: pass. |
| server/src/__tests__/task-watchdogs-scheduler.test.ts | 18 | REWRITTEN | V3 | Deterministic counter replaces `Math.random()` identifiers/issue numbers. Not runnable on host (ENV). |

## 6. Per-test detail (tests that are not clean)

| File | Test | Code | Finding | Action |
|---|---|---|---|---|
| secrets-service | returns conflict when concurrent user secret value creation races the unique index | V2 | `expect(rejected).toBeTruthy()` followed by an `if (rejected?.status === "rejected")` block: the reason assertion is conditional. | Rewritten to one `toMatchObject({status:"rejected", reason:{status:409,message}})`. |
| secrets-service | returns conflict when concurrent user secret definition creation races the unique index | V2 | Same pattern. | Same rewrite. |
| secrets-service | rejects ephemeral secret access for actors without secret-read authorization | V2 | Regex `/active member\|secrets:read\|forbidden/i` accepts any error mentioning one of three words. Production throws `forbidden(decision.explanation)` (403). | Tightened to `rejects.toMatchObject({ status: 403 })`. |
| secrets-service | resolves user secret refs through responsible-user values and records owner metadata | V6 | About 170 lines, 8 distinct behaviours (missing value, optional, inactive definition, deleted, restore, success, scope isolation, audit). | Recommend splitting; not done to avoid large diff. |
| secrets-service | preserves the original resolution error when failure access logging fails | V6 | Title says logging fails; the failure is induced implicitly via a random `heartbeatRunId` (FK violation). | Recommend an explicit `vi.spyOn` on the access-event writer. |
| secrets-service | AWS create/rotate/rollback cases (about 12) | V9 | Identical `prepared` provider payload literal repeated. | Recommend a `preparedAwsMaterial()` factory. |
| smoke-lab | installs smoke fixtures idempotently into tool access tables | V2 | `profileEntries.every(e => e.toolName.includes(".") \|\| e.toolName)` is true for any non-empty string and vacuously true for an empty array. | Now asserts `profileEntries.length > 0` and every `toolName` is a non-empty string. |
| server-startup-feedback-export | all cases | V4 | Secrets and `PAPERCLIP_*_API_*` env were set by `beforeEach`/`startServer()` and only partially restored. | File-level `afterEach` restores all. |
| server-startup-feedback-export | refuses a symlink planted as the generated decision signing key | V8 | `if (win32) return;` made the case pass with zero assertions. | `it.skipIf(process.platform === "win32")`. |
| skills-catalog-service | resolves the manifest and bundled skill files from the published package layout | V8 | Expected `readFile` arg was a literal POSIX path; the service resolves with `node:path`, producing `C:\published\...` on Windows. | Expected value wrapped in `path.resolve(...)`. |
| task-watchdogs-scheduler | all cases using `seedIssue` without explicit identifier | V3 | `Math.floor(Math.random()*10_000)` for `identifier` (unique index `issues_identifier_idx`) and `issueNumber`: about 1e-4 collision per pair. | Per-file incrementing counter. |
| task-watchdogs-incident-fixture | reproduces the material stop fingerprint | V5 | Recomputes `sha256(JSON.stringify(...))` inside the test; it never calls `task-watchdogs.ts`, so a change to `stableStopFingerprint` leaves it green. | Not changed (a faithful replay through `classifyTaskWatchdogSubtree` was attempted and could not reproduce the historical hash because the original issue tree is not recorded in the fixture). Recommendation in section 7. |
| task-watchdogs-incident-fixture | preserves why the watchdog could not resolve the board-only card | V2 | Asserts fixture JSON equals literals in the same fixture; no production code involved. | Retained as intentional immutable-evidence guard. |
| task-watchdogs-incident-fixture | records manual acceptance without changing audit attribution... | V2 | Same. | Retained. |
| service-version | readGitCommit resolves git from the module checkout | V2 | `if (baseline === null) return;` silently passes when git/checkout is absent (e.g. Docker image without `.git`). | Recommend `it.skipIf` based on a git probe. |
| server-package-build-script | copies static runtime asset directories into dist | V2, V8 | Asserts substrings of a shell command in `package.json`, not that assets reach `dist`. | Retained as a cheap contract guard. |
| sidebar-preferences-routes | returns company rail order for board users | V3 | First case pays the cold dynamic import of routes + middleware inside the default 20 s test timeout (ENV failure on this host). | Recommend warming imports in a `beforeAll`; not changed. |
| status-cards | creates, patches, archives, restores, lists updates, and deletes a card | V6 | Lifecycle omnibus in one case. | Retained. |
| status-cards | joins issues mentioned in the summary...; writes a compiled query and first summary... | V6, V3 | Very long multi-phase cases; `new Date()` windows around `todayTokens`/UTC midnight. | Retained; noted. |
| summary-slots | creates a summarizer task, links it... | V9 | About 25 `toContain` checks on prompt copy (including negative checks on retired phrasing). Brittle to copy edits. | Retained. |
| storage-s3-provider | resolves credentials by secret name from PAPERCLIP_SECRETS_DIR | V7 | Only asserts `provider.id === "s3"`; does not prove the credentials were read. | Retained (SDK client is lazy). |

## 7. Evaluation and recommendations

Overall quality is good: the shard is mostly behavioural, uses real providers with `vi.spyOn` (secrets), partial mocks via `importOriginal` for `@paperclipai/db` (startup), and covers negative paths (cross-company, authz denial, rollback failure, soft-delete reuse, fail-closed trust).

Recommendations:
1. Confirm the three PG-dependent edits (`secrets-service`, `smoke-lab`, `task-watchdogs-scheduler`) on the next t3-nightly run; they could not be executed on Windows.
2. `task-watchdogs-incident-fixture`: record the full issue tree in the fixture and replay it through `classifyTaskWatchdogSubtree` so the fingerprint case exercises the SUT (V5). Until then the regression is guarded only by the classifier unit tests.
3. `service-version`: use `it.skipIf(!gitAvailable)` instead of an early return.
4. `sidebar-preferences-routes`: warm the module graph once (`beforeAll(() => import(...))`) so the first case does not carry the cold-import cost.
5. Split the long `secrets-service` and `status-cards` omnibus cases; extract a `preparedAwsMaterial()` factory in `secrets-service`.
6. Coverage gaps (cheap): `server-info` has no case for a malformed `git log` line; `storage-local-provider` has no path-traversal key or missing-range-end case; `storage-s3-provider` has no case proving credentials reach the S3 client config; `static-index-html` does not assert branding substitution.
7. Product findings: none. No suspected production defect was found, so no file is NEEDS_DECISION.
8. Environment: embedded-PG startup on Windows dev boxes exceeds the 20/30 s hook timeouts; consider documenting that PG-backed server suites are Linux/CI-only.

## 8. Summary of activities

Files rewritten (all test-only):
- `secrets-service.test.ts`: tightened two race-settlement assertions (removed conditional `if`) and replaced a widened regex with `status: 403`.
- `server-startup-feedback-export.test.ts`: added env capture and file-level `afterEach` restore; converted the silent win32 `return` to `it.skipIf`.
- `skills-catalog-service.test.ts`: added `node:path` import; platform-resolved expected asset path.
- `smoke-lab.test.ts`: replaced tautological assertion with a non-empty-array and non-empty-string check.
- `task-watchdogs-scheduler.test.ts`: deterministic counter for generated issue identifier and number.

Deletions: none.

Commands run and outcomes (from repo root, one vitest process at a time):
- `pnpm --filter @paperclipai/plugin-sdk ensure-build-deps`: ok.
- `npx vitest run server/src/__tests__/server-startup-feedback-export.test.ts`: 15 passed, 1 skipped.
- `npx vitest run server/src/__tests__/secrets-service.test.ts` (also with `--hookTimeout=180000 --testTimeout=120000`): suite failed in `beforeAll` (embedded PG startup timeout), 79 skipped. ENV.
- `npx vitest run server/src/__tests__/task-watchdogs-scheduler.test.ts`: suite failed in `beforeAll` (embedded PG startup timeout), 18 skipped. ENV.
- 13 non-PG files in one run: 81 passed, 2 failed. Failures: `skills-catalog-service` path expectation (ENV/portability, fixed, re-run passes) and `sidebar-preferences-routes` first case 20 s timeout (ENV cold import, reproduced on re-run, left unedited).
- A temporary probe test replaying the incident fixture through the real classifier was created and deleted (hash mismatch; not retained).
- Not run: `smoke-lab`, `source-trust` (PG cases), `status-cards`, `summary-slots` (embedded PG not startable on host).

## 9. Approvals

- Prepared by: ______________________  Date: __________
- Reviewed by (QA): __________________  Date: __________
- Approved by (owner): _______________  Date: __________
