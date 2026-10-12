# Test Summary Report: shard server-18 (IEEE 829)

## 1 Report identifier and scope

- Report id: server-18
- Project: `@paperclipai/server` (t3-nightly slow-tests job)
- Files: 11 (all under `server/src/__tests__/`)
- Test cases: 232 (issue-comment-reopen-routes is 99 = 77 `it` plus `it.each` / `describe.each` expansions)
- Date: see git
- Framework: Vitest 4.1.10, ISO/IEC/IEEE 29119 and ISTQB rubric V1-V9

## 2 Summary

All 11 files and every case were read in full and checked against the production sources they exercise (`routes/issues.ts`, `services/issues.ts`, `issue-dossier.ts`, `issue-evidence-links.ts`, `issue-execution-policy.ts`, `issue-dependency-wakeups.ts`, `issue-continuation-summary.ts`). All subjects still exist in the fork and assertions match current fork behaviour. The dossier, evidence gate and evidence-link suites cover fork-owned PC-001/002/007 features (Teable, NAS, MinIO providers) and are well specified. No upstream-only or stale-default assertions were found.

Verdicts: VALID 2, VALID_WITH_NOTES 6, REWRITTEN 3, OBSOLETE_REMOVED 0, NEEDS_DECISION 0.

## 3 Variances

- Embedded Postgres suites (issue-create-deduplication-routes, issue-dossier-service, issue-evidence-gate, issue-evidence-links) could not start on this Windows host: `beforeAll` timed out at 30s (ENV). Only the one non-DB case in issue-evidence-gate ran (it passed). The other cases of these four files were reviewed statically and are not dynamically verified here. No PG-dependent code was edited.
- The cold import of the 13k-line `routes/issues.ts` takes 15-20s on this host and exceeded the per-test timeout of the first test in two files (ENV, fixed structurally, see section 8).

## 4 Comprehensive assessment (defects by rubric code)

| Code | Count | Summary |
|---|---|---|
| V1 | 0 | No stale or upstream-only behaviour found |
| V2 | 3 | widened status matcher `[200,201,409]` (fixed); `it.each` over 3 labels whose callback ignores the parameter (reported); error-shape sanity test built `HttpError` by hand instead of calling `unprocessable()` (fixed) |
| V3 | 6 | cold-import timeouts charged to the first test in 2 files (fixed); fixed 25ms sleeps used to assert absence of fire-and-forget wakeups, 3 cases (reported); 1100ms real sleep in dossier-service (reported) |
| V4 | 0 | module registry, mocks and temp DBs are reset in all files |
| V5 | 2 | comment-reopen `mockDb` select chain lacked `.limit()`, so the real dependency-wake dedupe lookup threw and was silently swallowed (fixed); route tests replace `services/index.js` wholesale with hand-built stand-ins instead of importOriginal (reported, systemic) |
| V6 | 2 | "race/reopen" test name implies concurrency but it is sequential; "lowercase approval" label has an uppercase-marker body |
| V7 | 1 | cross-issue run-validation cases ("invalid", "wrong agent", "wrong company") do not exercise distinct inputs; the real logic is covered in cross-issue-influence-limit tests |
| V8 | 0 | |
| V9 | 2 | reviewer-policy arrange block copied about 15 times in comment-reopen; `waitForWakeup` is a trivial wrapper |

## 5 Summary of results

| File | Tests | Verdict | Defects | Action |
|---|---|---|---|---|
| issue-comment-reopen-routes.test.ts | 99 | REWRITTEN | V2, V3, V5, V7, V9 | Added warm-up `beforeAll`; added `limit` to db mock; tightened `[200,201,409]` to `409`. After edit 99/99 pass |
| issue-continuation-summary.test.ts | 4 | VALID | none | none (ran, pass) |
| issue-create-deduplication-routes.test.ts | 8 | VALID_WITH_NOTES | V3 (wall-clock offsets only) | none; embedded PG, not runnable here (ENV) |
| issue-dependency-wakeups-routes.test.ts | 3 | REWRITTEN | V3 | Added warm-up `beforeAll` (first test timed out cold). After edit 3/3 pass |
| issue-document-restore-routes.test.ts | 6 | VALID_WITH_NOTES | V5 (hand-built services mock) | none (ran, pass) |
| issue-dossier-fixture.test.ts | 20 | VALID | none | none (ran, pass) |
| issue-dossier-service.test.ts | 13 | VALID_WITH_NOTES | V3 | none; embedded PG not runnable (ENV) |
| issue-dossier-view.test.ts | 6 | VALID | none | none (ran, pass) |
| issue-evidence-gate.test.ts | 16 | REWRITTEN | V2, V6 | error-shape case now calls real `unprocessable()`. PG cases not runnable (ENV); the edited case passes |
| issue-evidence-links.test.ts | 38 | VALID_WITH_NOTES | none material | none; embedded PG not runnable (ENV) |
| issue-execution-policy-routes.test.ts | 19 | VALID_WITH_NOTES | V5 | none (ran, pass) |

## 6 Per-test detail (cases that are not clean)

| File | Test | Code | Finding | Action |
|---|---|---|---|---|
| issue-comment-reopen-routes | does not reopen via POST comment+reopen when the assignee agent is the actor on a cancelled issue | V2 | accepted 200, 201 or 409, so most behaviours would pass | Tightened to 409 (verified against route) |
| issue-comment-reopen-routes | treats reopen=true as a no-op when the issue is already open | V3 | first test paid the cold import; timed out at 20s on this host | warm-up `beforeAll` |
| issue-comment-reopen-routes | auto-approves a reviewer comment and wakes dependents when the final blocker resolves | V5 | db mock had no `.limit`; dedupe lookup threw `limit is not a function` (logged, swallowed) | added `limit` to mock |
| issue-comment-reopen-routes | rejects comment and PATCH writes with a %s run (x3) | V2/V7 | parameter unused, three identical cases, run validation is mocked | reported only (changing would alter case count) |
| issue-comment-reopen-routes | persists comment-only posts...; keeps terminal issues terminal...; skips the assignee wakeup when concurrently cancelled | V3 | fixed 25ms sleep to assert absence | reported; no deterministic hook exists on a fire-and-forget wake |
| issue-comment-reopen-routes | auto-approves positive approval phrasings (lowercase approval) | V6 | label says lowercase, body has uppercase marker | reported |
| issue-dependency-wakeups-routes | wakes dependents when the final blocker transitions to done | V3 | cold-import timeout on the first test | warm-up `beforeAll` |
| issue-evidence-gate | unprocessable() throws an HttpError with a 422 status | V2 | constructed `HttpError` directly; asserted nothing about `unprocessable` | now calls `unprocessable()`, asserts instance, message, status, details |
| issue-evidence-gate | race/reopen: a close is re-blocked... | V6 | name says race, test is sequential | reported |
| issue-dossier-service | queryScopeChangeTimestamps reports the first-signal timestamp per card | V3 | real 1100ms sleep; assertions never compare the two timestamps, so the sleep proves nothing | reported; suggest asserting second `at` > first (needs PG to verify) |
| issue-create-deduplication-routes | does not let closed or older issues block a recreate | V3 | hard-coded 49h offset against a 48h window with no production constant imported | reported |

## 7 Evaluation and recommendations

- Product findings: none. No suspected production bug.
- Systemic: route test files replace `../services/index.js` with a hand-written object. Adding a new service export used by `routes/issues.ts` breaks them. Prefer `importOriginal` partial mocks or a shared helper under `__tests__/helpers`.
- Extract the reviewer-policy issue fixture in issue-comment-reopen-routes into a factory (about 15 copies).
- Make the cross-issue run-validation cases call the real `observeCrossIssueInfluence` with a stub DB, or drop the unused table parameter.
- Coverage gaps: dedupe window boundary (47h/48h) not tested at the edge; the 1100ms sleep in dossier-service should assert ordering of the two scope-change timestamps.
- The Windows embedded-Postgres startup timeout (30s) is environmental; Linux CI is the authority for those four files.

## 8 Summary of activities

Files rewritten:
- `issue-comment-reopen-routes.test.ts`: warm-up `beforeAll` (120s hook) for the cold import; `limit` added to the db select mock; weak status matcher tightened to 409.
- `issue-dependency-wakeups-routes.test.ts`: warm-up `beforeAll` so the first test is not charged the cold import.
- `issue-evidence-gate.test.ts`: tautological error-shape test now exercises the real `unprocessable()` helper.

Deletions: none.

Commands (repo root):
- `npx vitest run server/src/__tests__/issue-comment-reopen-routes.test.ts`: first run 98/99 (first test cold-import timeout, ENV); after edits 99/99 pass.
- Six-file run (continuation-summary, dossier-view, dossier-fixture, document-restore, dependency-wakeups, execution-policy): 57/58; the failure was the cold-import timeout, fixed; dependency-wakeups re-run 3/3 pass.
- `npx vitest run server/src/__tests__/issue-evidence-gate.test.ts`: embedded PG `beforeAll` timed out at 30s (ENV); the 1 non-DB test passed, 15 skipped.

## 9 Approvals

Prepared by: ______________________  Date: __________

Reviewed by: ______________________  Date: __________

Approved by: ______________________  Date: __________
