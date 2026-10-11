# Test Summary Report: server-12 (IEEE 829)

## 1 Report identifier and scope
- Shard: server-12; project: server (`server/src/__tests__`); 20 files; 230 test cases after edits (194 before, +36 added, 0 removed; it.each/table expansions counted individually); date: see git.
- Method: every file read in full and checked against its production source (`routes/health.ts`, `routes/folders.ts`, `routes/file-resources.ts`, `services/workspace-file-resources.ts`, `services/feedback*.ts`, `services/feedback-share-client.ts`, `services/heartbeat.ts`, `services/external-objects.ts`, `first-admin-claim.ts`, `app.ts`, `scripts/check-forbidden-tokens.mjs`, grok-local `skills.ts`).

## 2 Summary
All 20 subjects still exist in the fork and assertions match current behaviour; no upstream-only stale defaults were found (the `/api/health` `commit` field pipeline contract is covered and correct). Main defects were isolation leaks (temp dirs, global stubs), a hand-built adapter registry mock, a widened status matcher, a silent `return` posing as a pass, platform-guard gaps, and thin negative-path coverage on small pure functions and routes. One product finding: feedback trace export defaults to the upstream telemetry host.
Verdicts: VALID 2, VALID_WITH_NOTES 6, REWRITTEN 11, OBSOLETE_REMOVED 0, NEEDS_DECISION 1.

## 3 Variances
- Windows host with heavy concurrent load: embedded Postgres starts, but not within the hard-coded 20 s `beforeAll` timeouts (ENV). Result: `external-objects-service` (12 PG tests), `folders-service` (16 PG tests), `heartbeat-accepted-plan-workspace-refresh` (5), `first-admin-claim` (2), and the other PG suites (`feedback-service`, `heartbeat-active-run-output-watchdog`, `heartbeat-archived-company-guard`) could not run here. `file-resources.test.ts` has a 60 s hook and did start; it passed.
- The edit to `heartbeat-accepted-plan-workspace-refresh.test.ts` (partial adapter-registry mock using `importOriginal`) is therefore NOT dynamically verified. It uses the same pattern as the watchdog test in this shard. Re-verify in t3-nightly.
- The `external-objects-service` edit (a `fetch` call-count assertion) is in the non-PG half and passed (14 passed, 12 PG skipped).
- `forbidden-tokens.test.ts` fails to load on this checkout both before and after my edit (ENV): the script `scripts/check-forbidden-tokens.mjs` is checked out with CRLF line endings and a shebang, which makes the vite transform throw "SyntaxError: Invalid or unexpected token". I verified the edited test (6/6 pass) against a temporary LF copy of the script, since removed. Real CI (LF) is unaffected.
- Symlink creation needs privilege on Windows (EPERM). Five `file-resources` tests need it; they now skip visibly on such hosts (6 skipped = 5 symlink + 1 POSIX-only FIFO).
- Run commands were executed with the machine under load from sibling audit agents; durations are not representative.

## 4 Comprehensive assessment
- V1 validity: 0 defects. Fork-owned items checked: `/api/health` returns `commit` on redacted and full bodies (pipeline contract), grok-local skill detail text matches `skills.ts`, `cloud` metadata still exists in the fork (`cloud-instance.ts`).
- V2 meaningful assertions: 3. Widened `[403,422]` status matcher (file-resources); fetch mock asserting inside the callback with no call-count guard (external-objects token test); fabricated `unreapedChildCount: 0` metric printed by the git-scan load test (measures nothing).
- V3 determinism: 1 note. `file-resources-git-scan-load` asserts a wall-clock health p99 < 250 ms under a 500-request burst; sound on CI, may flake on a loaded host. Not changed (weakening forbidden).
- V4 isolation: 4. `file-resources` never removed its temp workspaces; `health.test.ts` leaked 4 temp dirs; `feedback-share-client` left `fetch` globally stubbed (`restoreAllMocks` does not undo `stubGlobal`); `health-dev-server-token` restored env by hand (works, now plus `unstubAllEnvs` for new tests).
- V5 mock fidelity: 2. `heartbeat-accepted-plan-workspace-refresh` replaced the whole adapter registry with a four-key stand-in (the exact failure class seen in past incidents); `health.test.ts` mocked `dev-server-status` without its real exports (missing `writeDevServerRestartRequest`). Both now spread `importOriginal`. Notes only: the watchdog test hand-mocks `../telemetry.ts` with `getTelemetryClient` only (all current consumers use only that); several health tests hand-build Drizzle `select` chains whose call order is positional (brittle but documented).
- V6 clarity: 1. `folders-service` mixed pure slug-schema asserts inside an embedded-PG test, so they were skipped wherever PG is unsupported.
- V7 coverage balance: 8 gaps (6 closed by new tests, see section 6); open gaps in section 7.
- V8 portability: 2. A silent `if (win32) return` made the FIFO test a vacuous pass; symlink tests had no guard. Both fixed with `skipIf`.
- V9 maintainability: 3 notes. The accepted-plan test repeats ~50 lines of seeding in four tests; `health.test.ts` repeats near-identical db/app setup in five tests; the watchdog tests carry upstream ticket ids (KIV-xxxx) and a "dotta" path fixture appears in `feedback-service`.

## 5 Summary of results
| path | tests (after) | verdict | defect codes | action taken |
|---|---|---|---|---|
| server/src/__tests__/external-objects-service.test.ts | 26 (14 run here, 12 PG env-skipped) | REWRITTEN | V2 | added `fetch` call-count assertion to the token test; no other defects |
| server/src/__tests__/feedback-flush-controller.test.ts | 5 (was 3) | REWRITTEN | V7 | added top-level `ECONNREFUSED` code, other-code and non-error-input cases |
| server/src/__tests__/feedback-service.test.ts | 14 | VALID_WITH_NOTES | V9 note | none; PG-only, not runnable here; destination `paperclip_labs_feedback_v1` is production-defined |
| server/src/__tests__/feedback-share-client.test.ts | 5 (was 2) | NEEDS_DECISION | V4, V7, product | added `unstubAllGlobals`, custom-url/no-token, failed-upload, key-fallback tests; default upstream telemetry URL asserted as-is (see section 7) |
| server/src/__tests__/file-resources-git-scan-load.test.ts | 4 | REWRITTEN | V2, V3 note | removed fabricated `unreapedChildCount` metric |
| server/src/__tests__/file-resources.test.ts | 35 (29 pass, 6 skipped on Windows) | REWRITTEN | V2, V4, V8 | temp-root cleanup; exact status+code per rejected path; `skipIf` for FIFO and 5 symlink tests; simplified convoluted write |
| server/src/__tests__/first-admin-claim.test.ts | 2 | VALID_WITH_NOTES | V7 | none; no concurrent-claim test despite the table lock being the point of the function; not runnable here |
| server/src/__tests__/folders-routes.test.ts | 5 (was 1) | REWRITTEN | V7 | added folder-reorder route + activity log, 404, invalid body (400), cross-company (403) |
| server/src/__tests__/folders-service.test.ts | 22 (6 pure run here; 16 PG env-skipped) | REWRITTEN | V6, V7 | moved slug-schema asserts into a PG-independent describe and extended them |
| server/src/__tests__/forbidden-tokens.test.ts | 6 (was 4) | REWRITTEN | V2, V7 | token-non-leak assertion; empty-token and no-match cases; ENV load failure on CRLF checkout noted |
| server/src/__tests__/git-credentials.test.ts | 23 | VALID | none | none (real git credential-helper tests; token never in argv; good negative cases) |
| server/src/__tests__/grok-local-skill-sync.test.ts | 2 | VALID_WITH_NOTES | V7 | none; unsupported-state / persistent-sync paths not covered |
| server/src/__tests__/health-dev-server-token.test.ts | 6 (was 3) | REWRITTEN | V7 | added wrong/missing token, 404 no-supervisor, 409 not-required cases |
| server/src/__tests__/health-workspace-readiness.test.ts | 5 | VALID | none | none |
| server/src/__tests__/health.test.ts | 17 | REWRITTEN | V4, V5, V9 note | temp dir cleanup; `importOriginal` partial mock; removed dead import |
| server/src/__tests__/heartbeat-accepted-plan-workspace-refresh.test.ts | 5 | REWRITTEN | V5, V9 note | adapter registry mock now spreads `importOriginal` (unverified here, PG env) |
| server/src/__tests__/heartbeat-active-run-output-watchdog.test.ts | 18 | VALID_WITH_NOTES | V5 note, V9 note | none; PG-only; real adapters spread via `importActual`; bounded polling only in teardown |
| server/src/__tests__/heartbeat-agent-session-message.test.ts | 4 | VALID_WITH_NOTES | V7, V9 | none; thin db stub is positional; no case for non-actionable source or invalid agentMessage shape |
| server/src/__tests__/heartbeat-archived-company-guard.test.ts | 8 | VALID_WITH_NOTES | V7 | none; PG-only; `paused`/`suspended` company states not covered, only `archived` |
| server/src/__tests__/heartbeat-auto-checkout.test.ts | 18 (was 2) | REWRITTEN | V7 | table tests for every branch of `shouldAutoCheckoutIssueForWake` |

## 6 Per-test detail (tests that are not clean)
| file | test name | code | finding | action |
|---|---|---|---|---|
| external-objects-service | uses a configured token without storing it in the resolved snapshot | V2 | assertion on the Authorization header lived inside the fetch stub; with no call-count guard it would never run if fetch were skipped | added `toHaveBeenCalledTimes(1)` |
| feedback-flush-controller | (suite) | V7 | only wrapped-cause and unrelated-message cases | added 2 tests |
| feedback-share-client | (suite) | V4 | `stubGlobal("fetch")` never unstubbed | `vi.unstubAllGlobals()` in afterEach |
| feedback-share-client | defaults to telemetry.paperclip.ing when no backend url is configured | product | asserts current default which sends opted-in feedback to the upstream project's host | left as-is; NEEDS_DECISION |
| feedback-share-client | (suite) | V7 | no failure path | added custom-url/no-auth, failed upload (detail and HTTP-status message), objectKey fallback tests |
| file-resources-git-scan-load | keeps 500 cross-actor/cross-issue requests globally bounded... | V2 | logged `unreapedChildCount: 0` is a constant, not a measurement | removed |
| file-resources-git-scan-load | same | V3 note | wall-clock p99 < 250 ms | noted, unchanged |
| file-resources | resolves and reads a project file without exposing absolute paths | V2/V9 | write-then-catch-ENOENT-then-mkdir dance | mkdir then write |
| file-resources | rejects denied paths, non-regular files, oversized text, binary, and HTML... | V2 | `expect([403, 422]).toContain(status)` accepts the wrong failure mode for each path | per-path exact status and error code (.git 403 denied_path_segment; folder 422 not_regular_file; big.txt 422 too_large; index.html 422 unsupported_content; blob.bin 422) |
| file-resources | holds download concurrency slots until the file stream completes | V8 | `if (win32) return` reports a pass without running | `it.skipIf(win32)` |
| file-resources | 5 tests creating symlinks | V8 | EPERM on unprivileged Windows | `skipIf(!symlinksSupported)` via one-time probe |
| file-resources | (suite) | V4 | temp workspaces never removed | tracked and removed in afterAll |
| folders-routes | (suite) | V7 | single happy-path test | +4 tests |
| folders-service | rejects invalid slugs, cycles, and folders deeper than four levels | V6 | pure zod assertions hidden inside a PG test | moved to a PG-free describe; test renamed to cycles and depth |
| forbidden-tokens | reports matches without leaking which token was searched | V2 | name promised non-leak but nothing asserted it | assert no error output contains either token |
| forbidden-tokens | (suite) | V7 | no empty-token or clean-scan path | +2 tests |
| health | (module mock) | V5 | factory omitted real exports | `importOriginal` spread |
| health | backup tests (4) | V4 | `mkdtempSync` dirs leaked | `makeTempDir` helper plus afterEach cleanup |
| health-dev-server-token | (suite) | V7 | only token-accepted and restart-ok paths | +3 tests |
| heartbeat-accepted-plan-workspace-refresh | (module mock) | V5 | hand-built registry stand-in | `importOriginal` spread |
| heartbeat-active-run-output-watchdog | (module mock) | V5 note | `../telemetry.ts` mock exposes `getTelemetryClient` only | noted; matches the only consumer |
| heartbeat-auto-checkout | (suite) | V7 | 2 of ~12 branches covered | +16 expansions |
| first-admin-claim | (suite) | V7 | no concurrent claim test | recorded as gap |
| heartbeat-archived-company-guard | (suite) | V7 | only `archived` status exercised | recorded as gap |

## 7 Evaluation and recommendations
- PRODUCT FINDING (decision needed): `createFeedbackTraceShareClientFromConfig` falls back to `https://telemetry.paperclip.ing` when `PAPERCLIP_FEEDBACK_EXPORT_BACKEND_URL` is unset, and `server/src/index.ts` always wires it. In this hard fork, a user who opts into feedback sharing would upload gzip'd trace bundles (agent output, issue context, instruction files, run logs) to the upstream project's host. `feedbackService` itself fails closed with "Feedback export backend is not configured" when no client is given, so the default URL is the only thing that makes it live. The test faithfully pins the current default; the owner should decide whether to default to unconfigured (and then change both the code and this test).
- Minor product note: `isDatabaseConnectionUnavailableError` recurses `cause` with no depth guard; a cyclic cause chain would overflow the stack. Not changed (production code).
- Minor: `cloud` health metadata (`paperclip-cloud`, `*.paperclip.app` hosts) is still exercised by `health.test.ts`; confirm the fork intends to keep the cloud-managed branch.
- Coverage gaps left open: `claimFirstInstanceAdmin` concurrent claims; archived-company guard for `paused` companies; `buildPaperclipWakePayload` with malformed `paperclipAgentMessage`; grok-local skills for unsupported/persistent modes; `externalObjectService` rate-limit retry-after handling.
- Verify in t3-nightly (server suites run there): `heartbeat-accepted-plan-workspace-refresh`, `folders-service` (all 22), `external-objects-service` (26), `file-resources` symlink tests (Linux runs all 35).
- Hard-coded 20 s `beforeAll` timeouts for embedded PG are the most likely source of nightly flake on slow hosts; consider a shared constant (config change, out of scope here).

## 8 Summary of activities
Files rewritten and why:
- feedback-flush-controller.test.ts: boundary and negative inputs.
- feedback-share-client.test.ts: global stub leak; failure and fallback paths.
- file-resources-git-scan-load.test.ts: removed constant posing as a metric.
- file-resources.test.ts: isolation, exact assertions, platform guards.
- folders-routes.test.ts: route and authorization coverage.
- folders-service.test.ts: pure schema tests decoupled from PG.
- forbidden-tokens.test.ts: real non-leak assertion and branches.
- health.test.ts: partial mock, temp cleanup.
- health-dev-server-token.test.ts: token rejection and restart preconditions.
- heartbeat-accepted-plan-workspace-refresh.test.ts: partial adapter-registry mock.
- heartbeat-auto-checkout.test.ts: full branch table.
- external-objects-service.test.ts: call-count assertion.
Deletions: none.
Commands run (repo root, one vitest process at a time):
- `pnpm --filter @paperclipai/plugin-sdk ensure-build-deps` ok.
- `npx vitest run` on feedback-flush-controller, feedback-share-client, folders-routes, health, health-dev-server-token, health-workspace-readiness, file-resources-git-scan-load, heartbeat-agent-session-message, git-credentials, grok-local-skill-sync, heartbeat-auto-checkout: 94 passed (first run), all green.
- `npx vitest run forbidden-tokens.test.ts`: ENV failure to load before and after my change (CRLF shebang); 6/6 pass against a temporary LF copy of the script (deleted).
- `npx vitest run file-resources.test.ts`: first run 29 pass, 5 fail (ENV: symlink EPERM) and 1 skipped; after guards 29 passed, 6 skipped.
- `npx vitest run folders-service.test.ts`: 6 slug tests pass; 16 PG tests not run (ENV, 20 s hook timeout).
- `npx vitest run external-objects-service.test.ts`: 14 pass; 12 PG tests not run (ENV).
- `npx vitest run heartbeat-accepted-plan-workspace-refresh.test.ts`: not run (ENV, PG hook timeout). `first-admin-claim.test.ts` likewise (unedited).

## 9 Approvals
- Prepared by: ______________________  Date: __________
- Reviewed by: ______________________  Date: __________
- Approved by: ______________________  Date: __________
