# Test Summary Report: shard server-11 (IEEE 829)

## 1 Report identifier and scope

- Report id: server-11
- Project: `server` (vitest project `@paperclipai/server`)
- Suite: t3-nightly "slow-tests" audit against current `develop` (hard fork, no longer upstream)
- Files in shard: 15
- Test cases: 204 (66 + 138 across the other 14 files; `it.each` / `it.for` rows counted individually)
- Date: see git

## 2 Summary

All 15 files were read in full and checked against the production modules they exercise (`evidence-provider-git/minio/nas`, `execution-workspace-policy`, `execution-workspaces` service and routes, `heartbeat.cancelRun`, `export-fidelity`, `issues` routes). The rubric was V1 to V9.

No file asserts upstream-only behaviour, and no suite's subject has been removed. The defects found are quality defects, not stale-behaviour defects: weak assertions, state leaking between tests, cold-start timeouts, portability and one stale fixture value. They were fixed with minimal edits.

| Verdict | Count |
|---|---|
| VALID | 5 |
| VALID_WITH_NOTES | 3 |
| REWRITTEN | 7 |
| OBSOLETE_REMOVED | 0 |
| NEEDS_DECISION | 0 |

No suspected production bugs were found.

## 3 Variances (what could not be verified)

- Embedded Postgres does not start inside the hook budget on this Windows host. The `beforeAll` hooks carry explicit `20_000` or `30_000` ms limits, which override CLI `--hookTimeout`. The host was also loaded by concurrent audit agents. Classified ENV, not REAL. Affected files, all of which skip or time out in `beforeAll`:
  - `evidence-provider-routes`
  - `evidence-source-constraint`
  - `execution-lock-orphan-cleanup`
  - `execution-workspace-reopen`
  - `execution-workspace-runtime-lease-route`
  - `execution-workspaces-service` (58 of its 66 tests)
  - `export-fidelity`
- Edits to PG-backed files are therefore not dynamically verified. They are one-line, type-safe changes that were reviewed by reading the production code:
  - `execution-workspace-reopen`: stronger assertion.
  - `execution-workspaces-service`: fixture mode value, and the empty-tree SHA constant. The constant was verified manually with `git commit-tree` on this host.
- Several service tests are POSIX-assuming and could not be exercised here: `touch`, `rm -f`, `bash ./scripts/...` strings, `process.execPath` quoting inside a shell command, and git lock-file message text.
- `execution-workspace-runtime-control-conflict`, the "symlink" repair variant: `fs.symlinkSync` needs elevation on Windows (EPERM). It is now skipped only for that case; see section 8.
- Cold-start module transform on this host took 20 to 40 s for the first `createApp()` and tripped the 20 s and 30 s limits (ENV). Both route files now warm up in a hook with a 120 s budget.

## 4 Comprehensive assessment (defects by rubric code)

| Code | Count | Summary |
|---|---|---|
| V1 Validity | 1 | `execution-workspaces-service`: fixture `mode: "dedicated_worktree"` is not a mode that exists anywhere in the codebase (valid modes are `isolated_workspace`, `shared_workspace`, `operator_branch`, `adapter_managed`, `cloud_sandbox`). Fixed. |
| V2 Meaningful assertions | 6 | (a) minio/nas `toThrowError()` accepted any throw, including a TypeError; now pins the 422 `HttpError` (9 tests across the two files). (b) reopen "keeps access": `expect(firstIssueId).not.toBe(secondIssueId)` compared two random UUIDs and could never fail; replaced with a check that both issues are present. (c) control-conflict used `status >= 400` for failed-start paths (2 tests); pinned to 500. (d) `express5-auth-wildcard` builds its own route and tests the Express/path-to-regexp contract, not `app.ts` (noted, not changed). |
| V3 Determinism | 4 | Cold-start timeouts in route tests (fixed). `lease-route` "competing issue races the owner" has no ordering guarantee between two HTTP requests (noted). Service test "runtime service starts before the locked update" uses a fixed 250 ms sleep (noted). The 6,176-row volume test and git-lock-message tests are timing/version sensitive (noted). |
| V4 Isolation | 2 | `execution-workspaces-routes`: `vi.clearAllMocks()` keeps implementations, so `fenceClosedWorkspaceDestruction.mockImplementation` leaked across tests (fixed with `mockReset` in `beforeEach`). `control-conflict`: `mockStartRuntimeServices.mockRejectedValue` leaked into later tests (fixed). |
| V5 Mock fidelity | 3 notes | `external-object-routes`, `execution-workspaces-routes` and `control-conflict` replace the whole `../services/index.js` barrel with a hand-built factory, so a new export used by the routes surfaces only as a runtime error (the "hand-mocked @paperclipai/db" failure class). `lease-route` is better: it imports the real lease service. Recommend `importOriginal` plus overrides. Not changed because the route modules only read a fixed, small set of exports and the tests pass. |
| V6 Clarity | 1 note | `execution-workspaces-service` is 4,699 lines with heavy per-test fixture duplication. |
| V7 Coverage | 3 gaps | See section 7. |
| V8 Portability | 5 | `/dev/null` in `hash-object` (fixed with a constant); symlink EPERM (guarded); `touch`/`rm -f` cleanup hooks, `bash` command strings, and POSIX `/tmp/...` fixture cwd strings (noted). |
| V9 Maintainability | 2 notes | `PAP` company prefix and company/project/workspace seeding repeated about 30 times in the service file; ad-hoc private fingerprint helper duplicates production logic (intentional, to independently verify). |

## 5 Summary of results

| Path | Tests | Verdict | Defects | Action |
|---|---|---|---|---|
| server/src/__tests__/evidence-provider-git.test.ts | 26 | VALID | none | None. Ran: 26 pass. |
| server/src/__tests__/evidence-provider-minio.test.ts | 10 | REWRITTEN | V2 | 6 bare `toThrowError()` pinned to `{status: 422}`. Ran: pass. |
| server/src/__tests__/evidence-provider-nas.test.ts | 7 | REWRITTEN | V2 | 3 bare `toThrowError()` pinned to `{status: 422}`. Ran: pass. |
| server/src/__tests__/evidence-provider-routes.test.ts | 15 | VALID_WITH_NOTES | V4, V9 | None. PG-backed, not runnable here (ENV). Race test asserts both outcomes. |
| server/src/__tests__/evidence-source-constraint.test.ts | 4 | VALID | none | None. PG-backed, not runnable here (ENV). Asserts SQLSTATE rather than message. |
| server/src/__tests__/execution-lock-orphan-cleanup.test.ts | 5 | VALID | none | None. PG-backed, not runnable here (ENV). Includes a cross-tenant check. |
| server/src/__tests__/execution-workspace-policy.test.ts | 19 | VALID | none | None. Ran: pass. |
| server/src/__tests__/execution-workspace-reopen.test.ts | 9 | REWRITTEN | V2 | Replaced a tautological UUID inequality with a check that both issues exist. PG-backed, not run (ENV). |
| server/src/__tests__/execution-workspace-runtime-control-conflict.test.ts | 16 | REWRITTEN | V2, V3, V4, V8 | See section 8. Ran: 15 pass, 1 skipped (Windows symlink). |
| server/src/__tests__/execution-workspace-runtime-lease-route.test.ts | 4 | VALID_WITH_NOTES | V3 | None. PG-backed, not run (ENV). Concurrent-race test has no ordering guarantee. |
| server/src/__tests__/execution-workspaces-routes.test.ts | 12 | REWRITTEN | V4, V5 | Reset leaking mock implementations in `beforeEach`. Ran: 12 pass. |
| server/src/__tests__/execution-workspaces-service.test.ts | 66 (8 non-PG, 58 PG) | REWRITTEN | V1, V8 | Stale fixture mode fixed; POSIX `/dev/null` removed. PG part not run (ENV). |
| server/src/__tests__/export-fidelity.test.ts | 2 | VALID | none | None. PG-backed, not run (ENV). |
| server/src/__tests__/express5-auth-wildcard.test.ts | 1 | VALID_WITH_NOTES | V2 | None. Ran: pass. Tests the framework route syntax in isolation. |
| server/src/__tests__/external-object-routes.test.ts | 8 | REWRITTEN | V3, V5 | Warm-up hook budget raised to 120 s. Ran: 8 pass. |

## 6 Per-test detail (tests that are not clean)

| File | Test | Code | Finding | Action |
|---|---|---|---|---|
| evidence-provider-minio | refuses declared image/png / application/pdf / image/gif / non-allowlisted type / disguised text-plain / msword-PDF | V2 | `toThrowError()` passed on any throw. | Pinned to `HttpError` status 422. |
| evidence-provider-nas | refuses a url / empty path / relative path | V2 | Same. | Pinned to 422. |
| execution-workspace-reopen | keeps access for every issue that shares the reopened row | V2 | `expect(a).not.toBe(b)` on two random UUIDs cannot fail. | Replaced with an id-set equality over the issue rows. |
| execution-workspace-runtime-control-conflict | returns a stable 409 while a managed control is genuinely live | V3 | First test paid the cold route-module transform (20 s limit exceeded, ENV). | Added `beforeAll` warm-up with a 120 s budget. |
| execution-workspace-runtime-control-conflict | tears down residue ... when a start fails | V2, V4 | `status >= 400` accepted any error; the rejection set here leaked to later tests. | Pinned to 500; `mockStartRuntimeServices.mockReset()` in `beforeEach`. |
| execution-workspace-runtime-control-conflict | reconciles once when the operation's own time budget fails a start | V2 | `status >= 400` weak. | Pinned to 500. |
| execution-workspace-runtime-control-conflict | rejects a symlink repair manifest source... | V8 | `fs.symlinkSync` fails with EPERM on non-elevated Windows. | Skip only on win32 + EPERM; any other error rethrown. |
| execution-workspace-runtime-control-conflict | fails repair at the exact seed phase | note | Asserts the 500 `Internal server error` body, so it pins an unhandled-error shape rather than a typed error. | Not changed; see section 7. |
| execution-workspaces-routes | destroys the reusable sandbox leases / keeps the reusable sandbox leases | V4 | `mockImplementation` on the fence leaked via `clearAllMocks`. | `mockReset` on fence, archive and readiness mocks in `beforeEach`. |
| execution-workspace-runtime-lease-route | blocks a competing issue that races the owner concurrently | V3 | Two parallel requests; owner is only "first" by supertest start order, so the owner could in principle lose the claim. | Not changed (would alter purpose); documented. |
| execution-workspaces-service | serializes the verified HTTPS URL as canonical... | V1 | `mode: "dedicated_worktree"` does not exist in the codebase. | Changed to `isolated_workspace`. |
| execution-workspaces-service | reconciles forward when the checked-out branch ref does not resolve either | V8 | `git hash-object -t tree /dev/null` is POSIX-only. | Use the well-known empty-tree SHA `4b825dc...` (verified with `git commit-tree`). |
| execution-workspaces-service | archives terminal workspaces without running configured cleanup hooks | V8, V2 | `touch <marker>` cleanup command; on a host without `touch` the "marker absent" assertion would pass vacuously. | Noted only. |
| execution-workspaces-service | refuses cleanup when the worktree changes after delivery assessment | V8 | `rm -f late-work.txt` cleanup command. | Noted only. |
| execution-workspaces-service | holds Git index and ref locks across terminal cleanup | V3 | Asserts git's lock-file error text (`index.lock`, `HEAD.lock`), which is git-version dependent. | Noted only. |
| execution-workspaces-service | rejects branch reconciliation when a runtime service starts before the locked update | V3 | Fixed `setTimeout(250)` to let the reconcile call reach the row lock. If it is slower, the test still passes without exercising the lock. | Noted only. |
| execution-workspaces-service | returns full details at the observed volume ... | V3 | 6,176 inserts with a 30 s limit and a 12 MB JSON size bound; load sensitive. | Noted only. |
| express5-auth-wildcard | matches auth sub-paths without matching unrelated API paths | V2 | Builds its own app and route, so it cannot detect `app.ts` regressing; the production route string `/api/auth/{*authPath}` is currently identical. | Noted only. |

## 7 Evaluation and recommendations

Product findings: none. Nothing here looked like a production bug or needed a product decision.

Coverage gaps (not added; none were cheap and safe to add blind):

1. `external-object-routes` always mocks `enableExternalObjects: true`. The route's gate (`instanceSettings.getExperimental().enableExternalObjects === true`, `routes/issues.ts`) has no negative-path test, and the flag-off response is unasserted.
2. `evidence-provider-git`: no test for the 40-character hash boundary or a hash over 40 characters. No test for `matchesIssueBranch` with regex metacharacters in the identifier, although the code escapes them.
3. Repair failure at the seed phase is asserted as a generic 500 (`Internal server error`). A typed error would be a better contract, so this is worth a product look.

Recommendations:

- Split `execution-workspaces-service.test.ts` (4,699 lines) by concern: reaper/sweep, reopen fences, branch reconciliation, listing/overview. Extract seed helpers (company, project, workspace, issue) to cut roughly 1,500 lines of duplication.
- Replace hand-built `../services/index.js` mock factories with `importOriginal` plus overrides.
- Raise or externalise the embedded-PG `beforeAll` limits (20 to 30 s) so Windows and loaded-CI runs do not time out; the shared helper `helpers/embedded-postgres.ts` is the right place (out of scope for this shard).
- Make the cleanup-hook tests portable by using `node -e` commands, so "hook must not run" cannot pass vacuously.

## 8 Summary of activities

Files rewritten (test-only edits):

- `evidence-provider-minio.test.ts`: pinned the error contract to a 422 `HttpError`.
- `evidence-provider-nas.test.ts`: same.
- `execution-workspaces-routes.test.ts`: reset mocks that carry implementations across tests, added to `beforeEach`.
- `execution-workspace-runtime-control-conflict.test.ts`:
  - Added a `beforeAll` warm-up (120 s).
  - Added `mockStartRuntimeServices.mockReset()` in `beforeEach`.
  - Pinned two weak `>= 400` status checks to 500.
  - Changed the repair-variant loop from `it.each` to `it.for`, so the test context is available for the Windows EPERM symlink skip.
- `execution-workspace-reopen.test.ts`: replaced a tautological assertion.
- `execution-workspaces-service.test.ts`: stale fixture mode and portable empty tree.
- `external-object-routes.test.ts`: warm-up hook budget 30 s to 120 s.

Deletions: none.

Commands run (from the repo root, one vitest process at a time):

1. `npx vitest run evidence-provider-minio evidence-provider-nas`: 17 passed.
2. `npx vitest run external-object-routes express5-auth-wildcard evidence-provider-git`: git and express5 passed; external-object-routes hook timed out at 30 s (ENV, cold transform). After the fix: `external-object-routes` 8 passed.
3. `npx vitest run execution-workspaces-routes execution-workspace-policy`: 31 passed.
4. `npx vitest run execution-workspace-runtime-control-conflict`:
   - First run: 2 failures. The 20 s cold-start timeout (ENV) and the Windows symlink EPERM (ENV).
   - With `--testTimeout=120000`: all passed, which confirmed ENV.
   - After the fixes: 15 passed, 1 skipped (symlink on Windows).
5. `npx vitest run execution-workspace-reopen evidence-source-constraint`: embedded Postgres `beforeAll` timed out at 20 s (ENV). A second attempt with CLI timeouts had the same result, because explicit hook limits override the CLI value. The 13 tests skipped; no REAL failure observed.
6. Manual check: `git commit-tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904` succeeds, confirming the empty-tree constant.

## 9 Approvals

- Prepared by: ______________________  Date: ____________
- Reviewed by: ______________________  Date: ____________
- Approved by: ______________________  Date: ____________
