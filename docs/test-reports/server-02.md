# Test Summary Report: shard server-02 (IEEE 829 structure)

## 1 Report identifier and scope

- Report id: server-02
- Project: @paperclipai/server (vitest project "server"), t3-nightly slow-tests audit
- Files: 24 (all under `server/src/__tests__/`)
- Test cases: 265 (it/test; the `nonSelectableAdapterCases` loops in agent-permissions-routes expand to 8 cases, included)
- Date: see git
- Audited against: current fork `develop` lineage (branch test/slow-tests-audit). Fork policy is authoritative (selectable adapters hermes_gateway + claude_local + hermes_local).

## 2 Summary

Every file was read in full and checked against its production source (services/agent-permissions, services/agents, services/approvals, services/secrets, routes/agents, routes/approvals, routes/assets, routes/issues, routes/artifacts, routes/wopi, middleware/api-compression, app.ts, attachment-types, adapters/registry).

Headline verdict counts: VALID 10, VALID_WITH_NOTES 10, REWRITTEN 4, OBSOLETE_REMOVED 0, NEEDS_DECISION 0.

No test asserts upstream-only behaviour. The one V1 drift found was stale explanatory text in agent-permissions-routes (comments and two titles still said "Hermes Gateway is the sole selectable adapter", "gateway-only since c1ffeec67" and "default set is hermes_gateway + claude_local"), whereas `listSelectableServerAdapters()` now defaults to hermes_gateway, claude_local, hermes_local. Assertions were unaffected (none of the non-selectable cases is hermes_local) but the text would mislead.

The main V2 defect was widened status matchers: `expect([200, 201]).toContain(status)` in 9 places across 4 files, where the routes unconditionally return 201. These now assert 201.

## 3 Variances

- Windows host: all 9 embedded-Postgres-backed suites marked PG in section 5 could not run here. `startEmbeddedPostgresTestDatabase` in `beforeAll` hit its 20-30 s hook timeout, so their PG-dependent cases (91) were reported "skipped" by vitest (ENV). They were reviewed statically only. No edits were made to them because changes could not be verified.
- Cold-start timeouts (ENV): the first test in agent-permissions-routes (20 s budget), agent-skills-routes (10 s and 20 s budgets), approval-routes-idempotency (20 s) and assets (default) intermittently time out on this machine, because the first `import("../routes/agents.js")` after `vi.resetModules()` is slow under Windows plus contention from parallel agents. On re-runs each file passes except for that cold test; all other cases pass. Not a REAL failure (the same tests passed in other runs, e.g. permissions-routes 50/50 and assets 8/8 in some runs).
- No POSIX-only failures were observed in non-PG files (`/tmp/...` strings in fixtures are inert data).

## 4 Comprehensive assessment (cross-cutting defects)

| Code | Count | Notes |
|---|---|---|
| V1 Validity | 1 file (7 text locations) | Stale "gateway-only" and "only selectable adapter" comments and 2 titles in agent-permissions-routes; fixed |
| V2 Meaningful assertions | 9 widened `[200,201]` matchers (4 files); 6 `rejects.toBeTruthy()/toThrow()` with no message or status | `[200,201]` fixed. Weak rejects left (see section 6) because the PG suites could not be run to verify tightened expectations |
| V3 Determinism | 1 | agents-claude-oauth-binding lock test uses a real 600 ms sleep against a 300 ms DB deadline (bounded, intentional) |
| V4 Isolation | 0 blocking | Env var and tmpdir restored in all PG suites; module registry reset in route suites |
| V5 Mock fidelity | 8 files | Hand-built `../services/index.js` stand-ins (agent-skills-routes, agent-permissions-routes, agent-test-environment-routes, agents-adapter-config-user-secret, approval-routes-idempotency, artifact-review-document-routes, assets) and hand-built drizzle stubs (approvals-service). These can rot when a route starts importing a new barrel export (the known past failure mode). Not changed: switching to `importOriginal` partials is a larger refactor than a targeted fix |
| V6 Clarity | 3 | `beforeEachActor` helper is misnamed (it sets the actor); the OAuth "resolves the bound reference" test does not assert resolution; assets "within the general attachment limit" uses 150 KB with no boundary case |
| V7 Coverage | see section 7 | |
| V8 Portability | 0 | `fs`/`os.tmpdir`/`path` used correctly; no sh or signals |
| V9 Maintainability | 2 | agent-skills-routes registers mocks twice (top-level `vi.mock` and `registerModuleMocks`) and the copies have drifted (`environmentService` only in one); repeated actor literals in permissions-routes |

## 5 Summary of results

PG = needs embedded Postgres (not runnable here, static review only).

| File | Tests | Verdict | Defect codes | Action taken |
|---|---|---|---|---|
| agent-permissions-routes.test.ts | 50 | REWRITTEN | V1, V2, V5 | `[200,201]` to 201 (2 places); refreshed 7 stale text locations about the selectable adapter set. Run: 49/50 pass, first test cold-start timeout (ENV) |
| agent-permissions-service.test.ts | 5 | VALID | - | none. 5/5 pass |
| agent-secrets-routes.test.ts | 4 | VALID_WITH_NOTES | V7 | PG, static review only. Good negative paths (low-trust, task_bridge, skill_test, unbound key) |
| agent-shortname-collision.test.ts | 8 | VALID | - | none. 8/8 pass |
| agent-skill-contract.test.ts | 2 | VALID | - | none. 2/2 pass |
| agent-skills-routes.test.ts | 29 | REWRITTEN | V2, V5, V9 | 5x `[200,201]` to 201. Run: 27/29 pass, 2 cold-start timeouts on the first tests (ENV) |
| agent-test-environment-routes.test.ts | 7 | VALID_WITH_NOTES | V5 | 7/7 pass. Hand-built services barrel mock |
| agents-adapter-config-user-secret.test.ts | 5 | VALID_WITH_NOTES | V5, V6 | PG. `beforeEachActor` misnamed; barrel mock hand-built |
| agents-claude-oauth-binding.test.ts | 42 | VALID_WITH_NOTES | V2, V3, V6 | 14 pure tests pass; 28 PG tests static only. See section 6 |
| agents-pending-approval-config.test.ts | 1 | VALID_WITH_NOTES | V7 | PG. Single combined scenario (freeze plus reapply) |
| agents-service-clear-error.test.ts | 3 | VALID | - | PG, static review only. Messages match `agentService.clearError` |
| agents-service-secret-bindings.test.ts | 9 | VALID_WITH_NOTES | V2 | PG. Three `rejects.toBeTruthy()` |
| api-compression.test.ts | 10 | VALID | - | none. 10/10 pass; ephemeral ports (listen 0) |
| app-hmr-port.test.ts | 7 | VALID | - | none. 7/7 pass |
| app-private-hostname-gate.test.ts | 4 | VALID | - | none. 4/4 pass |
| app-vite-dev-routing.test.ts | 3 | VALID | - | none. 3/3 pass |
| approval-routes-idempotency.test.ts | 11 | REWRITTEN | V2, V5 | `[200,201]` to 201. Run: 10/11, first test cold-start timeout (ENV) |
| approvals-service.test.ts | 6 | VALID_WITH_NOTES | V5 | 6/6 pass. Hand-built drizzle chain stub couples to query shape |
| artifact-review-document-routes.test.ts | 6 | VALID_WITH_NOTES | V5 | 6/6 pass. Large hand-built services barrel mock |
| artifact-review-documents-service.test.ts | 11 | VALID_WITH_NOTES | V7 | PG, static only |
| artifact-routes-authz.test.ts | 3 | VALID | - | 3/3 pass (empty `{}` db/storage proves rejection happens before resource access) |
| artifact-service.test.ts | 8 | VALID_WITH_NOTES | V7 | PG, static only |
| assets.test.ts | 8 | REWRITTEN | V2, V6 | 2x `[200,201]` to 201. Run: 8/8 pass on re-run |
| attachment-types.test.ts | 23 | VALID | - | none. 23/23 pass |

## 6 Per-test detail (tests that are not clean)

| File | Test | Code | Finding | Action |
|---|---|---|---|---|
| agent-permissions-routes | "creates agents when optional adapter model profile discovery fails" | V1 | Comment claimed gateway-only selection since a commit hash | Comment rewritten; assertions unchanged |
| agent-permissions-routes | "rejects opencode agent creation because Hermes Gateway is sole..." | V1 | Title wrong: claude_local and hermes_local are also selectable | Renamed to "...because it is not selectable..." |
| agent-permissions-routes | "rejects manual opencode provider/model values because Hermes Gateway is sole..." | V1 | Same | Renamed |
| agent-permissions-routes | nonSelectableAdapterCases comment | V1 | Said default set is hermes_gateway + claude_local | Updated to include hermes_local |
| agent-permissions-routes | "rejects switching an agent away from an SSH-capable runtime..." | V1 | Comment "only selectable adapter today is hermes_gateway" | Comment corrected |
| agent-permissions-routes | "grants tasks:assign by default when board creates a new agent", "normalizes direct agent creation to disable timer heartbeats by default" | V2 | `[200,201]` | Now `toBe(201)` |
| agent-permissions-routes | "redacts agent detail for authenticated company members..." (first test) | ENV | 20 s timeout on cold import on Windows | none |
| agent-skills-routes | "persists canonical desired skills when creating an agent directly", "accepts the security role on direct agent creation...", "materializes a managed AGENTS.md...", "materializes the bundled CEO instruction set...", "materializes the bundled default instruction set..." | V2 | `[200,201]` | Now `toBe(201)` |
| agent-skills-routes | first two tests | ENV | 10 s / 20 s timeouts on cold import | none |
| agent-skills-routes | whole file | V9, V5 | Duplicate mock registration with drift | Noted |
| approval-routes-idempotency | "lets agents create generic issue-linked board approval requests" | V2 | `[200,201]` | Now `toBe(201)` |
| assets | "accepts PNG image uploads and returns an asset path", "allows supported non-image attachments outside the company logo flow" | V2 | `[200,201]` | Now `toBe(201)` |
| assets | "allows logo uploads within the general attachment limit" | V6, V7 | Title implies a boundary test but uses 150 KB; no exact `MAX_ATTACHMENT_BYTES` accept case | Noted |
| agents-adapter-config-user-secret | all | V6 | `beforeEachActor()` only sets `currentActor` | Noted (rename deferred, PG unverified) |
| agents-claude-oauth-binding | "resolves the bound reference to the stored value without leaking it in a log" | V6, V2 | Name promises runtime resolution; body asserts only declaration count and no token in definitions | Noted; rename or add a resolution assertion |
| agents-claude-oauth-binding | "inserts no binding when the claim row lock holds until after the deadline" | V3 | Real 600 ms sleep vs 300 ms DB-side expiry | Noted (bounded) |
| agents-claude-oauth-binding | "writes no secret for an expired claim", "writes no secret for an already-consumed claim", "rolls back the transition..." | V2 | `rejects.toThrow()` without message or status | Noted |
| agents-service-secret-bindings | "rolls back create when binding sync fails", "rolls back adapterConfig updates when binding sync fails", "keeps pending approval status when activation binding sync fails" | V2 | `rejects.toBeTruthy()` accepts any error, including unrelated ones | Noted; tighten to the expected HttpError status once runnable on PG |
| agent-secrets-routes | "fails closed when run redaction registration cannot be persisted" | V7 | Only one failure mode (unknown run id) | Noted |

## 7 Evaluation and recommendations

Product findings: none. No suspected production bug, and no test was bent to pass.

Recommendations:
1. Replace hand-built `../services/index.js` mocks (7 files) with `importOriginal` partials or a shared helper, so new barrel exports do not break suites silently (V5).
2. Cold-start robustness: the first test in each `vi.resetModules()` route suite pays the full `routes/agents.js` import. A warm-up import in `beforeAll` (outside the per-test timeout) would remove the Windows flake without weakening any assertion.
3. Tighten the `rejects.toBeTruthy()` and `rejects.toThrow()` cases in the secret-binding and OAuth-binding suites to assert HTTP status or message once they can be verified against embedded Postgres.
4. Coverage gaps (not added, no clear cheap test): attachment upload at exactly `MAX_ATTACHMENT_BYTES`; hermes_local (now in the default selectable set) has no positive creation case in this shard, so confirm one exists in agent-adapter-validation-routes.
5. The PG-backed cases (91) should be confirmed green in t3-nightly (Linux), since they were not runnable here.

## 8 Summary of activities

Files rewritten:
- `server/src/__tests__/assets.test.ts`: two widened `[200,201]` assertions made exact (201).
- `server/src/__tests__/approval-routes-idempotency.test.ts`: one widened status assertion made exact (201).
- `server/src/__tests__/agent-skills-routes.test.ts`: five widened status assertions made exact (201).
- `server/src/__tests__/agent-permissions-routes.test.ts`: two widened status assertions made exact; stale policy comments and two test titles updated to the current default selectable adapter set.

Deletions: none.

Commands run (from repo root):
- `pnpm --filter @paperclipai/plugin-sdk ensure-build-deps` (ok)
- `npx vitest run <all 24 shard files> --reporter=json`: all non-PG tests pass except 2 cold-start timeouts (assets first test, agent-skills-routes first test); PG cases skipped by hook timeout (ENV)
- `npx vitest run server/src/__tests__/assets.test.ts`: 8/8 pass
- `npx vitest run server/src/__tests__/approval-routes-idempotency.test.ts`: 10/11, first test cold-start timeout (ENV); edited test passes
- `npx vitest run server/src/__tests__/agent-skills-routes.test.ts`: 27/29, two cold-start timeouts (ENV); the 5 edited tests pass
- `npx vitest run server/src/__tests__/agent-permissions-routes.test.ts`: 49/50, first test cold-start timeout (ENV); the edited tests pass

## 9 Approvals

Prepared by: ______________________  Date: __________

Reviewed by: ______________________  Date: __________

Approved by: ______________________  Date: __________
