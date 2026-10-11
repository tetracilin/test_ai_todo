# Test Summary Report - shard server-25 (IEEE 829)

## 1. Report identifier and scope

- Report id: server-25
- Project: `@paperclipai/server` (vitest project `server`)
- Branch/date: see git
- Files: 16, all under `server/src/__tests__/`
- Test cases: 241 (240 `it` declarations; `secrets-routes.test.ts` has one `it.each` that expands to 2 cases)
- Rubric: ISO/IEC/IEEE 29119 and ISTQB principles, coded V1-V9 (validity, meaningful assertions, determinism, isolation, mock fidelity, clarity, coverage balance, portability, maintainability)

## 2. Summary

Every file was read in full and checked against the production sources it exercises (`run-continuations`, `run-liveness`, `run-secret-redaction`, `runtime-api`, `environment-runtime`, `sandbox-orphan-cleanup-spool`, `sandbox-provider-runtime`, `routes/scheduling`, `services/scheduling`, `routes/secrets`, `services/secrets`, `services/routines`, `secrets/provider-registry`).

No test asserts upstream-only behaviour. The subjects all exist in the fork and the assertions match current code. Examples: the fork-owned `hermes_gateway` adapter type with `userSecretMediation: "owner_scoped"` is accepted by `secrets.ts`, and the built-in sandbox provider list is `["fake"]` as `sandbox-provider-runtime.ts` implements it.

Headline verdicts:

| Verdict | Files |
|---|---|
| VALID | 7 |
| VALID_WITH_NOTES | 7 |
| REWRITTEN | 2 |
| OBSOLETE_REMOVED | 0 |
| NEEDS_DECISION | 0 |

Two small targeted rewrites were made, plus one product finding (Windows directory fsync in the orphan spool, section 7).

## 3. Variances (what could not be verified)

- Embedded Postgres does not start on this Windows host. The `beforeAll` hook times out (30 s in `secrets-service-dangling-user-secret`, 20 s in `routines-service`), so every embedded-PG test is skipped here. Classification: ENV. Affected files, 6 files and 129 tests:
  - routines-service (63)
  - scheduling-service (13)
  - secret-proposals-routes (25)
  - secrets-routes-claude-oauth-service (19)
  - secrets-service-dangling-user-secret (3)
  - secrets-service-user-secret-owner-scoped (6)
- Findings for those files come from static review against source. The only edits to them (`routines-service`) are mechanical and were confirmed by source reading plus a collection run. All 63 tests were collected, so there is no syntax or type error, but none were executed. Nightly (Linux) is the authoritative run.
- `sandbox-orphan-cleanup-spool.test.ts`: 2 of 6 tests fail on Windows (ENV). `writeFileDurable` opens the directory with `fs.open(dir, "r")` to fsync it, which fails on Windows. `append()` therefore returns `false` even though the record file was already renamed into place. See finding P1.

## 4. Comprehensive assessment (cross-cutting defects)

| Code | Count | Detail |
|---|---|---|
| V1 | 0 | No stale or upstream-only assertions found. |
| V2 | 4 | `routines-service` tautology `expect(agentId).not.toBe(otherAgentId)` (two random UUIDs), fixed. `routines-service` github_hmac invalid-signature test used bare `.rejects.toThrow()`, fixed to assert 401. `secrets-routes` agent catalog test did not check the field stripping that the board test checks, fixed. `secrets-routes-claude-oauth-service` "keeps the token out of every activity detail" passes vacuously if the activity log is empty, and the "another company" test asserts only `instanceof HttpError`; both are documented, not edited (cannot run here). |
| V3 | 5 | Sleep-based concurrency choreography in `secret-proposals-routes`: 100 ms and 150 ms sleeps and an 80x25 ms poll loop, backed by `pg_sleep(1)` triggers, so it is safe against false failures but is a timing heuristic. `routines-service` uses short in-fake sleeps of 10 ms and 25 ms, which are harmless. |
| V4 | 0 | Env vars (`PAPERCLIP_SECRETS_MASTER_KEY_FILE`, `PAPERCLIP_SECRETS_PROVIDER`, `PAPERCLIP_SECRETS_MASTER_KEY`) and temp dirs are restored. `vi.restoreAllMocks` and `mockReset` are used. |
| V5 | 1 | `routines-service` "uses the configured provider" hand-builds a full secret-provider stand-in. It tracks the interface at compile time, but a spy wrapping the real provider is more rot-resistant. Noted. Route tests mock `services/index.js` at the service boundary (SUT is the route), which is acceptable. |
| V6 | 2 | `scheduling-service` "rejects scheduling lookups for an issue in a different company" also asserts a resolve-to-null case (two reasons to fail). `sandbox-capability-contract` uses snake_case `test_*` names; they are descriptive and left as is. |
| V7 | 3 | Gaps: `run-continuations` has no case for `ready`/`completed` states beyond `advanced`; `runtime-api` has no IPv6-bracket or empty-input case; `scheduling-routes` has no 2xx happy path for create/update/delete routine (only denial paths). Not added (not cheap or clear). |
| V8 | 3 | `sandbox-orphan-cleanup-spool` (directory fsync), `secret-provider-registry` (0644 mode check is POSIX-specific, but it passed on Windows), and the `sh`/POSIX assumptions generally. Noted. |
| V9 | 2 | Duplicated seed and cleanup boilerplate across the `secrets-service-*` and claude-oauth files. In `routines-service`, repeated "live run" fixture blocks (about 8 copies). Noted, not refactored (drive-by). |

## 5. Summary of results

| File | Tests | Verdict | Defect codes | Action taken |
|---|---|---|---|---|
| server/src/__tests__/routines-service.test.ts | 63 | REWRITTEN | V2, V5, V9 | Removed tautological UUID assertion; tightened github_hmac rejection to status 401 |
| server/src/__tests__/run-continuations.test.ts | 5 | VALID | V7 (minor) | None |
| server/src/__tests__/run-liveness.test.ts | 14 | VALID | V9 (stray blank line) | None |
| server/src/__tests__/run-secret-redaction.test.ts | 5 | VALID | none | None |
| server/src/__tests__/runtime-api.test.ts | 6 | VALID | V7 (minor) | None |
| server/src/__tests__/sandbox-capability-contract.test.ts | 16 | VALID_WITH_NOTES | V6 (naming style) | None |
| server/src/__tests__/sandbox-orphan-cleanup-spool.test.ts | 6 | VALID_WITH_NOTES | V8 | None; 2 tests fail on Windows (ENV), see P1 |
| server/src/__tests__/sandbox-provider-runtime.test.ts | 9 | VALID | none | None |
| server/src/__tests__/scheduling-routes.test.ts | 9 | VALID_WITH_NOTES | V7 | None |
| server/src/__tests__/scheduling-service.test.ts | 13 | VALID_WITH_NOTES | V6 | None (embedded PG not runnable here) |
| server/src/__tests__/secret-proposals-routes.test.ts | 25 | VALID_WITH_NOTES | V3 | None (embedded PG not runnable here) |
| server/src/__tests__/secret-provider-registry.test.ts | 2 | VALID_WITH_NOTES | V8 | None |
| server/src/__tests__/secrets-routes-claude-oauth-service.test.ts | 19 | VALID_WITH_NOTES | V2, V9 | None (embedded PG not runnable here) |
| server/src/__tests__/secrets-routes.test.ts | 40 (39 `it` + `it.each` x2) | REWRITTEN | V2 | Agent catalog test now also asserts `provider` and `referenceCount` are stripped |
| server/src/__tests__/secrets-service-dangling-user-secret.test.ts | 3 | VALID | none | None |
| server/src/__tests__/secrets-service-user-secret-owner-scoped.test.ts | 6 | VALID | V9 | None |

## 6. Per-test detail (tests that are not clean)

| File | Test | Code | Finding | Action |
|---|---|---|---|---|
| routines-service | fires for another agent running a child of the routine issue | V2 | `expect(agentId).not.toBe(otherAgentId)` compares two `randomUUID()` values and cannot fail; `agentId` was otherwise unused | Removed the assertion and the unused destructure |
| routines-service | rejects invalid signature for github_hmac signing mode | V2 | Bare `.rejects.toThrow()` would pass on any error (e.g. a 500). Source (`routines.ts` ~2908) throws `unauthorized()` (401) | Now `.rejects.toMatchObject({ status: 401 })` |
| routines-service | uses the configured provider for generated webhook trigger secrets | V5 | Hand-built full provider stand-in | Noted only |
| routines-service | clears transient / moves transient failures; coalesce tests | V9 | Large duplicated live-run fixtures | Noted only |
| secrets-routes | returns id/name/key/status only for agent callers in the same company | V2 | Did not assert stripped fields (board test does); a leak to agents would pass | Added `not.toHaveProperty("provider")` and `not.toHaveProperty("referenceCount")` (passes) |
| secrets-routes | surfaces update-route externalRef retarget rejection without logging raw refs | V2 | Final `JSON.stringify(mock.calls)` assertion is redundant once `mockLogActivity` is `not.toHaveBeenCalled()` | Noted only |
| sandbox-orphan-cleanup-spool | persists a record and loads it back after a restart | V8 | `append()` returns false on Windows (directory fsync); fails with ENV | Noted, see P1 |
| sandbox-orphan-cleanup-spool | persists a record with a null provider lease id | V8 | Same as above | Noted, see P1 |
| secret-proposals-routes | rechecks expiry after acquiring the proposal approval lock | V3 | 100 ms sleep is meant to let the HTTP request reach the row lock. If it has not, the test still passes (409 either way), so it can lose its race coverage but not flake | Noted only |
| secret-proposals-routes | serializes binding creation with concurrent dependency rejection; holds the org graph stable until binding approval commits | V3 | 150 ms "has not finished yet" negative assertions backed by 1 s trigger sleeps and a bounded poll loop | Noted only |
| scheduling-service | rejects scheduling lookups for an issue in a different company | V6 | Name says "rejects" but also asserts a null resolve for the owning company | Noted only |
| secrets-routes-claude-oauth-service | confirmed_rotation on a value from another company returns not-found | V2 | Asserts only `instanceof HttpError`, not status 404 | Noted, not edited (cannot run here) |
| secrets-routes-claude-oauth-service | keeps the token out of every activity detail | V2 | Passes vacuously if the activity log is empty; no assertion that entries exist | Noted, not edited (cannot run here) |

## 7. Evaluation and recommendations

Product findings:

- P1 (portability): `sandbox-orphan-cleanup-spool.ts` `writeFileDurable` fsyncs the directory via `fs.open(dir, "r")`. On Windows this throws, so `append()` returns `false` and callers treat a durably written record as a failed spool. Linux (kmv8) is unaffected. Recommend deciding whether Windows dev hosts matter. If so, tolerate EISDIR/EPERM/EACCES on the directory sync only. The test is correct as written and should not be bent.
- P2 (CI gap): all 129 DB-backed tests in this shard only run in t3-nightly, since embedded PG is flaky or unavailable on Windows and these are not in the t3-ci unit groups. Consistent with the known note that green t3-ci does not exercise server suites.

Recommended follow-ups (not done, out of scope for a minimal diff):

- Tighten the two claude-oauth assertions (status 404, and non-empty activity log) once verified on Linux.
- Extract a shared seed and cleanup helper for the `secrets-service-*` files and the routines live-run fixtures (V9).
- Replace the hand-built provider in the routines webhook-secret test with a spy that delegates to the real provider (V5).
- Add scheduling-routes happy-path tests for routine create/update/delete (V7).
- Replace the choreography sleeps in `secret-proposals-routes` with explicit lock-wait polling (`waitForBlockedForUpdate` already exists) where practical (V3).

## 8. Summary of activities

Files rewritten:

- `server/src/__tests__/routines-service.test.ts`: removed the always-true UUID inequality assertion and its unused variable; strengthened the invalid-HMAC test to assert HTTP 401.
- `server/src/__tests__/secrets-routes.test.ts`: agent catalog test now asserts field stripping.

Deletions: none.

Commands run and outcomes:

- `pnpm --filter @paperclipai/plugin-sdk ensure-build-deps`: ok.
- `npx vitest run server/src/__tests__/secrets-service-dangling-user-secret.test.ts`: ENV, embedded PG `beforeAll` timeout (3 skipped).
- One `npx vitest run` over secrets-routes, run-continuations, run-liveness, run-secret-redaction, runtime-api, sandbox-capability-contract, sandbox-orphan-cleanup-spool, sandbox-provider-runtime, scheduling-routes, secret-provider-registry: 110 passed, 2 failed (both in sandbox-orphan-cleanup-spool, ENV on Windows, P1). The edited `secrets-routes` passed (40/40).
- `npx vitest run server/src/__tests__/routines-service.test.ts`: all 63 tests collected (the edit compiles), 63 skipped because the embedded PG hook timed out (ENV).

## 9. Approvals

- Test lead: ______________________  Date: ____________
- Engineering reviewer: ______________________  Date: ____________
