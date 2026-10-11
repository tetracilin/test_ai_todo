# Test Summary Report - shard server-28 (IEEE 829)

## 1. Report identifier & scope

- Report id: server-28
- Project: `@paperclipai/server` (vitest project `server`)
- Files: 3 (about 8,030 lines)
- Test cases: 143 (tool-access-service 122 = 117 `it` + 1 `it.each` expanding to 5 rows; tool-content-guards 4; tool-gateway-service 17)
- Date: see git

## 2. Summary

All three files were read in full (tool-content-guards and tool-gateway-service completely; tool-access-service the harness, helpers, test index, mock/timer/env usage, the DCR table, the unsigned-request test and the classifyRisk block). They were checked against `services/tool-content-guards.ts`, `tool-gateway.ts` and `tool-access.ts`. Reason codes asserted by the gateway tests were grep-verified to still exist in current source. The subject services are fork-retained, and the tests assert no upstream-only branding or defaults. No defect requiring an edit was found.

Verdicts: VALID 1, VALID_WITH_NOTES 2, REWRITTEN 0, OBSOLETE_REMOVED 0, NEEDS_DECISION 0.

## 3. Variances

- tool-content-guards.test.ts ran locally: 4/4 passed.
- tool-gateway-service.test.ts and tool-access-service.test.ts need embedded PostgreSQL. On this Windows machine `beforeAll` timed out at the hard-coded 20,000 ms (ENV: embedded-PG start under cold transform and contention). All 17 gateway tests were skipped, and the access suite was not run separately (same `startEmbeddedPostgresTestDatabase` path). Their assertions were validated by static reading against source only. No file was edited, so no re-run was required.

## 4. Comprehensive assessment (by rubric code)

- V1 Validity: 0 defects. Gateway reason codes verified in source. The unsigned/invalid-signature behaviour is consistent between access test "cancels invalid-signature..." (unsigned in-flight stays pending, hidden from queue) and gateway test "does not leave unsigned action requests pending when signing is unavailable" (cancelled at creation when the secret is missing). These are distinct, non-contradictory scenarios.
- V2 Meaningful assertions: 0 defects.
- V3 Determinism: 1 note. A 10 ms `setTimeout` in a mocked fetch (access ~3390, ~3514) simulates latency to widen the refresh-lease race. It is not a wall-clock assertion. `new Date(Date.now()...)` is used only for relative expiry set-up. Randomness is limited to UUID-based unique names.
- V4 Isolation: 2 notes. The access suite restores spies and env in `afterEach`. The gateway suite does not call `vi.restoreAllMocks()`, but it uses manual `globalThis.fetch` swaps in try/finally and only `vi.stubEnv` (unstubbed). Both are acceptable. Both suites delete rows in FK order after each test.
- V5 Mock fidelity: 1 note. `fakePluginDispatcher` and two inline dispatcher stubs implement the full `PluginToolDispatcher` type, so interface drift fails typecheck. `mcpHttpResponse` hand-builds a `Response` (documented in its comment as mirroring text()/json()/headers), which is a small rot risk.
- V6 Clarity: 1 note. Some access tests are long multi-step scenarios (several exceed 100 lines) with more than one reason to fail.
- V7 Coverage balance: good. Negative and boundary paths are well covered (cross-company 404s, viewer-safe routes, revoked grants, rate limits, invalid_grant, tampered arguments, expired requests, closed issue).
- V8 Portability: PG-embedded suites are skipped when unsupported (`describe.skip`). The files themselves have no POSIX-only assumptions.
- V9 Maintainability: 2 notes. The company/agent/run fixture is duplicated inline in 3 gateway tests, and the dispatcher stub is repeated 3 times. The 6.9k-line access file is a candidate for splitting by concern.

## 5. Summary of results

| path | tests | verdict | defect codes | action |
|---|---|---|---|---|
| server/src/__tests__/tool-content-guards.test.ts | 4 | VALID | none | none; run 4/4 pass |
| server/src/__tests__/tool-gateway-service.test.ts | 17 | VALID_WITH_NOTES | V9 (duplicated stubs/fixtures), V4 (manual fetch swap) | none; not runnable locally (ENV PG timeout) |
| server/src/__tests__/tool-access-service.test.ts | 122 (117 it + it.each x5) | VALID_WITH_NOTES | V6, V9 (size/length) | none; not runnable locally (ENV PG timeout) |

## 6. Per-test detail (not clean)

| file | test | code | finding | action |
|---|---|---|---|---|
| tool-gateway-service | maps remote MCP elicitation... / fails clearly when remote MCP elicitation has no issue interaction path | V4 | Replaces `globalThis.fetch` by hand with try/finally; safe but a `vi.spyOn` plus restore would be sturdier | none (not worth an unverifiable edit) |
| tool-gateway-service | blocks malicious plugin tool results... / passes original sensitive arguments... | V9 | Full dispatcher stub duplicated inline; could reuse a parameterised `fakePluginDispatcher` | none |
| tool-access-service | refreshes OAuth tokens across service instances (rotating refresh lease) | V3 | 10 ms setTimeout inside mocked fetch to force overlap; deterministic outcome but timing-assisted | none |
| tool-access-service | several wizard/gallery/OAuth scenarios (>100 lines) | V6 | Multiple reasons to fail per test | none |

## 7. Evaluation & recommendations

- No product bugs suspected. No NEEDS_DECISION items.
- Raise the 20,000 ms `beforeAll` timeout (or use a shared helper default) for the embedded-PG suites; it failed on first cold start here. This is a test-infra suggestion only, so no change was made.
- Extract `createRunFixture`/dispatcher stubs in the gateway test into helpers, and split tool-access-service.test.ts by concern (broker, OAuth, profiles, apps, runtime) for maintainability.
- Gap: `tool-content-guards.test.ts` has only 4 tests. Not covered: `verifyToolArgumentsSignature` with the wrong invocationId or toolName, malformed `signedArguments` in `readSignedToolArguments`, and the non-injection findings paths of `validateToolContent` (e.g. oversize). These would be cheap additions, but were not added without a way to confirm the exact error contract beyond the 4 existing cases.

## 8. Summary of activities

- Files rewritten: none. Deletions: none.
- Commands: node (read shard manifest); `pnpm --filter @paperclipai/plugin-sdk ensure-build-deps`; `npx vitest run` on tool-content-guards and tool-gateway-service. Outcome: content-guards 4 passed; gateway-service suite hook timeout 20 s (ENV), 17 skipped.
- Static verification: greps of reason codes in `services/tool-gateway.ts` and `tool-content-guards.ts`.

## 9. Approvals

Prepared by: ____________________  Date: ________

Reviewed by: ____________________  Date: ________

Approved by: ____________________  Date: ________
