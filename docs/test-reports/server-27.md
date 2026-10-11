# Test Summary Report: shard server-27 (IEEE 829)

## 1 Report identifier and scope
- Report id: server-27. Project: server (vitest). Date: see git.
- Files: 11. Test cases: 169 (teable-client counts 46 because one `it.each` expands to 7 cases).
- Subject areas: Teable client/append/read/mirror (+ routes), teams-catalog (service, routes, installs), shared TelemetryClient flush, tool-access policy service.

## 2 Summary
All 11 files were read in full and checked against current source (`services/teable-*.ts`, `teams-catalog.ts`, `tool-access-policy.ts`, `packages/shared/src/telemetry/client.ts`). No test asserts removed upstream-only behaviour. Five files were improved in place with minimal edits; none deleted.
Verdicts: VALID 4, VALID_WITH_NOTES 2, REWRITTEN 5, OBSOLETE_REMOVED 0, NEEDS_DECISION 0.

## 3 Variances
- Windows host: embedded Postgres suites (teable-append-routes, teable-mirror, teable-read-routes, teams-catalog-install-no-overrides, tool-access-policy-service) did not execute (7/7 skipped after ~30-60s support probe / start timeout; classified ENV). Their assertions were verified by reading against source only.
- teable-read-routes edit was a test-title rename only; teable-append-routes untouched.

## 4 Comprehensive assessment (defects by rubric code)
- V1 (1): telemetry test pins default ingest URLs that are upstream Paperclip hosts (see section 7).
- V2 (2): "checks once" claim without assertion (teable-client); default-adapter warning asserted only negatively (teams-catalog-service).
- V3 (1): teable-mirror failure/backoff test uses real `new Date()` because DB stamps createdAt; documented in-test, left.
- V4 (2): `logger.warn` spies restored inline only (teable-append); `vi.stubGlobal("fetch")` never unstubbed (telemetry).
- V5 (0). V6 (2): misleading titles (teable-read-routes "never calls Teable", teable-client "checks once"). V7 (2): see 7. V8 (0). V9 (2): hard-coded catalog content hash in teams-catalog-service; repeated fake secret helpers across teable tests.

## 5 Summary of results
| File | Tests | Verdict | Defects | Action |
|---|---|---|---|---|
| server/src/__tests__/teable-append-routes.test.ts | 7 | VALID | - | none (PG, skipped on host) |
| server/src/__tests__/teable-append.test.ts | 16 | REWRITTEN | V4 | added afterEach restoreAllMocks for warn spy; 16/16 pass |
| server/src/__tests__/teable-client.test.ts | 46 | REWRITTEN | V2,V6 | private-network test now asserts DNS lookup not called, title corrected; pass |
| server/src/__tests__/teable-mirror.test.ts | 7 | VALID_WITH_NOTES | V3 | none (real-clock dependence documented; PG, skipped) |
| server/src/__tests__/teable-read-routes.test.ts | 9 | REWRITTEN | V6 | title of 422 test corrected (fake service throws; route cannot assert Teable not called) |
| server/src/__tests__/teable-read.test.ts | 8 | VALID | - | none; pass |
| server/src/__tests__/teams-catalog-install-no-overrides.test.ts | 4 | VALID | - | none (PG, skipped) |
| server/src/__tests__/teams-catalog-routes.test.ts | 8 | VALID | - | none; pass |
| server/src/__tests__/teams-catalog-service.test.ts | 24 | REWRITTEN | V2,V9 | added positive default-adapter-warning assertion; pass |
| server/src/__tests__/telemetry-client-flush.test.ts | 5 | REWRITTEN | V1,V2,V4 | unstub globals; idempotency test now verifies single flush; pass |
| server/src/__tests__/tool-access-policy-service.test.ts | 35 | VALID_WITH_NOTES | V7 | none (PG, skipped) |


## 6 Per-test detail (non-clean tests)
| File | Test | Code | Finding | Action |
|---|---|---|---|---|
| teable-append.test.ts | bot attribution (3 tests) | V4 | spy restored only on success path | afterEach restore added |
| teable-client.test.ts | allows the self-hosted sibling container ... | V2/V6 | title said "checks once" with no assertion; actual guard short-circuits when private allowed (lookup never called) | assertion added, title fixed |
| teable-read-routes.test.ts | maps a service allowlist refusal to 422 | V6 | old title claimed "never calls Teable", unverifiable at route level | renamed |
| teable-read-routes.test.ts | maps an upstream not-found ... 502 | V9 | only exercises errorHandler with a thrown HttpError | noted |
| teable-mirror.test.ts | writes an activity_log entry on failure ... | V3 | uses real clock | noted |
| teams-catalog-service.test.ts | injects safe claude_local adapter defaults | V2 | warning only asserted absent elsewhere | positive assertion added |
| teams-catalog-service.test.ts | listInstalledCatalogTeams (stale hash) | V9 | hard-coded sha256 of core-exec-team; breaks on any catalog edit | noted |
| telemetry-client-flush.test.ts | startPeriodicFlush is idempotent | V2 | asserted nothing | now asserts exactly one flush per tick |
| telemetry-client-flush.test.ts | both describes | V4 | stubGlobal fetch leaked | vi.unstubAllGlobals added |

## 7 Evaluation and recommendations
Product findings:
1. PRODUCT: `packages/shared/src/telemetry/client.ts` still defaults to `https://telemetry.paperclip.ing/ingest` and an upstream AWS gateway. In a hard fork this sends install telemetry to upstream-owned hosts unless an endpoint is configured or telemetry disabled. Test faithfully pins it; owner decision needed (not changed here).
2. `teams-catalog.ts` defaults bundled team agents to `claude_local` (override via PAPERCLIP_TEAMS_CATALOG_DEFAULT_ADAPTER_TYPE). Tests agree with code; confirm this matches the fork's selectable-adapter default policy.
Coverage gaps: teable-mirror (no test for hidden issues / table-secret change), teams-catalog-routes (no 404 for unknown slug, no board-without-permission install case), tool-access-policy (no test for deleted catalog entry or cross-company policy decide). Shared fake-secrets helper could be hoisted into `helpers/` (V9).

## 8 Summary of activities
- Rewritten: teable-append (spy cleanup), teable-client (assertion/title), teable-read-routes (title), teams-catalog-service (+assertion), telemetry-client-flush (cleanup, stronger idempotency test).
- Deletions: none.
- Commands: `npx vitest run` on teable-client, teable-append, teable-read, teams-catalog-routes, teams-catalog-service, telemetry-client-flush: 6 files / 107 tests pass. First run of teable-client failed (my wrong assumption that lookup is called once); corrected after reading `remote-http-endpoint-guard.ts` (REAL assumption error, fixed). PG-backed files: skipped on this host (ENV).

## 9 Approvals
Prepared by: ____________  Reviewed by: ____________  Date: ________
