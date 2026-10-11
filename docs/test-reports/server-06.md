# Test Summary Report: shard server-06 (IEEE 829 structure)

## 1 Report identifier and scope

- Report id: server-06
- Project: server (`@paperclipai/server`), vitest project `server`
- Files: 12 (company portability, company search, company skill policy / test runs / catalog / detail / import authz)
- Test cases: 154 (counted from `it(...)`; no `it.each` tables in this shard)
- Date: see git

## 2 Summary

Every file was read in full and checked against the production modules it exercises (`services/company-portability.ts`, `company-search*.ts`, `company-skills.ts`, `company-skill-policy.ts`, `routes/company-skill-policy.ts`, `routes/issues.ts` search routes). No test asserts upstream-only behaviour: the subjects all still exist, assertion values match current source (for example bundle `schemaVersion` 8 matches `BUNDLE_SCHEMA_VERSION = 8`).

Verdicts: REWRITTEN 1, VALID_WITH_NOTES 11, VALID 0, OBSOLETE_REMOVED 0, NEEDS_DECISION 0.
(The portability suite was rewritten in four places. `company-search-service` has one confirmed weak assertion that could not be fixed and verified here; see section 3.)

## 3 Variances

- Embedded Postgres does not start on this Windows host inside the files' 20 s `beforeAll` hook (observed on `company-search-service.test.ts`, also with `--hookTimeout=120000`, because the hook timeout is hard-coded to `20_000` in the file). Classified ENV. As a result the 10 DB-backed files (all except portability, extract-routes, rate-limit-routes) could not be executed locally. 
- I drafted a fix for one defect in `company-search-service.test.ts` (V2, see section 6), could not verify it, and reverted it. The file is unchanged. It needs a run on Linux or in t3-nightly before landing.
- `company-skill-import-boundary` uses `fs.symlink`, which needs Developer Mode/admin on Windows (V8); not verifiable here.
- Unedited files that need Postgres were not run (per task rules).

## 4 Comprehensive assessment (defects by rubric code)

| Code | Count | Notes |
|---|---|---|
| V1 Validity | 0 | No stale upstream behaviour found. Fixtures reference `paperclipai/*` skill keys and `@paperclipai/skills-catalog`; these are still the fork's package/catalog names. `/Users/dotta/...` is an inert fixture string for path sanitization. |
| V2 Meaningful assertions | 4 | portability: tautology `toBeGreaterThanOrEqual(0)` (fixed); `not.toContain("authorUserId: local-board")` could never fail because the YAML renderer quotes strings (fixed); search-service: `not.toEqual(arrayContaining(all decoys))` passes unless every decoy is returned (reported, not fixed, unverifiable here); portability "known limitation" test pins questionable behaviour (reported). |
| V3 Determinism | 2 | `Promise.race` 1 s wall-clock guards in `company-skills-detail` (hang guards, low risk but can flake under embedded-PG load); 500 ms `vi.waitFor` in the portability concurrency test (bounded, acceptable). |
| V4 Isolation | 1 | portability git test leaked a temp repo dir (fixed with try/finally). Env vars in authz/catalog files are saved and restored correctly. |
| V5 Mock fidelity | 2 | portability hand-builds ~12 service mocks (`vi.fn` bags) rather than partial mocks; they can silently rot as service interfaces grow. SUT itself is real, so acceptable but noted. `company-skills-catalog-service` hand-mocks `skills-catalog.js` with `vi.doMock`, justified (the real catalog manifest is a build artefact). `company-skills-detail` correctly uses `importActual` for adapters. |
| V6 Clarity | 3 | "exports hire approval policy only when approval is required" only tests the positive case; "cleans up the harness issue if persisting fails" relies on `retentionDays: NaN` to force failure (implicit coupling); `does not implicitly add local adapter permission bypass defaults` also asserts `extraArgs` default, broader than the name. |
| V7 Coverage | see section 7 | |
| V8 Portability | 2 | symlink creation (import-boundary); real `git` binary and `git checkout -b` in portability. Both are fine on Linux CI. |
| V9 Maintainability | 3 | Heavy copy-pasted inline bundle fixtures and agent-create mocks in portability (about 30 repeats of the same 10 lines); duplicated express actor setup x3 in `company-search-rate-limit-routes`; `new Date()` fixtures harmless. Not refactored (rules: no mass reformat). |

## 5 Summary of results

| File | Tests | Verdict | Defect codes | Action taken |
|---|---|---|---|---|
| server/src/__tests__/company-portability.test.ts | 83 | REWRITTEN | V2 x3, V4, V5, V6, V9 | 4 targeted fixes; 83/83 pass locally |
| server/src/__tests__/company-search-extract-routes.test.ts | 3 | VALID | none | none; 3/3 pass locally |
| server/src/__tests__/company-search-extract-service.test.ts | 7 | VALID_WITH_NOTES | V7 | none; DB tests not runnable (ENV) |
| server/src/__tests__/company-search-rate-limit-routes.test.ts | 3 | VALID_WITH_NOTES | V9 | none; 3/3 pass locally |
| server/src/__tests__/company-search-service.test.ts | 19 | VALID_WITH_NOTES | V2 (one weak negative) | fix drafted, unverifiable (ENV), reverted |
| server/src/__tests__/company-skill-import-boundary.test.ts | 1 | VALID_WITH_NOTES | V6, V8 | none |
| server/src/__tests__/company-skill-policy-routes.test.ts | 3 | VALID_WITH_NOTES | V7 | none |
| server/src/__tests__/company-skill-policy-service.test.ts | 7 | VALID_WITH_NOTES | V7 | none |
| server/src/__tests__/company-skill-test-runs-service.test.ts | 12 | VALID_WITH_NOTES | V6 | none |
| server/src/__tests__/company-skills-catalog-service.test.ts | 13 | VALID_WITH_NOTES | V5 (justified) | none |
| server/src/__tests__/company-skills-detail.test.ts | 2 | VALID_WITH_NOTES | V3 | none |
| server/src/__tests__/company-skills-import-authz-routes.test.ts | 1 | VALID_WITH_NOTES | V7 | none |

## 6 Per-test detail (tests that are not clean)

| File | Test | Code | Finding | Action |
|---|---|---|---|---|
| company-portability | handles a package with only skills (no agents or projects) | V2 | `skills.length >= 0` is always true. | Fixed: asserts the exact two skill keys exported by the fixtures. |
| company-portability | does not export raw comment author user ids | V2 | `not.toContain("authorUserId: local-board")` cannot fail: the renderer emits `authorUserId: "local-board"` (quoted). The privacy guarantee was untested. | Fixed: asserts neither `authorUserId` nor `local-board` appears. |
| company-portability | infers portable git metadata from a local checkout... | V4, V8 | Created a temp git repo and never removed it. | Fixed: try/finally `fs.rm`. |
| company-portability | rejects packages produced by a newer Paperclip | V9 | Hard-coded `schemaVersion: 9` would silently stop being "newer" after the next bundle schema bump. | Fixed: derives `current + 1` from a fresh export's manifest. |
| company-portability | nameOverrides applied after collision detection do not re-validate uniqueness | V2/V6 | Test asserts a self-described "known limitation": a rename override equal to an existing agent name plans `create` with a duplicate name. It pins behaviour that is probably unintended. | Left as is; reported as a product finding. |
| company-portability | exports hire approval policy only when approval is required | V6 | Name claims "only when"; only the positive case is here (negative is covered indirectly in the first export test). | Noted. |
| company-portability | does not implicitly add local adapter permission bypass defaults | V6 | First half checks `dangerouslySkipPermissions` undefined for a claude agent; second half pins the codex `extraArgs` default. Two reasons to fail. | Noted. |
| company-portability | prefetches task export records with bounded concurrency | V3 | 500 ms `vi.waitFor`; hard-coded concurrency of 2 matches current service. Deterministic enough, no sleep. | Noted. |
| company-search-service | matches percent characters literally across ... results | V2 | `expect(ids).not.toEqual(expect.arrayContaining([...5 decoys]))` only fails if all five decoys are returned; a single decoy leak passes. Correct form is a per-id `not.toContain`. | Fix drafted, could not verify (embedded PG ENV), reverted. Needs Linux/nightly run. |
| company-skill-import-boundary | allows configured workspace imports and rejects ... | V6, V8 | One test covers five scenarios (allowed, out-of-tree, symlink escape, ftp, http); first failure hides the rest. Symlink needs privileges on Windows. | Noted. |
| company-skill-test-runs-service | cleans up the harness issue if persisting the test run fails | V6 | Failure is induced via `retentionDays: Number.NaN`; correct but implicit. | Noted. |
| company-skills-detail | both tests | V3 | `Promise.race` against a 1 s `setTimeout` is a wall-clock guard that may flake on a loaded embedded-PG host. Intent (detect hang on adapter probe) is sound. | Noted. |
| company-skills-catalog-service | all | V5 | `vi.doMock` of the catalog service with canned data; acceptable and reset in `beforeEach`. | Noted. |

## 7 Evaluation and recommendations

Product findings
- `nameOverrides` bypassing collision uniqueness (portability) is documented in the test as a known limitation; a product owner should decide whether to enforce uniqueness after overrides. If so, this test must be inverted.

Coverage gaps (reported, not added: cheap but unverifiable here for DB-backed subjects)
- company-search-extract-service: no test for `scope` values `title`/`description` alone, `offset` paging, or the `updatedAfter` filter.
- company-skill-policy-service / routes: no test for `defaultEffect: "deny"` with no matching rule for a non-legacy principal, rule priority ties, or a `PUT` with an unsupported `schemaVersion`.
- company-skills-import-authz-routes: only the allow path; no 403 for an agent lacking `skills:create`, and no test for an agent JWT with no responsible user.
- company-skill-import-boundary: no relative-path (`..`) or nonexistent-path case.
- company-portability: no test for `skills` import when `importPackageFiles` throws (secret-cleanup path covered only for agent create failure).

Recommendations
1. Apply the per-id `not.toContain` change in `company-search-service` on a Linux runner, where embedded Postgres works, and confirm the decoy exclusion truly holds (it is the point of the test).
2. Consider exporting `BUNDLE_SCHEMA_VERSION` (or reading it from the manifest in tests) so the two literal `schemaVersion: 8` assertions in portability stop being bump-time traps.
3. Extract a `buildInlineAgentBundle()` helper in portability to cut the repeated 10-line inline bundle literals (V9).
4. Note for CI: the server suites run only in t3-nightly; this shard's DB-backed files (10 of 12) have no PR-time signal.

## 8 Summary of activities

Files rewritten
- `server/src/__tests__/company-portability.test.ts`: replaced tautology, strengthened an unfailable privacy assertion, removed a temp-dir leak, derived the "newer schema" version instead of hard-coding it.

Deletions: none.

Commands run and outcomes
- `npx vitest run server/src/__tests__/company-portability.test.ts` (before edit): 83 passed. After edit: 83 passed.
- `npx vitest run server/src/__tests__/company-search-service.test.ts` (with draft fix): ENV failure, `beforeAll` hook timed out at 20000 ms starting embedded Postgres (2 non-DB tests passed, 17 skipped). Retried with larger `--hookTimeout`; same, because the timeout is hard-coded in the file. Edit reverted; `git diff` of the file is empty.
- `npx vitest run server/src/__tests__/company-search-extract-routes.test.ts server/src/__tests__/company-search-rate-limit-routes.test.ts`: 6 passed.
- Other files: not run (unedited, embedded Postgres unavailable).

## 9 Approvals

Prepared by: ____________________  Date: __________

Reviewed by: ____________________  Date: __________

Approved by: ____________________  Date: __________
