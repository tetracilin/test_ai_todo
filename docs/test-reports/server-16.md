# Test Summary Report - shard server-16 (IEEE 829)

## 1 Report identifier and scope

- Report id: server-16
- Project: server (vitest project `@paperclipai/server`), t3-nightly "slow-tests" audit
- Files: 31 (`server/src/__tests__/heartbeat-workspace-session` through `invite-url-public-base-url`)
- Test cases: about 344, each/table expansions included (139 in heartbeat-workspace-session; 3 added by this audit)
- Date: see git
- Rubric: ISO/IEC/IEEE 29119 and ISTQB. Codes V1 validity, V2 assertions, V3 determinism, V4 isolation, V5 mock fidelity, V6 clarity, V7 coverage balance, V8 portability, V9 maintainability.

## 2 Summary

All 31 files were read in full and checked against the current fork source (`routes/access.ts`, `services/heartbeat.ts`, `services/instance-settings.ts` and others).
No file asserts upstream-only behaviour that contradicts fork policy. The Hermes-only agent-join rule (`requireSoleAgentAdapterType`) was covered at unit level and is now also covered at route level.

Verdicts: VALID 16, VALID_WITH_NOTES 10, REWRITTEN 5, OBSOLETE_REMOVED 0, NEEDS_DECISION 0.
No test was deleted or weakened. Five files were edited: four to remove a per-test `vi.resetModules()` plus dynamic re-import (which caused a real, reproducible 10 s timeout on this machine), and one to add missing negative-path coverage.

## 3 Variances

- Platform is Windows 11. All embedded-Postgres suites fail at `beforeAll` with "Hook timed out in 20000ms" (ENV: embedded Postgres start on Windows). Affected: heartbeat-worktree-suppression, inbox-agent-policy-routes, inbox-archive-routes, inbox-dismissals, invite-list-route, interaction-resolution-cross-issue-cap-postgres, and the hermes persistence block of invite-accept-gateway-defaults. Their bodies could not be executed here; assessment is by static review. None of these files were edited.
- heartbeat-worktree-suppression was re-run alone and failed identically in `beforeAll` (ENV, not REAL).
- Plugin-sdk build deps were ensured first. Runs were serialized.
- The native-duration block in instrumentation.test.ts is skipped because `@opentelemetry/*` is not installed here.

## 4 Comprehensive assessment (cross-cutting defects)

| Code | Count | Description |
|---|---|---|
| V3 | 4 files fixed, 2 noted | `vi.resetModules()` per test plus `importActual` / dynamic import of the whole `routes/access.js` graph. invite-summary-route took more than 10 s per test cold and all 4 tests timed out on a clean run; after the fix the file has 179 ms of test time. Same pattern fixed in invite-create-route, invite-url-public-base-url, invite-rate-limit-route. Still present (noted) in instance-settings-routes. heartbeat-worktree-suppression polls with a loop count (100 x 50 ms) rather than a deadline |
| V5 | 9 files | Hand-built `vi.mock("../services/index.js")` stand-ins without `importOriginal` (invite-create-route, invite-list-route, invite-accept-existing-member, invite-url-public-base-url, instance-settings-routes); hand-built db chain stubs (hire-hook, invite-summary, invite-logo, invite-rate-limit-route, invite-test-resolution); hand-written Hermes session codec in heartbeat-workspace-session; stale stub data such as `defaultsPayload: { humanRole }` where the service reads `human.role` |
| V1 | 3 files | Onboarding text, replay and normalize helpers still pin `openclaw_gateway` flows that are unreachable for agent joins under fork policy (section 7) |
| V7 | 3 | No authz negatives for invite create; route-level rejection of non-Hermes agent accept was missing (added); no revoked/expired case for invite summary |
| V6 | 3 | invite-onboarding-text asserts about 50 substrings in one test; instance-settings-service "ignores retired experimental flags" echoes the flags back (misleading name); many near-duplicate "defaults X to false" tests |
| V9 | 2 | Stale "TDD ... will fail until implementation lands" header (fixed); duplicated invite fixtures across invite-* files |
| V4 | 1 | interaction-resolution afterEach swallows cleanup errors by design (documented, assertions scoped per company) |
| V8 | 1 | heartbeat-workspace-session uses `/tmp/...` strings only as fixtures (no fs access); git tests use `os.tmpdir()` and pass on Windows |
| V2 | 0 | No tautologies found |

## 5 Summary of results

| Path | Tests | Verdict | Defects | Action |
|---|---|---|---|---|
| server/src/__tests__/heartbeat-workspace-session.test.ts | 139 | VALID_WITH_NOTES | V5, V9 | Ran green. Hermes codec is a hand-written stand-in; very large catch-all file |
| server/src/__tests__/heartbeat-worktree-suppression.test.ts | 5 | VALID_WITH_NOTES | V3 | Not runnable here (ENV). Loop-count polling noted |
| server/src/__tests__/heartbeat-zombie-guard.test.ts | 13 | VALID | - | Ran green |
| server/src/__tests__/hire-hook.test.ts | 5 | VALID_WITH_NOTES | V5 | Ran green. Hand-built db chain (acceptable for single-query function) |
| server/src/__tests__/http-log-policy.test.ts | 5 | VALID | - | Ran green |
| server/src/__tests__/http-log-redaction.test.ts | 2 | VALID | - | Ran green; ephemeral port, closed in finally |
| server/src/__tests__/inbox-agent-policy-routes.test.ts | 5 | VALID | - | ENV; static review only |
| server/src/__tests__/inbox-archive-routes.test.ts | 8 | VALID | - | ENV; static review only |
| server/src/__tests__/inbox-dismissals.test.ts | 3 | VALID | - | ENV; static review only |
| server/src/__tests__/instance-database-backups-routes.test.ts | 7 | VALID | - | Ran green |
| server/src/__tests__/instance-settings-managed-overlay.test.ts | 8 | VALID | - | Ran green |
| server/src/__tests__/instance-settings-routes.test.ts | 34 | VALID_WITH_NOTES | V3, V5 | Ran green. Per-test resetModules; partial settings fixtures |
| server/src/__tests__/instance-settings-service.test.ts | 23 | VALID_WITH_NOTES | V6, V9 | Ran green |
| server/src/__tests__/instrumentation.test.ts | 15 | VALID_WITH_NOTES | V8 | Ran green (2 skipped). "packages missing" test assumes OTel SDK absent |
| server/src/__tests__/interaction-resolution-cross-issue-cap-postgres.test.ts | 7 | VALID | V4 (by design) | ENV; static review only. Strong real-DB race test |
| server/src/__tests__/invite-accept-existing-member.test.ts | 6 | REWRITTEN | V7 | Added 3 route-level negative cases (agent join with openclaw_gateway / process / no adapterType rejected with 400; nothing inserted or updated). Ran green |
| server/src/__tests__/invite-accept-gateway-defaults.test.ts | 13 | VALID_WITH_NOTES | V1 | Non-PG tests ran green; hermes persistence block ENV. OpenClaw helpers cover code unreachable from agent accept |
| server/src/__tests__/invite-accept-replay.test.ts | 2 | VALID_WITH_NOTES | V1 | Ran green. Only OpenClaw replay covered |
| server/src/__tests__/invite-create-route.test.ts | 1 | REWRITTEN | V3, V5, V7 | Static vi.mock and imports replace resetModules/doMock. Ran green. Authz negatives still missing |
| server/src/__tests__/invite-expiry.test.ts | 1 | VALID | - | Ran green |
| server/src/__tests__/invite-join-grants.test.ts | 9 | VALID | - | Ran green |
| server/src/__tests__/invite-join-manager.test.ts | 3 | VALID | - | Ran green |
| server/src/__tests__/invite-list-route.test.ts | 1 | VALID_WITH_NOTES | V5, V7 | ENV; static review only. Hand-built services mock; single happy-path |
| server/src/__tests__/invite-logo-route.test.ts | 2 | VALID | - | Ran green |
| server/src/__tests__/invite-onboarding-text.test.ts | 4 | VALID_WITH_NOTES | V1, V6 | Ran green. Giant multi-assert test; asserts OpenClaw text |
| server/src/__tests__/invite-rate-limit-route.test.ts | 3 | REWRITTEN | V3 | Removed per-test resetModules; static imports. Ran green |
| server/src/__tests__/invite-rate-limit.test.ts | 3 | VALID | - | Ran green; injected clock |
| server/src/__tests__/invite-summary-route.test.ts | 4 | REWRITTEN | V3 | Was failing 4/4 (10 s timeout each from cold re-import). Static vi.mock and imports; passes with 179 ms test time |
| server/src/__tests__/invite-test-resolution-route.test.ts | 7 | VALID | - | Ran green; injected DNS/network, SSRF table |
| server/src/__tests__/invite-token-entropy.test.ts | 3 | VALID | - | Ran green |
| server/src/__tests__/invite-url-public-base-url.test.ts | 3 | REWRITTEN | V3, V9 | Static mocks/imports; stale "TDD, will fail" header removed. Ran green |

## 6 Per-test detail (non-clean tests)

| File | Test | Code | Finding | Action |
|---|---|---|---|---|
| invite-summary-route | all 4 | V3 | `vi.resetModules()` plus `importActual` re-evaluated the access route graph per test; each exceeded the 10 s per-test timeout on a clean run (REAL on this host, passes with 180 s timeout) | Rewritten to static mock/imports; all pass |
| invite-create-route | returns an absolute invite URL | V3 | Same re-import pattern | Rewritten |
| invite-url-public-base-url | 3 tests | V3, V9 | Same pattern; header claimed tests would fail until implementation | Rewritten; header corrected |
| invite-rate-limit-route | 3 tests | V3 | resetModules with dynamic imports unnecessary (no module mocks) | Rewritten |
| invite-accept-existing-member | rejects agent joins whose adapterType is X (new) | V7 | Route-level Hermes-only policy had no test | 3 cases added |
| invite-accept-gateway-defaults | OpenClaw helper describes | V1 | Helpers exercised but unreachable from agent-accept route | Kept, noted |
| invite-accept-replay | canReplayOpenClawGatewayInviteAccept | V1 | Same | Kept, noted |
| invite-onboarding-text | renders a plain-text onboarding doc | V6, V1 | About 50 `toContain` in one test; includes openclaw_gateway lines | Kept, noted |
| instance-settings-service | ignores retired experimental flags... | V6 | Name says ignored but flags are echoed back; really a full-shape snapshot | Kept, noted |
| instance-settings-service | defaults X to false (about 10 tests) | V9 | Near-duplicates that could be one `it.each` | Kept |
| instance-settings-routes | beforeEach | V3, V5 | resetModules per test; partial settings fixtures omit newer keys | Kept, noted |
| heartbeat-worktree-suppression | waitForCompletedRun | V3 | Bounded by loop count, not a deadline | Kept, noted |
| heartbeat-workspace-session | Hermes session tests | V5 | Hand-written `hermesSessionCodec` rather than the real adapter codec | Kept, noted |
| hire-hook | all | V5 | Hand-built drizzle chain | Kept |
| invite-list-route | returns invite history | V5, V7 | Hand-built services mock; no empty / out-of-range offset / foreign-company case | Kept, noted |

## 7 Evaluation and recommendations

Product findings:
1. Fork policy makes Hermes Gateway the sole agent adapter (`requireSoleAgentAdapterType`; the accept route returns 400 for anything else), yet `routes/access.ts` still carries OpenClaw-specific accept, replay and normalize branches, and the onboarding text and invite schema description still advertise `openclaw_gateway`. Those branches are dead for agent joins; their tests pass but pin dead behaviour. A product-owner decision is needed: remove OpenClaw from invite onboarding, replay code and tests, or relax the sole-adapter rule.
2. Embedded Postgres suites cannot start on Windows within the 20 s hook timeout, so this machine gives no signal for 7 files. Treat local failure as ENV and rely on CI/kmv8.
3. The cold re-import cost of `routes/access.js` via `vi.resetModules()` is a nightly flake risk under contention; the pattern remains in instance-settings-routes and may exist in suites outside this shard.

Coverage gaps (not added): invite-create authz negatives; invite-summary revoked/expired; invite-list empty page and offset beyond end; a test that the real Hermes session codec round-trips what `resolveNextSessionState` expects.

## 8 Summary of activities

Files rewritten:
- invite-summary-route.test.ts: static vi.mock/imports instead of resetModules/importActual (was failing 4/4 on timeout).
- invite-create-route.test.ts: same pattern fix.
- invite-url-public-base-url.test.ts: same fix; stale TDD header removed.
- invite-rate-limit-route.test.ts: unnecessary resetModules removed.
- invite-accept-existing-member.test.ts: added 3 negative route tests for the Hermes-only agent policy.

Deletions: none.

Commands and outcomes:
- `pnpm --filter @paperclipai/plugin-sdk ensure-build-deps` done.
- First batch of 27 files (hire-hook, http-log, invite-*, inbox-*, instance-*, instrumentation): 153 passed, 1 failed (invite-summary), 20 skipped, 5 suites ENV hook timeouts.
- heartbeat-workspace-session and heartbeat-zombie-guard: 152 passed.
- heartbeat-worktree-suppression alone: ENV hook timeout.
- invite-summary-route before fix: 4/4 timeout; with timeout raised: 4/4 pass; after fix: 4/4 pass.
- invite-create-route, invite-url-public-base-url, invite-rate-limit-route, invite-accept-existing-member after edits: 13/13 pass.

## 9 Approvals

Prepared by: ______________________  Date: __________

Reviewed by: ______________________  Date: __________

Approved by: ______________________  Date: __________
