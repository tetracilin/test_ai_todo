# Test Summary Report: shard server-01 (IEEE 829 structure)

## 1 Report identifier and scope

| Item | Value |
|---|---|
| Report id | server-01 |
| Project | `@paperclipai/server` (vitest project `server`) |
| Scope | 23 test files under `server/src/__tests__/` (access-*, activity-*, adapter-*, agent-* up to agent-live-run-routes), about 9,000 lines |
| Tests counted | 260 test cases after this audit (228 before; each `it.each` row counts as one case) |
| Date | see git |
| Rubric | ISO/IEC/IEEE 29119 and ISTQB principles V1 to V9 (validity, meaningful assertions, determinism, isolation, mock fidelity, clarity, coverage balance, portability, maintainability) |
| Baseline | Fork-owned behaviour on `test/slow-tests-audit` (selectable adapters: `hermes_gateway`, `claude_local`, `hermes_local`) |

## 2 Summary

Every file was read in full and checked against the production source it exercises (`routes/access.ts`, `routes/activity.ts`, `routes/adapters.ts`, `routes/agents.ts`, `routes/authz.ts`, `adapters/registry.ts`, `services/activity.ts`, `services/agent-instructions.ts`, `agent-auth-jwt.ts`, auth middleware). No test asserts upstream-only behaviour that is still wrong, and no subject under test has been removed. The defects were mostly mock fidelity (two hand-copied stand-ins of production logic), a stale fork-policy mock and comments, flaky first-import and embedded-Postgres timeouts, and missing negative-path coverage.

| Verdict | Files |
|---|---|
| VALID | 2 |
| VALID_WITH_NOTES | 6 |
| REWRITTEN | 15 |
| OBSOLETE_REMOVED | 0 |
| NEEDS_DECISION | 0 |

No test was deleted. No production code, config, package.json or snapshot was touched.

## 3 Variances

* The platform is Windows 11 with many other agents running vitest at the same time. Observed contention: route-module imports took 30 to 70 s and embedded Postgres start-up exceeded 20 s. Every failure seen was classified ENV (hook or test timeout, followed by a leaked continuation of the timed-out test resetting mocks under the next test). No REAL failure was found.
* Embedded Postgres is supported on this host (suites were not skipped), so DB-backed suites really ran.
* Windows path caveats: `PAPERCLIP_HOME=/tmp/...` in `access-routes-permissions-upgrade` resolves to `C:\tmp` (harmless). `agent-adapter-validation-routes` asserted a POSIX separator in `CODEX_HOME`; it is now separator-agnostic.
* Not executed on a POSIX host or in `t3-nightly`; nightly remains the authority for server suites.
* An early background loop of mine accidentally ran two vitest processes at once and produced spurious timeouts; those logs were discarded. All verdicts come from clean single-process runs.

## 4 Comprehensive assessment (cross-cutting defects)

| Code | Count | Description |
|---|---|---|
| V1 Validity | 1 | `agent-instructions-routes` hard-coded a stale selectable-adapter stub (`[hermes_gateway]` only, comments citing commit c1ffeec67) instead of the registry policy. |
| V2 Meaningful assertions | 3 | `adapter-routes`: `expect([200, 404]).toContain(status)` and an `every(...)` subset check that passes on an empty selectable set; `agent-device-login-routes`: redaction test claimed to cover activity but never inspected `logActivity`. |
| V3 Determinism | 10 | First-test dynamic import of huge routers charged to 5 s to 20 s test timeouts (cross-tenant, instructions-routes, live-run-routes, action-audit, permissions-upgrade, hidden-floor); 20 s embedded-Postgres hook timeouts (5 files); 2 s polling deadline in `activity-service`. |
| V4 Isolation | 3 | `PAPERCLIP_HIDDEN_SETTINGS` and `PAPERCLIP_SELECTABLE_ADAPTER_TYPES` not pinned or restored; `adapter-models` deletes env without restoring; timed-out test continuations leaking mock resets. |
| V5 Mock fidelity | 4 | `agent-cross-tenant-authz-routes` replaced `routes/authz.js` (the code under test) with a hand-written copy missing `assertBoardOrgAccess`, responsible-user checks and others; `activity-routes` re-implemented `normalizeActivityLimit` in the mock, so the default/cap assertions tested the mock; `agent-instructions-routes` stand-in adapter index; DB stubs that ignore `where` in two files (noted only). |
| V6 Clarity | 3 | Misleading test name in `agent-action-audit-routes`; two loop-in-one-test tests in `adapter-routes-authz`; one 100-line multi-adapter capability test in `adapter-routes` (noted). |
| V7 Coverage | 5 | Added negative or boundary tests: JWT malformed, algorithm, signature and exp boundary; session codec invalid input; instruction bundle path traversal; device-login permission denied and promoted path. |
| V8 Portability | 1 | POSIX separator assertion fixed. |
| V9 Maintainability | 4 | Five copies of a 25-field live-run row fixture, dead `selectCalls`, a duplicate `doUnmock`; duplicated `vi.mock` plus `vi.doMock` blocks left (see recommendations). |

## 5 Summary of results

| File | Tests | Verdict | Defects | Action taken |
|---|---|---|---|---|
| server/src/__tests__/access-routes-hidden-floor.test.ts | 6 | REWRITTEN | V3, V4 | Pin and restore `PAPERCLIP_HIDDEN_SETTINGS`; `beforeAll` import timeout 30 s to 120 s |
| server/src/__tests__/access-routes-permissions-upgrade.test.ts | 2 | REWRITTEN | V3 | Hook timeout 20 s to 90 s; separate 240 s `beforeAll` warms the access router import (first test has a 10 s timeout) |
| server/src/__tests__/access-service.test.ts | 9 | VALID_WITH_NOTES | V3, V9 | Embedded-PG hook timeout 20 s to 90 s only |
| server/src/__tests__/access-validators.test.ts | 3 | VALID | none | none |
| server/src/__tests__/activity-log-responsible-user.test.ts | 9 | VALID_WITH_NOTES | V3, V5 | Hook timeout 20 s to 90 s; note: stub reader ignores the `where` condition |
| server/src/__tests__/activity-routes.test.ts | 10 | REWRITTEN | V5 | Mock now spreads `importOriginal` so the real `normalizeActivityLimit` is exercised |
| server/src/__tests__/activity-service.test.ts | 5 | REWRITTEN | V3 | Polling deadline 2 s to 8 s; hook timeout 90 s |
| server/src/__tests__/adapter-model-refresh-routes.test.ts | 3 | VALID_WITH_NOTES | V5, V9 | none; hand-built `services/index.js` stand-in |
| server/src/__tests__/adapter-models.test.ts | 17 | VALID_WITH_NOTES | V4 | none; env vars deleted in `beforeEach` but originals never restored; hard-codes fallback model ids (deliberate fork catalogue) |
| server/src/__tests__/adapter-registry.test.ts | 18 | VALID_WITH_NOTES | V4 | none; default-selectable test relies on `PAPERCLIP_SELECTABLE_ADAPTER_TYPES` being unset (expectation matches `registry.ts` default) |
| server/src/__tests__/adapter-routes-authz.test.ts | 23 | REWRITTEN | V6, V7 | Two loop-in-one-test tests converted to `it.each` (12 cases); added assertions that install and reload side effects never ran for denied admins |
| server/src/__tests__/adapter-routes.test.ts | 13 | REWRITTEN | V2 | Selectable test asserts the exact set; paused-builtin schema asserts 200 not `[200,404]` |
| server/src/__tests__/adapter-session-codecs.test.ts | 20 | REWRITTEN | V7 | Added 10 negative cases (null, scalar, array, empty, blank id, serialize null) across 5 codecs |
| server/src/__tests__/agent-action-audit-routes.test.ts | 11 | REWRITTEN | V6, V3 | Renamed misleading first test; hook timeout 90 s; warm route import |
| server/src/__tests__/agent-adapter-validation-routes.test.ts | 14 | REWRITTEN | V8, V9 | Path assertion separator-agnostic; removed duplicate `doUnmock` |
| server/src/__tests__/agent-auth-jwt.test.ts | 23 | REWRITTEN | V7 | Added malformed token (3 rows), altered signature, `alg:none`, exp boundary tests |
| server/src/__tests__/agent-auth-middleware.test.ts | 16 | VALID_WITH_NOTES | V5 | none; DB stub ignores `where` so lookups by id are not constrained |
| server/src/__tests__/agent-cross-tenant-authz-routes.test.ts | 5 | REWRITTEN | V5, V3 | Removed the hand-written `routes/authz.js` mock, now uses real authz; import warm-up `beforeAll` |
| server/src/__tests__/agent-device-login-routes.test.ts | 19 | REWRITTEN | V2, V7 | Redaction test inspects `logActivity`; added permission-denied (403, no lease) and promoted-to-authenticated tests |
| server/src/__tests__/agent-instructions-routes.test.ts | 9 | REWRITTEN | V1, V3, V4, V5 | Adapter index mock uses `importOriginal`; selectable set pinned via env and restored; stale c1ffeec67 comments fixed; import warm-up |
| server/src/__tests__/agent-instructions-service.test.ts | 12 | REWRITTEN | V7 | Added path-traversal rejection tests (4 paths, each for write, read and delete) |
| server/src/__tests__/agent-invokability.test.ts | 3 | VALID | none | none |
| server/src/__tests__/agent-live-run-routes.test.ts | 10 | REWRITTEN | V9, V3 | Extracted `makeLiveRunRow` fixture, removed dead `selectCalls`, removed the 10 s override, import warm-up |

## 6 Per-test detail (tests that are not clean)

| File | Test | Code | Finding | Action |
|---|---|---|---|---|
| activity-routes | caps requested company activity list limits; limits company activity lists by default | V5 | Asserted clamping implemented in the mock, not in production | Real function through importOriginal |
| activity-service | backfills missing liveness; does not backfill document evidence from a different run; does not treat continuation summary revisions as evidence | V3 | 2 s polling deadline for async backfill is flaky under load | 8 s |
| adapter-routes | GET /api/adapters marks only the selectable adapters as selectable | V2 | `every(subset)` passes for an empty set | Exact sorted set |
| adapter-routes | uses the active adapter when resolving config schema for a paused builtin override | V2 | `[200,404]` accepted either status | 200 |
| adapter-routes | GET /api/adapters returns correct capabilities for built-in adapters | V6 | Six adapters asserted in one test | Noted, not split |
| adapter-routes-authz | rejects mutating adapter routes...; allows instance admins... | V6 | Loop inside one test | `it.each` |
| agent-action-audit-routes | denies agents and board users without the audit permission | V6 | Name omitted that agents get redacted all-actors rows (200) | Renamed |
| agent-adapter-validation-routes | isolates CODEX_HOME when updating a codex_local agent | V8 | Forward-slash assertion fails on Windows | Normalised |
| agent-cross-tenant-authz-routes | all five | V5 | authz mock was a stale copy of the code under test | Real authz |
| agent-device-login-routes | omits the URL, code, credential bytes, and lease id from logs and activity | V2 | Activity half was unverified | Added `logActivity` calls |
| agent-device-login-routes | fails closed when promotion loses the sole-owner claim; fails closed on different account | V9 | Near duplicates | Noted |
| agent-instructions-routes | switching-adapter tests | V1 | Assumed hermes_gateway is the only selectable adapter through a hard-coded stub | Real registry, env pinned |
| agent-auth-jwt | still rejects the master-secret legacy fallback once it is disabled | V9 | Overlaps with the enabled-flag test | Noted |
| agent-auth-middleware | DB-backed cases | V5 | Stub `where()` ignores conditions | Noted |
| activity-log-responsible-user | unit cases | V5 | `createReader` only asserts the condition is defined | Noted |
| access-service | all | V3 | 20 s Postgres start | 90 s |
| adapter-models | all | V4 | Env not restored | Noted |

## 7 Evaluation and recommendations

Product findings: none. Every discrepancy discovered was on the test side. The registry policy (`listSelectableServerAdapters` default `hermes_gateway`, `claude_local`, `hermes_local`) matches the expectations in `adapter-registry`, `adapter-routes`, `adapter-models` and `agent-adapter-validation-routes`.

Recommendations:

1. Repo-wide: many route tests reload the 4,000-line `routes/agents.ts` after `vi.resetModules()` in every test. Add a shared warm-up helper or stop resetting modules; this is the main source of 20 s timeouts under load. A first-import warm-up was added to the files where it demonstrably failed; `agent-adapter-validation-routes`, `agent-device-login-routes` and `adapter-model-refresh-routes` are the next candidates.
2. Replace hand-built `services/index.js` factories with `importOriginal` partial mocks (V5), as `agent-device-login-routes` already does for its service. Candidates: `adapter-model-refresh-routes`, `agent-adapter-validation-routes`, `agent-live-run-routes`, `agent-instructions-routes`.
3. Move the embedded-Postgres `beforeAll` timeout into the shared helper; 90 s was applied only to the files touched here.
4. Make DB stubs in `agent-auth-middleware` and `activity-log-responsible-user` record and assert the `where` condition.
5. Coverage gaps not filled: `adapter-models` malformed provider payloads; `agent-live-run-routes` `minCount` above the cap; access-router happy paths are in the embedded-Postgres suites of other shards.
6. Convert the monolithic capabilities test in `adapter-routes` to a table (`it.each` per adapter).

## 8 Summary of activities

Files rewritten, one line each:

* access-routes-hidden-floor: env isolation, longer import hook.
* access-routes-permissions-upgrade: hook timeouts and import warm-up.
* access-service, activity-log-responsible-user: embedded-PG hook timeout only.
* activity-routes: real `normalizeActivityLimit`.
* activity-service: polling deadline and hook timeout.
* adapter-routes: exact-set and exact-status assertions.
* adapter-routes-authz: `it.each` with side-effect assertions.
* adapter-session-codecs: negative-input tests.
* agent-action-audit-routes: rename, timeouts, warm-up.
* agent-adapter-validation-routes: separator-agnostic path, duplicate removed.
* agent-auth-jwt: 6 new negative and boundary cases.
* agent-cross-tenant-authz-routes: real authz.
* agent-device-login-routes: activity redaction, 2 new tests.
* agent-instructions-routes: real registry, env pin, warm-up.
* agent-instructions-service: path traversal tests.
* agent-live-run-routes: fixture helper, warm-up.

Deletions: none.

Commands run (repo root, one vitest process at a time, `npx vitest run <file>`):

* Final state: all 23 files pass (260 tests).
* Failures seen and classified ENV before the fixes: Postgres hook timeouts at 20 s (access-service, activity-service, activity-log-responsible-user, agent-action-audit-routes, access-routes-permissions-upgrade) and first-test import timeouts (hidden-floor 30 s, cross-tenant, instructions-routes, action-audit, permissions-upgrade).
* The original `HEAD` version of `agent-cross-tenant-authz-routes` was run once under a temporary file name (deleted afterwards) and failed 3 of 5 tests for the same ENV reason, confirming the failure was not introduced by this audit.

## 9 Approvals

| Role | Name | Signature | Date |
|---|---|---|---|
| Test author / auditor | ____________ | ____________ | ________ |
| Reviewer | ____________ | ____________ | ________ |
| Product owner | ____________ | ____________ | ________ |
