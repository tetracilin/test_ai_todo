# Test Summary Report: shard server-03 (IEEE 829 structure)

## 1 Report identifier and scope

- Identifier: server-03 (t3-nightly slow-tests audit)
- Project: `@paperclipai/server` (vitest project `server`)
- Files: 18 (all under `server/src/__tests__/`)
- Test cases: 238 (it/test cases; `it.each` expansions counted: auth-routes 3, auth-session-route 3+3, bootstrap-claim-routes 4)
- Date: see git

## 2 Summary

Every file was read and checked against the current source of its subject (routes/auth.ts, routes/authz.ts, auth/better-auth.ts, middleware/auth.ts, build-commit.ts, build-version.ts, http/body-limits.ts, routes/board-chat.ts, routes/built-in-agents.ts, secrets/aws-secrets-manager-provider.ts, services/budgets.ts, services/attention.ts, services/authorization.ts). All subjects still exist in the fork; no test asserts upstream-only behaviour or a stale default. No obsolete test was found and none was deleted.

Verdicts: VALID 6, VALID_WITH_NOTES 5, REWRITTEN 7, OBSOLETE_REMOVED 0, NEEDS_DECISION 0.

## 3 Variances

- Embedded Postgres does not start on this Windows host (`board-claim.test.ts` run: `beforeAll` hook timed out at 20 s, classified ENV). The suites that use it (attention-service 25, authorization-service 61, board-claim 1, budgets-service PG block 2 = 89 tests) could not be executed here. They were reviewed statically and were NOT edited, because an edit could not be verified.
- authorization-service and the middle of attention-service (lines ~700-1500) were skimmed (helpers, boundary tests, wall-clock usage, assertions) rather than traced line by line.
- Only edited files were run. Result: auth-routes, better-auth, board-mutation-guard, build-commit, bootstrap-claim-routes, built-in-agent-routes, board-chat-route-feature-flag and the unedited authz-existence-oracle-guard are all green.

## 4 Comprehensive assessment (by rubric code)

| Code | Count | Summary |
|---|---|---|
| V1 Validity | 0 | No stale upstream behaviour found. |
| V2 Meaningful assertions | 7 | board-mutation-guard: `expect([200, 204]).toContain(status)` is a widened matcher; the handlers return 204 only. Tightened to `toBe(204)`. |
| V3 Determinism | 2 | attention-service "decide-now feed" uses `Date.now()` with the real service clock (a UTC-midnight crossing could flake the badge/ordering); the service accepts `{ now }` (used by the later week-boundary test). Several attention fixtures use fixed July 2026 dates against the default clock. Not edited (PG unverifiable). |
| V4 Isolation | 1 | board-chat disconnect describe lacked `clearAllMocks`; a stale `spawn` call could satisfy `waitFor`. Fixed. |
| V5 Mock fidelity | 3 | board-chat, bootstrap-claim-routes, built-in-agent-routes replace `../services/index.js` with hand-built factories (no `importOriginal`); budgets-service uses a positional select-queue DB stub that breaks on any query reorder. No current failures; rot risk noted. |
| V6 Clarity | 3 | `it.each` title printed `[object Object]` (bootstrap-claim-routes), fixed; built-in-agent test titled "provisioning" actually tests reset, fixed; authz-company-access shadow-mode title says "logs" but asserts only no-throw (noted). |
| V7 Coverage | 6 | Added missing negative paths (auth-routes, build-commit, better-auth). Remaining gaps in section 7. |
| V8 Portability | 0 | No POSIX-only assumptions found in this shard. |
| V9 Maintainability | 2 | aws provider test repeats the same 8-field config 14 times; attention-service has ~200 lines of seed boilerplate. Noted only. |

## 5 Summary of results

| File | Tests | Verdict | Defect codes | Action |
|---|---|---|---|---|
| server/src/__tests__/attention-service.test.ts | 25 | VALID_WITH_NOTES | V3, V9 | Not run (embedded PG ENV). Wall-clock use noted; no edit. |
| server/src/__tests__/auth-routes.test.ts | 11 (5 orig + 6) | REWRITTEN | V7 | Added GET /profile, blank name 400, 401 for agent/none/userless-board (each x3), 401 for deleted user. Green. |
| server/src/__tests__/auth-session-route.test.ts | 12 (it.each 3+3) | VALID | none | Hand-built DB chains exercise the real middleware; no edit. |
| server/src/__tests__/authorization-service.test.ts | 61 | VALID | none | Not run (PG ENV). Real DB, good allow/deny balance. |
| server/src/__tests__/authz-company-access.test.ts | 19 | VALID_WITH_NOTES | V6 | Shadow-mode test title overstates ("logs"); env restored in finally. No edit. |
| server/src/__tests__/authz-existence-oracle-guard.test.ts | 2 | VALID | none | Static source guard over routes/; green. |
| server/src/__tests__/authz-secret-context.test.ts | 5 | VALID | none | Matches `buildActorSecretContext`. |
| server/src/__tests__/aws-secrets-manager-provider.test.ts | 18 | VALID_WITH_NOTES | V9 | Fake gateway injected via the provider's public seam; fetch mocked, env restored. Config duplication noted. |
| server/src/__tests__/better-auth.test.ts | 19 (17 + 2) | REWRITTEN | V7 | Added cookie-prefix sanitization and local_trusted rate-limit-off tests. Green. |
| server/src/__tests__/board-chat-route-feature-flag.test.ts | 5 | REWRITTEN | V4, V5 | Added `beforeEach(clearAllMocks)` to the disconnect describe. Green. |
| server/src/__tests__/board-claim.test.ts | 1 | VALID_WITH_NOTES | V7 | Real PG; happy path only. Not run (PG ENV). |
| server/src/__tests__/board-mutation-guard.test.ts | 10 | REWRITTEN | V2 | 7 widened `[200,204]` matchers tightened to `toBe(204)`. Green. |
| server/src/__tests__/body-limits.test.ts | 6 | VALID | none | Good boundary coverage (0, negative, fractional, MAX_VALUE). |
| server/src/__tests__/bootstrap-claim-routes.test.ts | 11 (8 with a 4-row each) | REWRITTEN | V6 | `it.each` rows converted to labelled objects so titles are readable. Green. |
| server/src/__tests__/budgets-service.test.ts | 7 | VALID_WITH_NOTES | V5 | 5 stub tests + 2 PG tests (PG not run). Positional select-queue stub is brittle. |
| server/src/__tests__/build-commit.test.ts | 6 (4 + 2) | REWRITTEN | V7 | Added invalid-env fallback and unreadable/garbage marker returns null. Green. |
| server/src/__tests__/build-version.test.ts | 6 | VALID | none | Includes null, empty, whitespace and read-failure paths. |
| server/src/__tests__/built-in-agent-routes.test.ts | 14 | REWRITTEN | V6 | Corrected a misleading test title (reset, not provision). Green. |

## 6 Per-test detail (non-clean tests)

| File | Test | Code | Finding | Action |
|---|---|---|---|---|
| board-mutation-guard | seven pass-through tests (safe methods, local implicit, board key, cloud tenant, trusted origin, trusted referer, MagicDNS forwarded host) | V2 | `expect([200,204]).toContain(status)` cannot distinguish pass-through from an unrelated 200 | Tightened to `toBe(204)` |
| bootstrap-claim-routes | rejects %s before opening the first-admin transaction | V6 | `%s` printed `[object Object]` | Rewritten with `$label` |
| built-in-agent-routes | denies agent actors from provisioning across company boundaries | V6 | Posts to `/reset` | Retitled |
| board-chat-route-feature-flag | kills the spawned subprocess when the client disconnects | V4 | `waitFor(spawn called)` could be satisfied by an earlier test's call | Added `clearAllMocks` |
| authz-company-access | logs only in shadow mode for responsible-user company access denials | V6 | Asserts only "does not throw"; nothing observes logging | Noted |
| attention-service | enriches, filters, paginates, snoozes, and ranks the decide-now feed | V3 | Real `Date.now()` and real service clock; UTC-midnight boundary and `deskBadgeCount` recomputation | Noted; recommend `attentionService(db, { now: () => now })` |
| attention-service | fixture-dated tests (2026-07-09) | V3 | Rely on the default clock for ageing; stable only while ranking ignores age | Noted |
| budgets-service | the three stub tests using `createDbStub` | V5 | Order-dependent select queue | Noted |
| board-claim | lets a signed-in user claim a local-board-only instance | V7 | Single happy-path test | Noted |

## 7 Evaluation and recommendations

- Product findings: none. No suspected production bug; no NEEDS_DECISION.
- Coverage gaps (not added, because they need the PG harness to verify):
  - board-claim: wrong code, wrong token, already-claimed, unauthenticated user.
  - attention-service: only the week-boundary test is clock-injected; convert the decide-now test to `{ now }` to remove the midnight window.
  - authz-company-access: assert the shadow log via a spy; add explicit "false" shadow case.
  - board-mutation-guard: a real-express cross-origin (`Origin: https://evil.example`) denial and a `PAPERCLIP_PUBLIC_URL` allow case.
- Maintenance: extract an `awsTestConfig()` helper in the AWS provider test; replace the positional select-queue stub in budgets-service with per-table responses.
- The t3-ci `unit` job does not run server tests; these 18 files gate only in t3-nightly.

## 8 Summary of activities

Files rewritten:
- auth-routes.test.ts: added missing authorization/negative/profile-read cases.
- better-auth.test.ts: added sanitization and local_trusted rate-limit cases.
- board-chat-route-feature-flag.test.ts: mock reset for the disconnect test.
- board-mutation-guard.test.ts: exact status assertions.
- bootstrap-claim-routes.test.ts: readable `it.each` titles.
- build-commit.test.ts: fallback and failure cases.
- built-in-agent-routes.test.ts: corrected title.

Deletions: none.

Commands (from repo root, one vitest process at a time):
- `npx vitest run server/src/__tests__/board-claim.test.ts`: 1 skipped, suite failed on the 20 s embedded-PG hook timeout (ENV; file unedited).
- `npx vitest run` on auth-routes, build-commit, better-auth, board-mutation-guard: build-commit initially failed on a string-literal typo in my own edit; fixed; the other three passed.
- `npx vitest run` on build-commit, bootstrap-claim-routes, built-in-agent-routes, board-chat-route-feature-flag, authz-existence-oracle-guard: pass.
- Final re-run of auth-routes + build-commit: 17 passed.

## 9 Approvals

- Test lead: ______________________  Date: __________
- Product owner: __________________  Date: __________
