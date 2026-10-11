# Test Summary Report: shard server-17 (IEEE 829 structure)

## 1 Report identifier and scope
- Report id: server-17
- Project: server (vitest project `@paperclipai/server`), t3-nightly slow-tests audit
- Files: 11 (all under `server/src/__tests__/`)
- Test cases: 184 (it/test cases with each-table expansions counted; 36 of these sit in four embedded-Postgres files)
- Date: see git
- Rubric: ISO/IEC/IEEE 29119 and ISTQB, codes V1 to V9 as defined in the audit brief

## 2 Summary
All 11 files were read in full and checked against the production sources they exercise (`routes/issues.ts`, `middleware/error-handler.ts`, `attachment-types.ts`, and the shared create-issue status default). No test targets upstream-only behaviour; every subject exists in the fork. Six files carried real defects (vacuous or widened assertions, a fake error handler, shared-mock mutation, an unscoped UPDATE) and were rewritten. No test was deleted and no assertion was weakened.

Verdict counts: VALID 1, VALID_WITH_NOTES 4, REWRITTEN 6, OBSOLETE_REMOVED 0, NEEDS_DECISION 0.

## 3 Variances
- Four embedded-Postgres files (issue-blocker-attention, issue-blocker-diagnostics-routes, issue-comment-attribution-audit-routes, issue-comment-redaction; 36 tests) could not execute on this Windows host. Their `beforeAll` has an explicit 20 s timeout in the file, which cannot be overridden from the CLI, and embedded Postgres startup exceeded it under heavy machine contention. Classified ENV. The tests were skipped, not failed, at test level. Two of these files were edited (attribution-audit, redaction); the edits are small but unverified dynamically and must be confirmed by t3-nightly on Linux.
- Route-graph tests hit a 20 s cold-import timeout on their first test under load; they passed with `--testTimeout=120000`. Classified ENV.
- Pino logs show `db.select/transaction is not a function` warnings from best-effort side effects (evidence log, external-object sync) swallowed by the SUT. They come from minimal db stubs and are not failures.

## 4 Comprehensive assessment (cross-cutting defects)
| Code | Count | Detail |
|---|---|---|
| V1 Validity | 1 | attribution-audit used a hand-written error handler that drops `details`, so assertions on `body.details.code` could not match production behaviour |
| V2 Meaningful assertions | 8 | closed-workspace: three `not.toBe(409)` checks that passed on 500/404 because the mocks made the happy path fail; attachment: two `[undefined, expected]` header checks that pass when the header is absent, plus one `[200,201]` widening; assigned-backlog: two tests with an `if (status !== 201) {...; return}` escape hatch that is dead under the current default-status logic |
| V3 Determinism | 1 | blocker-attention `pinnedNow` is a fixed past date (deterministic, misleading name); no wall-clock races otherwise |
| V4 Isolation | 2 | ownership test replaced `mockAccessService.decide` on the shared hoisted object; redaction test updated all `issue_comments` rows with no WHERE |
| V5 Mock fidelity | 8 files | hand-built `services/index.js` mocks without `importOriginal` in most route tests (rot risk; noted, not changed because `routes/issues.ts` reads many exports); closed-workspace issue mock lacked methods the comment route needs |
| V6 Clarity | 2 | blocker-attention "classifies recovery issues and missing successful-run dispositions" asserts about eight scenarios in one test; ownership file is 2400 lines |
| V7 Coverage | notes | see section 7 |
| V8 Portability | 2 | attribution-audit sets `PAPERCLIP_HOME=/tmp/...` (POSIX path, harmless); embedded Postgres suites need Linux |
| V9 Maintainability | 3 | repeated 40-line service mock blocks across route tests; duplicated `getById` fixtures in attachment tests |

## 5 Summary of results
| File | Tests | Verdict | Defect codes | Action taken |
|---|---|---|---|---|
| server/src/__tests__/issue-activity-events-routes.test.ts | 10 | VALID_WITH_NOTES | V5, V9 | None. Passed in baseline run |
| server/src/__tests__/issue-agent-mutation-ownership-routes.test.ts | 87 (63 declared, each-tables expand) | REWRITTEN | V4, V5, V6 | Authorization-path test now configures the reset-managed `mockAccessService.decide` instead of overwriting it. 87/87 pass |
| server/src/__tests__/issue-assigned-backlog-contract-routes.test.ts | 3 | REWRITTEN | V2 | Removed dead early-return branches; both default-status tests assert 201 and the todo contract. 3/3 pass |
| server/src/__tests__/issue-assignee-invokability-routes.test.ts | 7 | VALID_WITH_NOTES | V5 | None. Passed in baseline run |
| server/src/__tests__/issue-attachment-routes.test.ts | 23 | REWRITTEN | V2 | Tightened `[200,201]` to 201; html and image disposition checks require the exact header (the route always sets it). 23/23 pass |
| server/src/__tests__/issue-blocker-attention.test.ts | 25 | VALID_WITH_NOTES | V3, V6 | None. Embedded Postgres; not executable here (ENV) |
| server/src/__tests__/issue-blocker-diagnostics-routes.test.ts | 5 | VALID | none | None. Embedded Postgres; not executable here (ENV) |
| server/src/__tests__/issue-closed-workspace-routes.test.ts | 12 | REWRITTEN | V2, V5 | Comment, comment-update and checkout happy paths now assert real success (201/200) and the side effect; added the missing service mocks. 12/12 pass |
| server/src/__tests__/issue-comment-attribution-audit-routes.test.ts | 2 | REWRITTEN | V1, V5, V8 | Replaced fake error handler with the production `errorHandler`. Unverified (ENV) |
| server/src/__tests__/issue-comment-cancel-routes.test.ts | 6 | VALID_WITH_NOTES | V5 | None. Passed in baseline run |
| server/src/__tests__/issue-comment-redaction.test.ts | 4 | REWRITTEN | V4 | Scoped the delete-marking UPDATE to the target comment. Unverified (ENV) |

## 6 Per-test detail (non-clean tests)
| File | Test | Code | Finding | Action |
|---|---|---|---|---|
| issue-agent-mutation-ownership-routes | uses the authorization decision path for assignment changes | V4 | Reassigned `mockAccessService.decide` on the shared hoisted object; the initial vi.fn implementation was dead code | Uses and configures the shared mock |
| issue-assigned-backlog-contract-routes | does not silently create a top-level assigned issue as backlog when status is omitted | V2 | Early-return branch accepted 400/422 and asserted nothing about the contract; current behaviour is 201 with status todo | Asserts 201, branch removed |
| issue-assigned-backlog-contract-routes | does not let a parent-blocking assigned child become an unwoken backlog leaf by default | V2 | Same | Same |
| issue-attachment-routes | accepts zip uploads for issue attachments | V2 | `[200,201]` widened matcher; sibling tests expect 201 | Exact 201 |
| issue-attachment-routes | serves html attachments as downloads with nosniff | V2 | Allowed the header to be undefined although the name promises a download | Exact `attachment; filename="report.html"` |
| issue-attachment-routes | keeps image attachments inline for previews | V2 | Allowed the header to be undefined | Exact `inline; filename="preview.png"` |
| issue-closed-workspace-routes | reopens the closed isolated workspace and accepts a new comment | V2, V5 | `not.toBe(409)` passed on a 500 (addComment/findMentionedAgents mocks missing) | Mocks added; asserts 201 and addComment called once |
| issue-closed-workspace-routes | reopens the closed isolated workspace and accepts a comment update | V2, V5 | `not.toBe(409)` passed on a 404 (update mock returned undefined) | update mocked; asserts 200 |
| issue-closed-workspace-routes | reopens the closed isolated workspace and accepts a checkout | V2 | `not.toBe(409)` | Asserts 200 and checkout called once |
| issue-comment-attribution-audit-routes | rejects and audits an agent-supplied onBehalfOfUserId | V1, V5 | Custom error middleware returned only `{error}`, so `body.details.code` could never match what production returns | Production errorHandler |
| issue-comment-redaction | clears issue references sourced from deleted comment bodies | V4 | UPDATE of `issue_comments` without WHERE | `where(eq(id, commentId))` |
| issue-blocker-attention | does not treat an expired scheduled retry as actively covered work | V3, V6 | `pinnedNow` is a fixed date used only to build a past timestamp; correct but misleading | Noted only |
| issue-blocker-attention | classifies recovery issues and missing successful-run dispositions | V6 | One test, about eight scenarios, many reasons to fail | Noted; split recommended |

## 7 Evaluation and recommendations
- No suspected production bug found; no NEEDS_DECISION.
- Pattern to retire: `expect(status).not.toBe(409)` style negative checks combined with bare `vi.fn()` services. A missing service mock makes the route return 500 and the test still passes. Assert the exact success status.
- Hand-built `services/index.js` mocks appear in nearly every route test. A shared helper built with `importOriginal` plus overrides would remove roughly 100 duplicated lines per file and prevent rot (V5, V9).
- Coverage gaps: attachment routes have no test for a missing file field or an issue/company mismatch on upload; invokability covers only paused agents (not archived or terminated); closed-workspace has no case where the workspace lookup returns nothing.
- t3-ci does not run the server project, so these suites only run in t3-nightly. The four embedded-Postgres files gave no signal on Windows; the two edits there need a Linux confirmation.

## 8 Summary of activities
Files rewritten, with reason:
- issue-agent-mutation-ownership-routes.test.ts: stop replacing the shared access mock (V4).
- issue-assigned-backlog-contract-routes.test.ts: remove escape branches, assert the actual contract (V2).
- issue-attachment-routes.test.ts: three assertions tightened (V2).
- issue-closed-workspace-routes.test.ts: happy paths genuinely succeed and are asserted as such (V2, V5).
- issue-comment-attribution-audit-routes.test.ts: production error handler (V1).
- issue-comment-redaction.test.ts: scoped UPDATE (V4).

Deletions: none.

Commands and outcomes (repo root, one vitest process at a time):
- Baseline of all 11 files: 148 passed, 36 skipped, 4 files failed on `beforeAll` timeout (ENV, embedded Postgres under load).
- `npx vitest run issue-closed-workspace-routes.test.ts`: with tightened assertions first failed (500 and 404 exposed vacuous tests); after adding mocks 12/12 pass (run with `--testTimeout=120000` because cold import under load exceeded 20 s once; ENV).
- `npx vitest run issue-agent-mutation-ownership-routes issue-assigned-backlog-contract-routes issue-attachment-routes --testTimeout=120000`: 113/113 pass.
- `npx vitest run issue-comment-attribution-audit-routes issue-comment-redaction`: both suites skipped after the 20 s `beforeAll` timeout (ENV); edits unverified.

## 9 Approvals
- Prepared by: ____________________  Date: ________
- Reviewed by: ____________________  Date: ________
- Approved by: ____________________  Date: ________
