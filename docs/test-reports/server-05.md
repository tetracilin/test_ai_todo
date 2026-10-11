# Test Summary Report - shard server-05 (IEEE 829)

## 1 Report identifier and scope

- Report id: server-05 (vitest project `@paperclipai/server`, t3-nightly slow-tests audit)
- Files: 15 (all under `server/src/__tests__/`)
- Test cases: 172 (it.each expansions counted: companies-route-cross-company-authz 10+2, company-portability-registration 3+17 carried-table rows)
- Date: see git
- Standard: ISO/IEC/IEEE 29119 / ISTQB rubric V1-V9 (V1 validity, V2 assertions, V3 determinism, V4 isolation, V5 mock fidelity, V6 clarity, V7 coverage balance, V8 portability, V9 maintainability)

## 2 Summary

Every file was read in full and checked against the production source it exercises (codex-local adapter `execute.ts`, `routes/companies.ts`, `services/companies.ts`, company-artifacts, company-import-transfers, company-portability, shared `updateCompanyBrandingSchema`, `built-in-agents.ts`). No test asserts upstream-only behaviour: the subject of every file still exists in the fork and the asserted values match current code (skill keys `paperclipai/paperclip/paperclip` and `paperclipai/bundled/...` are still produced by `company-skills.ts` / `built-in-agents.ts`; branding schema fields; cloud_managed floor; evidence-gate flag; PC-001/PC-007/PC-011/PC-012 behaviour).

Verdicts: VALID 4, VALID_WITH_NOTES 7, REWRITTEN 4, OBSOLETE_REMOVED 0, NEEDS_DECISION 0.
Four files were edited (two POSIX guards, two determinism/assertion hardenings). No test was deleted, no assertion weakened, no production file touched.

## 3 Variances (what could not be verified)

- Embedded Postgres does not start within the hook timeout on this Windows host (20-30 s `beforeAll` timeouts, reproduced when a file runs alone). Six files are therefore NOT executed locally: companies-service, company-artifacts-service (11 of 12 tests), company-evidence-gate-flag, company-import-transfer-routes, company-portability-evidence-round-trip, company-portability-import-batching. Classification: ENV (embedded-PG startup / contention with concurrent shard agents), not REAL. Edits to these files were limited to small changes checked only by an esbuild parse (`tsc` excludes `__tests__`).
- codex-local-execute (16) and codex-local-skill-injection (4) fail on Windows for ENV reasons: the fake Codex CLI is a `#!/usr/bin/env node` script (`Failed to start command`; Windows cannot exec a shebang script) and `fs.symlink` returns EPERM without elevated rights. After the V8 guard they report skipped on win32; they must be confirmed on Linux CI/nightly.
- companies-route-cross-company-authz: first case timed out (20 s) in the combined baseline run because of cold module import under contention (ENV); the file passes 12/12 when run alone.
- The combined baseline run was killed by the command timeout, so company-portability-routes results come from a separate run.

## 4 Comprehensive assessment (defects by rubric code)

| Code | Count | Finding |
|---|---|---|
| V1 | 0 | No stale upstream behaviour found. |
| V2 | 2 | company-artifacts-service dedupe case only asserts absence of the attachment row, not presence of the work-product row ("deduped" cannot be told from "dropped both"); company-portability-routes "fails a board async import job" carried a comment promising a resubmit check that was never asserted (FIXED). |
| V3 | 3 | Iteration-bounded polling (20x10 ms in portability-routes; 30x10 ms twice in import-transfer-routes) turned slow hosts into spurious failures (FIXED: wall-clock bounded via `vi.waitFor`). The fixed 100 ms sleep in the concurrent-apply test is outcome-safe (either ordering yields [200,409]) - note only. |
| V4 | 2 | import-transfer-routes shares one DB and spool across all tests with no per-test cleanup (the `swept: 0` assertion depends on earlier tests leaving no terminal-run spool); "freezes part uploads" released its apply claim outside `finally` (FIXED). |
| V5 | 0 | Route suites mock `../services/index.js` by hand; the mocks match the symbols companies.ts imports today (all route tests pass). The import-transfers mock uses `importOriginal` passthrough (good). |
| V6 | 3 | codex-local-execute stage-wake case covers two scenarios in one test; company-artifacts "empty starred view for agent callers" passes a foreign-company runId for no stated reason; the evidence round-trip first test is one very long arrange/act/assert (acceptable, commented). |
| V7 | 3 | No empty-body test for the branding PATCH refine ("At least one branding field"); no chunk-boundary test for issue-insert batching beyond work products; evidence dedupe test does not prove the second import actually carried the link. |
| V8 | 2 | codex-local-execute (16) and codex-local-skill-injection (4) were POSIX-only without a guard (FIXED with `it.skipIf(win32)`, the repo convention used by cursor-local-*). |
| V9 | 4 | Three copies of a STORE-zip writer (import-transfer-routes, portability-routes, ui), duplicated company/mock scaffolding across five route suites, dead `PAPERCLIP_MANAGED_CONFIG` delete in company-cloud-floor, hand-repeated env save/restore in codex-local-execute. Recommend shared helpers in a separate PR (drive-by refactor out of scope). |

## 5 Summary of results

| File | Tests | Verdict | Defect codes | Action taken |
|---|---|---|---|---|
| server/src/__tests__/codex-local-execute.test.ts | 16 | REWRITTEN | V8, V9, V6 | Added `itPosix` (`it.skipIf(win32)`) for all 16; not runnable on Windows (ENV), needs Linux run |
| server/src/__tests__/codex-local-skill-injection.test.ts | 4 | REWRITTEN | V8 | Added `itPosix` guard (symlink EPERM on Windows) |
| server/src/__tests__/codex-local-skill-sync.test.ts | 3 | VALID | - | Ran: 3/3 pass |
| server/src/__tests__/companies-route-cross-company-authz.test.ts | 12 | VALID | - | None; ran alone 12/12 pass (combined-run timeout was ENV cold import) |
| server/src/__tests__/companies-route-path-guard.test.ts | 1 | VALID_WITH_NOTES | V7 | None; ran, passes (single path-guard case only) |
| server/src/__tests__/companies-service.test.ts | 12 | VALID_WITH_NOTES | V9 | None; embedded PG did not start (ENV), not executed. Repetitive agent fixtures |
| server/src/__tests__/company-artifacts-service.test.ts | 12 | VALID_WITH_NOTES | V2, V6 | None; 11 PG-bound tests not executed (ENV); the route-auth test is DB-free |
| server/src/__tests__/company-branding-route.test.ts | 9 | VALID_WITH_NOTES | V7 | None; ran, passes. Gap: empty branding body |
| server/src/__tests__/company-cloud-floor.test.ts | 3 | VALID_WITH_NOTES | V9 | None; ran, passes. Dead env delete |
| server/src/__tests__/company-evidence-gate-flag.test.ts | 9 | VALID_WITH_NOTES | - | None; PG not startable (ENV), not executed. Reviewed: arm/disarm end-to-end test is strong |
| server/src/__tests__/company-import-transfer-routes.test.ts | 24 | REWRITTEN | V3, V4, V9 | Two poll loops replaced by time-bounded `waitForTerminalJob`; claim release moved into `finally`; parse-checked only (PG ENV) |
| server/src/__tests__/company-portability-evidence-round-trip.test.ts | 2 | VALID_WITH_NOTES | V7 | None; PG not startable (ENV). Dedupe case may pass trivially if second import skips the link |
| server/src/__tests__/company-portability-import-batching.test.ts | 7 (6 + 1 opt-in benchmark) | VALID | - | None; PG not startable (ENV), not executed |
| server/src/__tests__/company-portability-registration.test.ts | 20 (3 + 17 table rows) | VALID | - | Ran: pass |
| server/src/__tests__/company-portability-routes.test.ts | 38 | REWRITTEN | V3, V2, V9 | Time-bounded polling helpers; added the resubmit assertion promised by a comment; ran 38/38 pass |

## 6 Per-test detail (tests that are not clean)

| File | Test | Code | Finding | Action |
|---|---|---|---|---|
| codex-local-execute | all 16 | V8 | Spawns a shebang script; cannot run on Windows | `itPosix` guard |
| codex-local-execute | renders execution-stage wake instructions for reviewer and executor roles | V6 | Two scenarios in one test | Noted, not split |
| codex-local-skill-injection | all 4 | V8 | `fs.symlink` EPERM on Windows | `itPosix` guard |
| company-artifacts-service | deduplicates work product attachments beyond the work product fetch window | V2 | Asserts only that `late-render.mp4` is absent; "Late Render" presence not asserted | Not edited (PG unverifiable); recommend raising the limit and asserting presence |
| company-artifacts-service | returns an empty starred view for agent callers | V6 | Actor carries a foreign-company run id without reason | Noted |
| company-portability-routes | fails a board async import job when the bundle import throws | V2 | Comment "A resubmit is allowed" had no assertion | Added resubmit 202 + new job id assertion (passes) |
| company-portability-routes | async job cases (7 using the helpers) | V3 | 20x10 ms iteration-bounded polling | Replaced with 5 s wall-clock-bounded `vi.waitFor` |
| company-import-transfer-routes | applies through the async import job machinery when requested; releases the claim when an async apply is refused by a running import | V3 | 30x10 ms iteration-bounded polling | Replaced with `waitForTerminalJob` |
| company-import-transfer-routes | freezes part uploads while an apply holds the claim | V4 | Claim released after assertions, outside finally | Wrapped in try/finally |
| company-import-transfer-routes | sweeps abandoned spools and cancels their open runs | V4 | `toEqual({swept: 0})` relies on no earlier test leaving a terminal-run spool in the shared spool root | Noted; add per-test spool/DB cleanup |
| company-portability-evidence-round-trip | dedupes an external object when the same bundle is imported... | V7/V2 | Count of 1 also results if the second import skipped the link entirely | Noted; also assert link count |
| company-branding-route | (gap) empty body | V7 | The refine requiring one branding field is untested | Noted |
| company-cloud-floor | all | V9 | `PAPERCLIP_MANAGED_CONFIG` deleted but never set | Noted |

## 7 Evaluation and recommendations

- Product findings: none. No suspected production bug; no test was bent to pass.
- Linux CI/nightly is the only place the following can execute: the 20 now-guarded codex tests and the six embedded-PG files. A local Windows result is not evidence for them.
- Coverage gaps for a follow-up PR: branding PATCH empty body (400); artifacts dedupe presence assertion; evidence dedupe link count; per-test cleanup in import-transfer-routes; batching chunk-boundary (501 issues).
- Maintainability: extract the triplicated STORE-zip builder and the duplicated company-route mock scaffolding into `server/src/__tests__/helpers/` in a separate refactor PR.
- Pipeline note: t3-ci does not run server suites; all of the above gets signal only in t3-nightly.

## 8 Summary of activities

Files rewritten:
- codex-local-execute.test.ts: POSIX guard (V8) for 16 tests.
- codex-local-skill-injection.test.ts: POSIX guard (V8) for 4 symlink tests.
- company-portability-routes.test.ts: wall-clock-bounded polling (V3); missing resubmit assertion added (V2).
- company-import-transfer-routes.test.ts: wall-clock-bounded polling helper (V3); claim release in finally (V4).

Deletions: none.

Commands and outcomes (Windows, repo root):
- `pnpm --filter @paperclipai/plugin-sdk ensure-build-deps` before vitest.
- Combined baseline of all 15 files: killed at timeout; codex execute/injection failed (ENV: shebang spawn, symlink EPERM); six embedded-PG files hit hook timeouts (ENV).
- `npx vitest run` on authz, path-guard, branding, cloud-floor, registration: 5 files, 45 tests passed.
- `npx vitest run company-portability-routes.test.ts` after edit: 38/38 passed.
- `npx vitest run codex-local-*` after edit: 3 passed (skill-sync), 20 skipped on win32 by design.
- esbuild parse check of the three edited files that were not run: ok. `tsc -p server` excludes `__tests__` (no signal).

## 9 Approvals

Prepared by: ____________________  Date: __________
Reviewed by: ____________________  Date: __________
Approved by: ____________________  Date: __________
