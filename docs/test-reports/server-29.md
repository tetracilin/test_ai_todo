# Test Summary Report: shard server-29 (IEEE 829 structure)

## 1 Report identifier and scope

- Report id: server-29
- Project: `server` (vitest project, t3-nightly "slow-tests")
- Files: 22 under `server/src/__tests__/`
- Test cases counted: 241 (tool-gateway.test.ts = 46 static `it` + 5 expansions of the `remoteFailureCases` table = 51)
- Date: see git
- Rubric: ISO/IEC/IEEE 29119 and ISTQB, codes V1 to V9 (validity, meaningful assertions, determinism, isolation, mock fidelity, clarity, coverage balance, portability, maintainability)

## 2 Summary

Every file was read in full and checked against its production source in this fork. All subjects still exist (tool gateway, tool-access, workspace handoff, workspace readiness, runtime control, etc.); no test asserts upstream-only behaviour, so no V1 defect and no obsolete test was found. Several file-scoped defects (mostly V3/V4/V5/V8) were fixed with minimal test-only diffs.

| Verdict | Files |
|---|---|
| VALID | 5 |
| VALID_WITH_NOTES | 10 |
| REWRITTEN | 7 |
| OBSOLETE_REMOVED | 0 |
| NEEDS_DECISION | 0 |

## 3 Variances

- Host is Windows 11. The embedded-PostgreSQL suites (tool-gateway, tool-review-queue, control-recovery) could not complete reliably here: `beforeAll(..., 20_000)` timed out because importing the server module graph took 80 to 190 s and embedded PG start exceeded 20 s (ENV, not REAL). In workspace-runtime-control-recovery, 11 of 12 tests passed; the 1 failure was the first test's `afterEach` hook exceeding the 30 s config `hookTimeout` (ENV, cold start). Those DB-bound edits were therefore verified by transform (the suite loads and collects: 51 tests collected for tool-gateway) and review, not by a green run of the edited paths.
- The tool-gateway fake-server helper change could not be exercised end to end for the same reason.
- workspace-runtime-https-live-exercise is opt-in (needs `PAPERCLIP_LIVE_BROKER_EXERCISE=1` and a Tailscale broker socket); it collects and skips here. Its one-line fix is unrun.
- workspace-runtime-exposure-reservation binds real loopback ports 42501/42502/52501/52502 and uses `node -e` guest commands; not run (embedded PG, POSIX-oriented).
- Unedited files were not run, per instructions.

## 4 Comprehensive assessment (cross-cutting defects)

| Code | Count | Notes |
|---|---|---|
| V1 validity | 0 | No stale upstream behaviour found. Built-in fixtures `mcp-remote-fixture:*`, `mcp-stdio-fixture:*`, `paperclip.slow-stateful-stdio` and the fixture descriptions asserted verbatim in tool-gateway still exist in `services/tool-gateway.ts` and `tool-runtime-supervisor.ts`. |
| V2 meaningful assertions | 3 | Redundant duplicate assertion (handoff); `maxActiveChecks <= 16` cannot fail if checks run serially (timeline); `expect()` inside fake-server handlers hung the request instead of failing (tool-gateway). |
| V3 determinism | 4 | Hard-coded 20 s `beforeAll` caps below the config's 30 s hookTimeout; bounded-iteration polling (control-recovery); 10 ms vs 75 ms timeout race (tool-gateway, large margin); fixed ports (exposure-reservation). |
| V4 isolation | 2 | `vi.stubEnv` never unstubbed (review-queue, fixed); live-exercise leaked embedded PG (fixed). |
| V5 mock fidelity | 3 | `tempDb.stop?.()` called a method that does not exist on `EmbeddedPostgresTestDatabase` (fixed, real defect); hand-built drizzle chains in work-products and the handoff endpoint/issuer stubs (noted). |
| V6 clarity | 2 | Test name contradicted its assertion (readiness); misleading comment "four probes" vs 5 asserted; alias `siblingWorkspaceKey = KEY` (all fixed). |
| V7 coverage | 3 | See section 7. |
| V8 portability | 3 | Dir symlinks need privilege on Windows (fixed via junction); "pid above every pid ceiling" was wrong for Linux pid_max 2^22 (fixed); POSIX `/tmp` and `node -e` quoting in runtime tests (noted). |
| V9 maintainability | 2 | Very large single-file tool-gateway suite with long copy-paste setup; duplicated seed boilerplate. Noted only. |

## 5 Summary of results

| File | Tests | Verdict | Codes | Action |
|---|---|---|---|---|
| server/src/__tests__/tool-gateway.test.ts | 51 | REWRITTEN | V2, V3, V9 | Fake MCP server helper now captures handler assertion errors and rethrows from `close()`; no assertion changed |
| server/src/__tests__/tool-oauth-legacy-backfill.test.ts | 2 | VALID_WITH_NOTES | V7 | None; spies restored in afterEach; no negative path for malformed/absent tokens |
| server/src/__tests__/tool-review-queue-unsigned-request.test.ts | 1 | REWRITTEN | V4, V3 | Added `afterEach(vi.unstubAllEnvs)`; 20 s beforeAll noted |
| server/src/__tests__/trust-preset-resolver.test.ts | 6 | VALID | none | None |
| server/src/__tests__/trust-proxy.test.ts | 13 | VALID | none | None |
| server/src/__tests__/ui-branding.test.ts | 7 | VALID | none | None |
| server/src/__tests__/user-profile-routes.test.ts | 1 | VALID_WITH_NOTES | V7 | None; single happy-path test; no unknown-slug or cross-company case |
| server/src/__tests__/version.test.ts | 17 | VALID | none | None |
| server/src/__tests__/vite-html-renderer.test.ts | 2 | VALID | none | None |
| server/src/__tests__/work-product-runtime-reconciliation.test.ts | 5 | VALID | none | None |
| server/src/__tests__/work-products.test.ts | 2 | VALID_WITH_NOTES | V5, V2 | None; asserts call counts on a hand-built drizzle double (couples to implementation) |
| server/src/__tests__/work-timeline-service.test.ts | 8 | VALID_WITH_NOTES | V2, V7 | None; ACL bound test cannot detect serial execution |
| server/src/__tests__/workspace-instance-cleanup.test.ts | 12 | REWRITTEN | V8 | Symlink type `junction` on win32; passes 12/12 locally |
| server/src/__tests__/workspace-login-handoff-endpoint.test.ts | 10 | VALID_WITH_NOTES | V5 | None; hand-built db chain stub (documented) |
| server/src/__tests__/workspace-login-handoff-issuer.test.ts | 12 | VALID_WITH_NOTES | V5 | None; projection-sniffing db stub (`"url" in projection`) |
| server/src/__tests__/workspace-login-handoff.test.ts | 24 | REWRITTEN | V2, V6 | Removed duplicate assertion and misleading alias; 24/24 pass |
| server/src/__tests__/workspace-operations-reconciliation.test.ts | 3 | VALID_WITH_NOTES | V8 | None; hard-coded `/tmp` cwd values are DB data only |
| server/src/__tests__/workspace-readiness.test.ts | 37 | REWRITTEN | V6 | Renamed contradictory test; corrected probe-count comment; 37/37 pass |
| server/src/__tests__/workspace-reaper-cooldown-config.test.ts | 8 | VALID | none | None |
| server/src/__tests__/workspace-runtime-control-recovery.test.ts | 12 | REWRITTEN | V8, V3 | Replaced pid 4194303 (valid on Linux) with `DEAD_PID` 2147483646; 11/12 pass, 1 ENV hook timeout |
| server/src/__tests__/workspace-runtime-exposure-reservation.test.ts | 7 | VALID_WITH_NOTES | V3, V8 | None; fixed ports and POSIX guest, by design and documented |
| server/src/__tests__/workspace-runtime-https-live-exercise.test.ts | 1 | REWRITTEN | V5, V4 | `tempDb?.stop?.()` replaced with `tempDb?.cleanup()` (embedded PG was never stopped) |

## 6 Per-test detail (tests that are not clean)

| File | Test | Code | Finding | Action |
|---|---|---|---|---|
| tool-gateway.test.ts | (helper) startFakeRemoteMcpServer, used by ~15 tests with in-handler `expect` | V2/V3 | A failing `expect` inside the handler threw in a server callback: request hung until timeout plus unhandled rejection, masking the real failure | Handler errors caught, 500 returned, rethrown from `close()` |
| tool-gateway.test.ts | returns a controlled gateway error for remote MCP timeout abort | V3 | 10 ms client timeout vs 75 ms server delay; wall-clock race with ~65 ms margin | Noted |
| tool-gateway.test.ts | whole suite | V9 | 4100 lines, repeated seeding blocks | Noted |
| tool-review-queue-unsigned-request.test.ts | hides an unsigned pending request... | V4 | `vi.stubEnv` never restored; leaks signing secret to later tests in the worker | Added unstubAllEnvs |
| workspace-login-handoff.test.ts | rejects a ticket minted for another origin, workspace, or instance | V2/V6 | First `.ok === false` assertion was subsumed by the exact `origin_mismatch` assertion; `siblingWorkspaceKey = KEY` alias implied a different key | Removed both |
| workspace-readiness.test.ts | derives distinct key material per company... | V6 | Name claimed distinct keys, body asserts keys are equal | Renamed |
| workspace-readiness.test.ts | stops at the gate budget... | V6 | Comment said four probes, assertion (correctly) five | Comment fixed |
| workspace-instance-cleanup.test.ts | refuses a managed-root symlink...; refuses when the managed instances directory itself is a symlink | V8 | `fs.symlink(..., "dir")` needs privilege on Windows | Junction on win32 |
| workspace-runtime-control-recovery.test.ts | 5 tests using dead pid | V8 | Comment claimed 4194303 exceeds every pid ceiling; Linux pid_max can be 4194304, so that pid may exist | `DEAD_PID` constant |
| workspace-runtime-control-recovery.test.ts | waitForRunningOperation helper | V3 | Polls 100 x 20 ms; bounded, acceptable | Noted |
| workspace-runtime-control-recovery.test.ts | protects an in-process start from recovery... | V3 | Real 120 ms delay with a concurrent sweep loop; inherent to the concurrency being tested | Noted |
| workspace-runtime-https-live-exercise.test.ts | upgrades a pre-existing HTTP workspace... | V5/V4 | `stop` is not a member of `EmbeddedPostgresTestDatabase`; optional chaining silently skipped teardown | Fixed |
| work-products.test.ts | both tests | V5 | Asserts exact call counts on hand-built drizzle chains | Noted |
| work-timeline-service.test.ts | bounds pre-pagination ACL checks | V2 | `maxActive <= 16` passes trivially if checks are serial | Noted |
| workspace-runtime-exposure-reservation.test.ts | all | V3/V8 | Real loopback ports 425xx/525xx, `node -e` guest | Noted (documented in header) |
| workspace-login-handoff-issuer.test.ts | stubDb | V5 | Branches on `"url" in projection`; rots if the query projection changes | Noted |
| user-profile-routes.test.ts | resolves a user slug... | V7 | Only the 200 path | Noted |
| tool-oauth-legacy-backfill.test.ts | both | V7 | No malformed/absent-token case | Noted |

## 7 Evaluation and recommendations

- No production bug suspected; no NEEDS_DECISION.
- Product-adjacent finding: `EmbeddedPostgresTestDatabase` exposes only `cleanup()`. Types were not catching the nonexistent `stop` call because test files are not typechecked; consider including `server/src/__tests__` in a typecheck project.
- Hard-coded `beforeAll(..., 20_000)` in most embedded-PG suites undercuts `hookTimeout: 30000` in `server/vitest.config.ts`; on slow hosts (Windows) PG start fails before the global setting applies. Recommend dropping the per-hook override (needs an owner decision across many files, out of scope for this shard).
- Coverage gaps: user-profile route (unknown slug, other-company user, empty stats); OAuth backfill (malformed/empty token values, multi-company); work-products (real-DB test of the primary-flag swap); work-timeline (assert real concurrency of ACL checks).
- tool-gateway should be split by concern (named gateways, remote MCP, approvals, runtime slots) with a shared fixtures module.

## 8 Summary of activities

Files rewritten (test-only):
- tool-gateway.test.ts: fake MCP server surfaces handler assertion failures.
- tool-review-queue-unsigned-request.test.ts: unstub env after each test.
- workspace-login-handoff.test.ts: removed redundant assertion and misleading alias.
- workspace-readiness.test.ts: renamed contradictory test, fixed comment.
- workspace-instance-cleanup.test.ts: Windows-safe directory links.
- workspace-runtime-control-recovery.test.ts: guaranteed-dead pid constant.
- workspace-runtime-https-live-exercise.test.ts: correct teardown call.

Deletions: none.

Commands run (repo root):
- `pnpm --filter @paperclipai/plugin-sdk ensure-build-deps`: ok.
- `npx vitest run` workspace-login-handoff: 24/24 pass. workspace-readiness: 37/37 pass. workspace-instance-cleanup: 12/12 pass.
- workspace-runtime-control-recovery: 11/12 pass, 1 ENV afterEach hook timeout (30 s, cold embedded PG on Windows).
- tool-review-queue-unsigned-request (twice): ENV beforeAll timeout (20 s) before tests ran.
- tool-gateway (`-t "decodes an SSE-framed"`): collected 51 tests, ENV beforeAll timeout.
- workspace-runtime-https-live-exercise: skipped by design (opt-in).

## 9 Approvals

Prepared by: ______________________  Date: __________

Reviewed by: ______________________  Date: __________

Approved by: ______________________  Date: __________
