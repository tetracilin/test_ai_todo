# Test Summary Report: server-07 (IEEE 829)

## 1 Report identifier and scope

| Item | Value |
|---|---|
| Report id | server-07 |
| Project | `@paperclipai/server` (vitest, `server/src/__tests__`) |
| Files in shard | 18 |
| Test cases (after edits) | 224 (company-skills-service 56, company-skills-routes 53, company-skills 19, costs-service 19, db-errors 12, cross-issue-influence-limit 10, cursor-local-adapter 10, company-transfer-runs 9, cursor-local-adapter-environment 6, decision-queues-routes 6, cursor-local-execute 5, config-file 5, cursor-local-skill-injection 3, dashboard-service 3, decision-retention-service 3, cursor-local-skill-sync 2, company-user-directory-route 2, cross-issue-influence-limit-postgres 1). `it.each` expansions: routes 3 (test-run denial) + 2 (GitHub uppercase .MD), cross-issue 3 (locked-run). |
| Date | see git |
| Rubric | ISO/IEC/IEEE 29119 + ISTQB, codes V1-V9 |

## 2 Summary

Every file was read in full and checked against its production source. All 18 subjects still exist in the fork and assertions match current fork behaviour (open-default skill mutation policy, `paperclipai/paperclip/*` bundled skill keys still emitted by `packages/adapter-utils/src/server-utils.ts`, `skills-releases/paperclip` frozen releases v0 and v7-roster, cross-issue influence cap now past its 2026-08-11 enforcement date).

Verdict counts: VALID 3, VALID_WITH_NOTES 4, REWRITTEN 11, OBSOLETE_REMOVED 0, NEEDS_DECISION 0.

Defects fixed: 4 widened matchers (`[200, 201]`), 1 conditional assertion that could not fail on its own, 3 mislabelled test names, 1 untested exported helper (`isForeignKeyViolation`), 3 missing negative/boundary paths, and 8 POSIX-only test groups that failed on Windows for environmental reasons (now guarded).

## 3 Variances

- Windows host. Embedded Postgres does not boot within the 20-30 s hook timeout on this machine (also under contention from concurrent audit agents). Seven files that depend on it could not be executed (fully or in part): company-transfer-runs, costs-service (PG half), cross-issue-influence-limit-postgres, dashboard-service (PG half), decision-queues-routes, decision-retention-service, company-skills-service. They were reviewed statically only. Their pass/fail on t3-nightly (Linux) is authoritative. No edits were made to the PG-dependent assertions, so no regression risk was introduced there; the only edits to company-skills-service are `skipIf(win32)` guards.
- POSIX-only cursor-local tests (shebang scripts, `:` PATH separator, symlinks) cannot run here; guarded and unverified. 13 of 16 cases in the four edited cursor files skip on win32 and must be confirmed on Linux CI.
- `company-skills-service` bundled-release test pins SHA-256 hashes of `skills-releases/paperclip/v7-roster/*`. I verified the pins match the LF-normalized files in the repo (`SKILL.md` 53ab2904..., `cases.md` 3b821f59..., `workflows.md` 69747bd6...). On a Windows checkout with `core.autocrlf` the working tree is CRLF and the pins would differ (ENV, not a product bug).
- `dashboard-service` and `costs-service` PG tests use the real wall-clock (`new Date()`); not verifiable here.

## 4 Comprehensive assessment (cross-cutting defects)

| Code | Count | Description |
|---|---|---|
| V1 Validity | 0 defects | No stale upstream assumptions found. Note: `cross-issue-influence-limit` still tests the `log_only` rollout mode although `CROSS_ISSUE_INFLUENCE_ENFORCE_AT` (2026-08-11) is past; still valid code path, but dead in production now. |
| V2 Meaningful assertions | 5 | 4x `expect([200, 201]).toContain(status)` in company-skills-routes (import always returns 201); 1x try/catch in company-skills where the secret-leak assertion lived only in `catch` (fixed to capture and assert unconditionally). |
| V3 Determinism | 3 notes | dashboard-service/costs-service wall-clock windows (bounded, near-midnight UTC window flake in dashboard `utcDay` buckets is theoretical); decision-queues uses fixed past dates (`2026-08-03`) for `snoozedUntil`, would break if the service ever validates future-only. Cursor env tests use `Date.now()+Math.random()` temp names (harmless). |
| V4 Isolation | 2 notes | cursor-local-adapter-environment first three tests remove their temp root only on the success path (leak on failure). HOME is restored in `finally` everywhere else. |
| V5 Mock fidelity | 3 notes | cross-issue-influence-limit uses a hand-built drizzle tx fake (backed by a real-PG test for the lock); company-user-directory-route hand-builds a table-sniffing db stub; company-skills-routes mocks `services/index.js` by hand but uses `importActual` for company-skills, policy and consent-gate modules (good). |
| V6 Clarity | 3 | costs-service: three tests titled "returns 400" only called pure parsers. Renamed; HTTP 400 mapping now covered by two new route tests. |
| V7 Coverage | 5 | Added: `isForeignKeyViolation` (4 cases, was untested), cross-company 403 for user-directory, route-level 400 for invalid date/limit (2), cursor unknown-session negatives. Remaining gaps listed in section 7. |
| V8 Portability | 9 | 3 symlink-based tests in company-skills-service + 1 in company-skills + 3 cursor files and the 3 shebang/symlink cases in cursor-local-adapter-environment (guarded with `it.skipIf(process.platform === "win32")`). Hash pins depend on LF endings. |
| V9 Maintainability | 4 notes | company-skills-service helper `runtimeSkillName` mirrors production `buildSkillRuntimeName`; large inline fixture duplication (company/issuePrefix inserts repeated ~50x); costs-service mixes route-mock and real-PG suites in one file with a duplicate vitest import (merged); two near-duplicate consent-gate tests in company-skills-routes. |

## 5 Summary of results

| File | Tests | Verdict | Defect codes | Action taken |
|---|---|---|---|---|
| server/src/__tests__/company-skills-routes.test.ts | 53 | REWRITTEN | V2, V9 | 4 `[200,201]` matchers tightened to `toBe(201)`; 53/53 pass locally |
| server/src/__tests__/company-skills-service.test.ts | 56 | REWRITTEN | V8, V9 | 3 symlink tests guarded for win32; PG not runnable here (module compiles, hook timeout) |
| server/src/__tests__/company-skills.test.ts | 19 | REWRITTEN | V2, V8 | secret-echo assertion made unconditional; symlink test guarded; 18 pass, 1 skipped on win32 |
| server/src/__tests__/company-transfer-runs.test.ts | 9 | VALID | none | None; PG not runnable here |
| server/src/__tests__/company-user-directory-route.test.ts | 2 | REWRITTEN | V7 | Added cross-company 403 test; pass |
| server/src/__tests__/config-file.test.ts | 5 | VALID | none | None; pass (unedited run as part of batch) |
| server/src/__tests__/costs-service.test.ts | 19 | REWRITTEN | V6, V7, V9 | Merged duplicate import, renamed 3 tests, added 2 route-level 400 tests; 14 route tests pass, PG half not runnable |
| server/src/__tests__/cross-issue-influence-limit-postgres.test.ts | 1 | VALID_WITH_NOTES | V3 | None; PG not runnable here |
| server/src/__tests__/cross-issue-influence-limit.test.ts | 10 | VALID_WITH_NOTES | V5, V1 | None; pass |
| server/src/__tests__/cursor-local-adapter-environment.test.ts | 6 | REWRITTEN | V8, V4 | 3 POSIX-only tests guarded; 3 remaining pass |
| server/src/__tests__/cursor-local-adapter.test.ts | 10 | REWRITTEN | V7 | Added negative unknown-session test; pass |
| server/src/__tests__/cursor-local-execute.test.ts | 5 | REWRITTEN | V8 | All 5 guarded for win32 (ENOEXEC shebang, sync-path confinement); unverified here |
| server/src/__tests__/cursor-local-skill-injection.test.ts | 3 | REWRITTEN | V8 | All 3 guarded (symlink EPERM); unverified here |
| server/src/__tests__/cursor-local-skill-sync.test.ts | 2 | REWRITTEN | V8 | Both guarded (symlink EPERM); removed stray blank line |
| server/src/__tests__/dashboard-service.test.ts | 3 | VALID_WITH_NOTES | V3 | None; `getUtcMonthStart` test passes, PG tests not runnable |
| server/src/__tests__/db-errors.test.ts | 12 | REWRITTEN | V7 | Added 4 `isForeignKeyViolation` tests; pass |
| server/src/__tests__/decision-queues-routes.test.ts | 6 | VALID_WITH_NOTES | V3 | None; PG not runnable |
| server/src/__tests__/decision-retention-service.test.ts | 3 | VALID | none | None; PG not runnable |

## 6 Per-test detail (not clean)

| File | Test | Code | Finding | Action |
|---|---|---|---|---|
| company-skills-routes | allows local board operators to mutate company skills | V2 | `expect([200,201]).toContain(status)` could pass on the wrong status | `toBe(201)` |
| company-skills-routes | tracks public GitHub skill imports with an explicit skill reference | V2 | same | `toBe(201)` |
| company-skills-routes | does not expose a skill reference for non-public skill imports | V2 | same | `toBe(201)` |
| company-skills-routes | does not expose a skill reference when GitHub metadata is missing | V2 | same | `toBe(201)` |
| company-skills-routes | does not require consent ... / does not invoke the legacy consent gate | V9 | near-duplicates (differ only in gate mock rejection) | kept, noted |
| company-skills | rejects secret-bearing remote URLs without echoing the secret | V2 | no-leak assertion sat in a `catch` that could be skipped | capture error, assert message exactly and no "secret" |
| company-skills | rejects symlinks reachable from a project-scanned skill | V8 | `fs.symlink` EPERM on Windows | `skipIf(win32)` |
| company-skills-service | browses project folders and imports a selected non-standard skill | V8 | creates 251 symlinks | `skipIf(win32)` |
| company-skills-service | imports only selections rediscovered inside project workspaces | V8 | symlink | `skipIf(win32)` |
| company-skills-service | skips a selected project skill whose SKILL.md is a symlink outside the workspace | V8 | symlink | `skipIf(win32)` |
| company-skills-service | seeds bundled skill releases idempotently ... | V8, V9 | pins SHA-256 of release files; CRLF checkouts break; brittle by design (frozen snapshot) | none; noted |
| company-skills-service | removes the old runtime materialization when the key/slug changes | V9 | helper `runtimeSkillName` copies production hashing; would pass vacuously if production naming changed | none; noted |
| costs-service | returns 400 for an invalid 'from'/'to' date string, invalid limits | V6 | title says 400, test calls pure parser | renamed; added route-level 400 tests |
| cursor-local-adapter-environment | adds --yolo ...; does not auto-add --yolo ...; prefers ~/.local/bin/cursor-agent ... | V8 | shebang `agent` script not executable on Windows (status "fail") | `skipIf(win32)` |
| cursor-local-adapter-environment | adds --yolo / does not auto-add / creates missing cwd | V4 | temp root removed only on success path | none; noted |
| cursor-local-execute | all 5 | V8 | ENOEXEC for shebang fake agent; sandbox sync-path confinement rejects Windows paths; `:` PATH split | `skipIf(win32)` |
| cursor-local-skill-injection | all 3 | V8 | symlink EPERM | `skipIf(win32)` |
| cursor-local-skill-sync | all 2 | V8 | symlink EPERM | `skipIf(win32)` |
| cross-issue-influence-limit | all | V5 | hand-built drizzle tx fake | none; covered by PG test |
| cross-issue-influence-limit | logs observations without enforcement during the one-week rollout | V1 | rollout window ended 2026-08-11; code path remains | none; noted |
| decision-queues-routes | records agent decide-by...; serializes concurrent partial triage updates | V3 | fixed past dates for `snoozedUntil` | none; noted |
| dashboard-service | aggregates the full 14-day run activity window | V3 | relative to wall clock | none; noted |

## 7 Evaluation and recommendations

Product findings: none that require a product decision. Observations:
- Bundled-release pins in `company-skills-service` will fail on Windows `autocrlf` checkouts; consider a `.gitattributes` rule (`skills-releases/** text eol=lf`) in a separate PR.
- Cross-issue influence limit: the `log_only` mode is dead in production after 2026-08-11; decide whether to remove the rollout branch and its tests.

Coverage gaps (not added, not cheap): company-skills-service rename of non-managed paths covered but import failure atomicity (partial import rollback) is untested; decision-queues-routes lacks a 401/no-actor case and a cross-company board 403; costs-service has no tests for `window-spend`, `quota-windows` or `finance-events` POST happy paths; company-transfer-runs has no test for cancelling a running run mid-apply; config-file lacks a missing-`$meta` and unknown-nested-key-without-suggestion case.

Recommendation: run all 7 PG-dependent files on Linux/CI to confirm; re-verify the 13 guarded cursor cases there.

## 8 Summary of activities

Files rewritten:
- company-skills-routes.test.ts: 4 widened status matchers made exact.
- company-skills-service.test.ts: 3 symlink tests guarded for Windows.
- company-skills.test.ts: made secret-leak assertion unconditional; guarded symlink test.
- company-user-directory-route.test.ts: added cross-company 403 case.
- costs-service.test.ts: merged duplicate import, honest test names, 2 route-level 400 tests.
- cursor-local-adapter-environment.test.ts, cursor-local-execute.test.ts, cursor-local-skill-injection.test.ts, cursor-local-skill-sync.test.ts: win32 guards for POSIX-only cases.
- cursor-local-adapter.test.ts: added negative unknown-session test.
- db-errors.test.ts: added 4 `isForeignKeyViolation` tests.

Deletions: none.

Commands (repo root, one vitest process at a time):
- `npx vitest run db-errors company-user-directory-route company-skills config-file`: 37 passed, 1 skipped (win32 symlink).
- `npx vitest run cursor-local-adapter-environment`: before guard, 3 ENV failures (shebang exec); after guards all four cursor files: 3 passed, 13 skipped.
- `npx vitest run cursor-local-execute|skill-injection|skill-sync`: before guards 10 ENV failures (EPERM symlink, ENOEXEC, path confinement).
- `npx vitest run costs-service`: 14 passed; PG hook timed out at 20 s (ENV), 5 skipped.
- `npx vitest run company-skills-routes`: 53 passed.
- `npx vitest run cursor-local-adapter`: 10 passed.
- `npx vitest run company-skills-service`: module loads; PG hook timed out (ENV), 56 skipped.
- `npx vitest run company-transfer-runs`: PG hook timed out at 30 s (ENV).
- `npx vitest run cross-issue-influence-limit dashboard-service`: cross-issue 10 passed; dashboard PG hook timed out (ENV); getUtcMonthStart passed.

## 9 Approvals

Prepared by: ______________________  Date: __________

Reviewed by: ______________________  Date: __________

Approved by: ______________________  Date: __________
