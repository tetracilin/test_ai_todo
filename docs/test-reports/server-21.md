# Test Summary Report: shard server-21 (IEEE 829 structure)

## 1. Report identifier and scope

- Report id: `server-21`
- Project: `@paperclipai/server` (vitest project `server`), t3-nightly "slow-tests" job
- Files in shard: 10 (about 9,990 lines)
- Test cases: 175 after edits (176 before; 2 byte-identical duplicates removed, 1 positive-control test added). Counts expand `it.each` (watchdog agent status table = 3 cases).
- Date: see git

## 2. Summary

Every file was read in full and checked against the production source it exercises (`routes/issues.ts`, `routes/issues-checkout-wakeup.ts`, `routes/workspace-command-authz.ts`, `services/issues.ts`, route-test harness). The subjects all still exist in the fork, and assertions match current behaviour. No test asserts upstream-only behaviour. The only upstream residue is cosmetic (fixture strings and PR-number comments).

Verdicts: VALID 4, VALID_WITH_NOTES 3, REWRITTEN 3, OBSOLETE_REMOVED 0 (files), NEEDS_DECISION 0.
Test-level removals: 2 exact duplicates (see section 8).

## 3. Variances (what could not be verified)

- Windows host: embedded Postgres does not start in the 20 s `beforeAll` hook (ENV). All DB-backed files (`issues-service`, `issue-watchdogs-routes`, `issue-wake-diagnostics-routes`, `issues-list-query-parsing`, `issues-parent-id-alias`) were therefore reviewed statically only. They show as skipped/hook-timeout locally. The edit to `issues-service.test.ts` (dead DDL helper, duplicate removal, describe rename) is unverified dynamically and must be confirmed in t3-nightly.
- `issue-update-comment-wakeup-routes.test.ts` tests 1 and 2 time out at 20 s on this machine (ENV: cold import of the real `routes/issues.js` plus contention). The same two tests fail identically on the unmodified HEAD copy, which I ran as a throwaway file and then deleted. The other 7 tests pass with my edits.
- The Windows working tree uses CRLF; edits preserved CRLF.

## 4. Comprehensive assessment (cross-cutting defects by rubric code)

| Code | Count | Notes |
|------|-------|-------|
| V1 Validity | 0 defects, 2 notes | Upstream PR numbers in comments (`issues-service` regression comments cite upstream PR #2482; `issues-list-query-parsing` cites upstream issue #4628). Fixture strings reference `paperclipai/paperclip/pull/3303`. These are inert. Legacy `plugin:paperclipai.content-machine:*` origin kinds are still real in `services/issues.ts` (LEGACY_PLUGIN_OPERATION_ORIGIN_KINDS). |
| V2 Meaningful assertions | 1 | Closure-comment "does not wake" test awaited one `setImmediate` tick before a negative assertion, so it could pass before the wake decision ran (fixed). |
| V3 Determinism | 3 | `waitForAssignmentWakeup` (20 x 10 ms poll that silently returns on timeout); 10 ms sleep to let `assertCheckoutOwner` block on a row lock (test can pass without exercising the race); the wake-diagnostics tests use `Date.now()` offsets (benign). Only the first was left unfixed (unverifiable here; see section 7). |
| V4 Isolation | 1 | `vi.clearAllMocks()` keeps implementations, so `getRun`, `cancelRun` and `expireRequestConfirmationsSupersededByComment` overrides leaked from one test into later ones (fixed). |
| V5 Mock fidelity | 2 | `issues-service.test.ts` carried a hand-written `CREATE TABLE issue_relations` helper that duplicates migration 0049 (removed). The services barrel is hand-mocked in 3 route files, with a copy-pasted block twice inside one file (`vi.mock` plus `vi.doMock`). This is established fork pattern and the SUT itself is not mocked. Noted, not changed. |
| V6 Clarity | 1 | Two `describe` blocks with the same name in `issues-service` (fixed by rename). |
| V7 Coverage balance | 2 | `issue-workspace-command-authz` had only deny paths (added a board control). Gaps listed in section 7. |
| V8 Portability | 1 | `/tmp/...` fixture paths and shell-ish command strings are inert data. DB suites need embedded Postgres (skipped automatically when unsupported). |
| V9 Maintainability | 3 | Two byte-identical duplicate tests (removed); the same seeding boilerplate repeated about 60 times in `issues-service` (noted); duplicated mock blocks (noted). |

## 5. Summary of results

| File | Tests | Verdict | Defect codes | Action |
|------|-------|---------|--------------|--------|
| server/src/__tests__/issue-update-comment-wakeup-routes.test.ts | 9 | REWRITTEN | V2, V4, V9 | Reset leaking mocks in `beforeEach`; replaced one-tick wait with `vi.waitFor` on the mention scan. Dynamic: 7 pass; tests 1-2 timeout is ENV and identical on HEAD. |
| server/src/__tests__/issue-wake-diagnostics-routes.test.ts | 7 | VALID | none | Embedded PG; static review only. Covers redaction, truncation caps, cross-tenant 404, boundary-scoped agents. |
| server/src/__tests__/issue-watchdogs-routes.test.ts | 11 | VALID_WITH_NOTES | V3 | Silent-timeout poll helper left as is (see 6). Static review only. |
| server/src/__tests__/issue-workspace-command-authz.test.ts | 3 | REWRITTEN | V7 | Added board control test; strengthened deny assertions to name the offending field. 3/3 pass. |
| server/src/__tests__/issues-checkout-wakeup.test.ts | 4 | VALID | none | Pure function, full branch coverage (4 of 4 guards). 4/4 pass. |
| server/src/__tests__/issues-goal-context-routes.test.ts | 6 | VALID_WITH_NOTES | V5 | Hand-built service mocks; acceptable. Not edited, not run. |
| server/src/__tests__/issues-list-query-parsing.test.ts | 5 | VALID_WITH_NOTES | V1 (comment only) | Cites upstream issue URL in a comment; behaviour matches route. DB suite hook-timeout (ENV). |
| server/src/__tests__/issues-parent-id-alias.test.ts | 6 | VALID | none | Matches `req.query.parentId ?? req.query.parentIssueId` at routes/issues.ts lines 6193 and 6386. DB suite (ENV). |
| server/src/__tests__/issues-service.test.ts | 118 | REWRITTEN | V5, V6, V9, V3 (note) | Removed dead DDL helper and its 5 calls; renamed duplicate describe; removed 2 byte-identical duplicate tests. Unverified locally (ENV). |
| server/src/__tests__/issues-user-context.test.ts | 6 | VALID | none | Pure; covers fallbacks, ordering and string timestamps. 6/6 pass. |

## 6. Per-test detail (tests that are not clean)

| File | Test | Code | Finding | Action |
|------|------|------|---------|--------|
| issue-update-comment-wakeup-routes | does not wake the assignee when a closure comment marks the issue done | V2/V3 | Negative assertion after a single `setImmediate` could run before the async wake path. | Now waits for `findMentionedAgents` call, then asserts. Passes. |
| issue-update-comment-wakeup-routes | interrupts... / tags the wake... | V4 | `getRun`, `cancelRun`, `expireRequestConfirmationsSupersededByComment` return values leaked into later tests. | Reset in `beforeEach`. |
| issue-update-comment-wakeup-routes | includes the new comment in assignment wakes; interrupts the active run and wakes... | ENV | 20 s timeout on Windows, also on HEAD. | None (environment). |
| issue-watchdogs-routes | does not create an immediate watchdog review for a newly assigned issue | V3 | `waitForAssignmentWakeup` returns silently after about 200 ms, so a slow wake makes the negative assertions vacuous. | Not changed: converting it to a hard failure cannot be verified without Postgres and could redden nightly. Recommend `vi.waitFor` with a time bound. |
| issues-service | rejects/adopts via `assertCheckoutOwner` ("adopts unowned checkout after a concurrent stale-checkout clear wins the lock race") | V3 | Uses a fixed 10 ms sleep to assume the SUT is blocked on the row lock. If the SUT is slower, the race is not exercised but the test still passes. | Not changed (unverifiable). Recommend polling `pg_stat_activity` for `wait_event_type = 'Lock'`. |
| issues-service | inherits the parent issue workspace linkage when child workspace fields are omitted (second copy) | V9 | Byte-identical to the first copy in "issueService.create workspace inheritance". | Removed duplicate. |
| issues-service | keeps explicit workspace fields instead of inheriting the parent linkage (second copy) | V9 | Byte-identical duplicate. | Removed duplicate. |
| issues-service | describe "issueService.create workspace inheritance" (second) | V6 | Two describes shared a name; remaining tests cover project derivation and settings sync. | Renamed to "... (project derivation and settings sync)". |
| issues-service | all embedded-PG describes | V5 | `ensureIssueRelationsTable` hand-wrote DDL for a table that migration 0049 already creates; schema drift risk. | Removed. |
| issues-service | regression comments citing upstream PR #2482 | V1 | Cosmetic upstream reference. | Left. |
| issue-workspace-command-authz | both agent denial tests | V7 | Only negative paths; denial could be a blanket 403. | Added board allowed control; denial assertions now name `runtimeProvisionCommand` / `teardownCommand`. |

## 7. Evaluation and recommendations

Product findings: none. No suspected production bug and no policy conflict with the fork (no Hermes, adapter-default, teable or pipeline assumptions in this shard).

Coverage gaps (not added because they need DB or are not cheap):
- `issue-workspace-command-authz`: only create and patch via `assigneeAdapterOverrides` are covered; no case for `cleanupCommand` or `provisionCommand` keys, nor for an agent payload without commands (positive control for agents).
- `issues-checkout-wakeup`: `actorType: "none"` and an agent with a null `actorAgentId` are not covered (both return true in the source).
- `issues-service`: about 60 tests re-inline the same company/agent seeding; extract `seedCompany`/`seedAgent` helpers to cut about 1,500 lines (V9). Split the 6.8k-line file by describe.
- Route tests that hand-mock `../services/index.js` (3 files, plus a duplicated `vi.mock`/`vi.doMock` pair in one) will rot when services are added. Prefer `importOriginal` partial mocks.
- Make `waitForAssignmentWakeup` and the 10 ms lock sleep deterministic (section 6).
- Embedded Postgres 20 s `beforeAll` is too tight on Windows; consider a larger shared hook timeout in harness code.

## 8. Summary of activities

Files rewritten:
- `server/src/__tests__/issue-update-comment-wakeup-routes.test.ts`: mock reset in `beforeEach`; deterministic wait before negative assertion.
- `server/src/__tests__/issue-workspace-command-authz.test.ts`: board control test (+1 test), sharper deny assertions.
- `server/src/__tests__/issues-service.test.ts`: removed `ensureIssueRelationsTable` helper and 5 call sites; renamed second describe; removed 2 duplicate tests.

Deletions with justification: two tests in the second "issueService.create workspace inheritance" describe, verified byte-identical (line-range string comparison) to the tests of the same name in the first describe. Zero unique coverage lost.

Commands and outcomes (from repo root, one vitest process at a time):
- `pnpm --filter @paperclipai/plugin-sdk ensure-build-deps`: OK.
- `npx vitest run` on `issues-checkout-wakeup`, `issues-user-context`, `issues-list-query-parsing`: 10 pass; list-query suite hook-timeout 20 s (ENV, embedded Postgres).
- `npx vitest run` on `issue-workspace-command-authz`: 3/3 pass.
- `npx vitest run` on `issue-update-comment-wakeup-routes`: 7 pass, 2 timeouts (ENV, same on HEAD baseline copy, since deleted).
- `issues-service`, watchdogs, diagnostics, parent-alias: not runnable here (embedded Postgres); static review only.

## 9. Approvals

Prepared by: ______________________  Date: __________

Reviewed by: ______________________  Date: __________

Approved by: ______________________  Date: __________
