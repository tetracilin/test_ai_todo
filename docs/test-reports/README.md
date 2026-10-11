# Test-quality audit: index and roll-up

Scope: the full vitest suite run by `t3-nightly` slow-tests, audited against current `develop` of this hard fork of paperclipai/paperclip (not upstream behaviour). Each test file was judged for validity, rewritten where it fell short, and documented in one report per shard.

## Framework

Per-shard reports follow the IEEE 829 test summary report structure (identifier, scope and items tested, variances from plan, comprehensive assessment, summary of results, evaluation, summary of activities). It was chosen because it is a recognised, tool-neutral standard that separates what was tested, what deviated, and what the evidence supports. That makes each shard report comparable and auditable on its own, and this README rolls them up.

### Rubric V1-V9

| Code | Meaning |
|---|---|
| V1 | Stale or upstream assumption: the test encodes behaviour, names or ids that no longer exist in the fork |
| V2 | Weak or vacuous assertion: tautologies, widened matchers, early returns that pass with zero assertions |
| V3 | Timing and determinism: wall-clock dependence, fixed sleeps, iteration-bounded polling, random data |
| V4 | Isolation and leakage: unrestored stubs, env, globals, temp dirs, mock implementations |
| V5 | Over-mocking: hand-built mocks of the code under test or of whole modules that can rot |
| V6 | Clarity: misleading titles, oversized multi-assertion tests |
| V7 | Coverage gaps: missing negative and boundary paths |
| V8 | Portability: POSIX-only or platform-specific assumptions without a guard |
| V9 | Maintainability: duplication, dead helpers, hard-coded fixtures that will rot |

Verdicts per file: VALID, VALID_WITH_NOTES, REWRITTEN, OBSOLETE_REMOVED, NEEDS_DECISION.

## 1. Shard reports

| Shard | Files | Tests | VALID | NOTES | REWRITTEN | OBSOLETE | DECISION | Remark |
|---|---|---|---|---|---|---|---|---|
| [shared-01](shared-01.md) | 44 | 378 | 28 | 11 | 5 | 0 | 0 |
| [shared-02](shared-02.md) | 21 | 239 | 12 | 7 | 1 | 0 | 1 |
| [skills-catalog-01](skills-catalog-01.md) | 5 | 20 | 2 | 2 | 1 | 0 | 0 |
| [db-01](db-01.md) | 28 | 122 | 12 | 11 | 4 | 0 | 1 |
| [adapter-utils-01](adapter-utils-01.md) | 12 | 205 | 5 | 5 | 2 | 0 | 0 |
| [adapter-utils-02](adapter-utils-02.md) | 17 | 311 | 2 | 8 | 7 | 0 | 0 |
| [adapter-utils-03](adapter-utils-03.md) | 9 | 145 | 0 | 2 | 7 | 0 | 0 |
| [adapter-utils-04](adapter-utils-04.md) | 5 | 132 | 1 | 1 | 3 | 0 | 0 |
| [adapters-claude-local-01](adapters-claude-local-01.md) | 15 | 223 | 2 | 5 | 8 | 0 | 0 |
| [adapters-codex-local-01](adapters-codex-local-01.md) | 28 | 323 | 17 | 9 | 2 | 0 | 0 |
| [adapters-cursor-cloud-01](adapters-cursor-cloud-01.md) | 4 | 16 | 2 | 0 | 2 | 0 | 0 |
| [adapters-cursor-local-01](adapters-cursor-local-01.md) | 4 | 8 | 0 | 3 | 1 | 0 | 0 |
| [adapters-grok-local-01](adapters-grok-local-01.md) | 7 | 30 | 1 | 2 | 4 | 0 | 0 |
| [adapters-kimi-local-01](adapters-kimi-local-01.md) | 6 | 70 | 1 | 0 | 5 | 0 | 0 |
| [adapters-openclaw-gateway-01](adapters-openclaw-gateway-01.md) | 2 | 19 | 0 | 0 | 2 | 0 | 0 |
| [adapters-opencode-local-01](adapters-opencode-local-01.md) | 7 | 42 | 3 | 2 | 2 | 0 | 0 |
| [adapters-pi-local-01](adapters-pi-local-01.md) | 4 | 35 | 1 | 1 | 2 | 0 | 0 |
| [plugins-sdk-01](plugins-sdk-01.md) | 7 | 62 | 2 | 4 | 1 | 0 | 0 |
| [plugins-create-paperclip-plugin-01](plugins-create-paperclip-plugin-01.md) | 1 | 2 | 0 | 0 | 1 | 0 | 0 |
| [server-01](server-01.md) | 23 | 260 | 2 | 6 | 15 | 0 | 0 |
| [server-02](server-02.md) | 24 | 265 | 10 | 10 | 4 | 0 | 0 |
| [server-03](server-03.md) | 18 | 238 | 6 | 5 | 7 | 0 | 0 |
| [server-04](server-04.md) | 19 | 244 | 6 | 5 | 7 | 0 | 1 |
| [server-05](server-05.md) | 15 | 172 | 4 | 7 | 4 | 0 | 0 |
| [server-06](server-06.md) | 12 | 154 | 1 | 10 | 1 | 0 | 0 |
| [server-07](server-07.md) | 18 | 224 | 3 | 4 | 11 | 0 | 0 |
| [server-08](server-08.md) | 28 | 268 | 9 | 12 | 7 | 0 | 0 |
| [server-09](server-09.md) | 5 | 129 | 0 | 2 | 3 | 0 | 0 |
| [server-10](server-10.md) | 6 | 156 | 1 | 2 | 3 | 0 | 0 |
| [server-11](server-11.md) | 15 | 204 | 5 | 3 | 7 | 0 | 0 |
| [server-12](server-12.md) | 20 | 230 | 2 | 6 | 11 | 0 | 1 |
| [server-13](server-13.md) | 14 | 124 | 5 | 3 | 6 | 0 | 0 |
| [server-14](server-14.md) | 3 | 159 | 1 | 2 | 0 | 0 | 0 |
| [server-15](server-15.md) | 19 | 154 | 7 | 10 | 2 | 0 | 0 |
| [server-16](server-16.md) | 31 | 344 | 16 | 10 | 5 | 0 | 0 |
| [server-17](server-17.md) | 11 | 184 | 1 | 4 | 6 | 0 | 0 |
| [server-18](server-18.md) | 11 | 232 | 2 | 6 | 3 | 0 | 0 |
| [server-19](server-19.md) | 18 | 226 | 8 | 6 | 4 | 0 | 0 |
| [server-20](server-20.md) | 10 | 172 | 2 | 5 | 3 | 0 | 0 |
| [server-21](server-21.md) | 10 | 175 | 4 | 3 | 3 | 0 | 0 |
| [server-22](server-22.md) | 31 | 219 | 11 | 11 | 7 | 0 | 2 |
| [server-23](server-23.md) | 27 | 256 | 13 | 12 | 2 | 0 | 0 |
| [server-24](server-24.md) | 30 | 286 | 8 | 11 | 11 | 0 | 0 |
| [server-25](server-25.md) | 16 | 241 | 7 | 7 | 2 | 0 | 0 |
| [server-26](server-26.md) | 20 | 252 | 8 | 7 | 5 | 0 | 0 |
| [server-27](server-27.md) | 11 | 169 | 4 | 2 | 5 | 0 | 0 |
| [server-28](server-28.md) | 3 | 143 | 1 | 2 | 0 | 0 | 0 |
| [server-29](server-29.md) | 22 | 241 | 5 | 10 | 7 | 0 | 0 |
| [server-30](server-30.md) | 4 | 36 | 1 | 2 | 1 | 0 | 0 |
| [server-31](server-31.md) | 2 | 144 | 0 | 1 | 1 | 0 | 0 |
| [server-32](server-32.md) | 45 | 434 | 19 | 16 | 10 | 0 | 0 |
| [server-33](server-33.md) | 14 | 218 | 5 | 1 | 7 | 0 | 1 |
| [ui-01](ui-01.md) | 45 | 301 | 22 | 10 | 12 | 0 | 1 |
| [ui-02](ui-02.md) | 45 | 327 | 24 | 15 | 6 | 0 | 0 |
| [ui-03](ui-03.md) | 17 | 216 | 5 | 5 | 7 | 0 | 0 |
| [ui-04](ui-04.md) | 10 | 279 | 2 | 7 | 1 | 0 | 0 |
| [ui-05](ui-05.md) | 34 | 278 | 15 | 12 | 6 | 0 | 1 |
| [ui-06](ui-06.md) | 36 | 254 | 30 | 4 | 1 | 0 | 1 |
| [ui-07](ui-07.md) | 36 | 382 | 26 | 6 | 4 | 0 | 0 |
| [ui-08](ui-08.md) | 45 | 388 | 30 | 8 | 7 | 0 | 0 |
| [ui-09](ui-09.md) | 45 | 511 | 26 | 7 | 12 | 0 | 0 |
| [ui-10](ui-10.md) | 45 | 365 | 28 | 10 | 7 | 0 | 0 |
| [ui-11](ui-11.md) | 42 | 436 | 27 | 7 | 8 | 0 | 0 |
| [ui-12](ui-12.md) | 22 | 180 | 17 | 4 | 1 | 0 | 0 |
| [ui-13](ui-13.md) | 18 | 199 | 3 | 8 | 6 | 0 | 1 |
| [ui-14](ui-14.md) | 24 | 227 | 2 | 8 | 14 | 0 | 0 |
| [ui-15](ui-15.md) | 14 | 73 | 4 | 5 | 5 | 0 | 0 |
| [cli-01](cli-01.md) | 45 | 239 | 9 | 10 | 24 | 0 | 2 |
| [cli-02](cli-02.md) | 12 | 158 | 4 | 4 | 4 | 0 | 0 |

All 69 shards have a report file. adapters-claude-local-01 and server-31 were written after the main run (their audit results came back without a report); adapters-claude-local-01 uses the file evidence (8 rewritten files) instead of the audit agent's original 2/6/7 verdict counts.

## 2. Totals

- Shards reported: 69
- Test files: 1316
- Tests: 14148
- Verdicts (per file): VALID 542, VALID_WITH_NOTES 407, REWRITTEN 354, OBSOLETE_REMOVED 0, NEEDS_DECISION 13
- Files classified: 1316 of 1316
- Files rewritten: 354 (26.9% of files); no file was deleted as obsolete.
- By area: shared 2 shards, 65 files, 617 tests; skills-catalog 1 shards, 5 files, 20 tests; db 1 shards, 28 files, 122 tests; adapter-utils 4 shards, 43 files, 793 tests; adapters 9 shards, 77 files, 766 tests; plugins 2 shards, 8 files, 64 tests; server 33 shards, 555 files, 6953 tests; ui 15 shards, 478 files, 4416 tests; cli 2 shards, 57 files, 397 tests.

## 3. Cross-cutting defect themes

Counts are shards whose `topDefects` cite the theme, taken from the shard summaries; they are lower bounds, not exhaustive tallies.

| Theme | Shards citing | Typical fix |
|---|---|---|
| V4 leaked state (unrestored fetch/env/spies/DOM/temp dirs, `clearAllMocks` leaving implementations) | at least 30 (shared-01, adapter-utils-01/03, claude-local, pi-local, server-04/08/09/11/12/13/20/21/24/26/27/29, ui-01/02/03/04/05/08/09/10/12/13/15, cli-01/02) | restore in `afterEach`/`finally`, `unstubAllGlobals`, `resetAllMocks` |
| V8 POSIX or Windows-only assumptions without a guard | about 26 (shared-02, skills-catalog, adapter-utils-01 to 04, claude-local, codex-local, cursor-local, plugins-sdk, create-plugin, server-04/05/07/12/22/23/26/29/31/32/33, ui-11, cli-01/02) | `skipIf`/`runIf`, `path.resolve`, junctions |
| V3 timing: fixed sleeps, iteration-bounded `waitForAssertion` (the class fixed for CompanySettings in #161), wall-clock comparisons, cold-import timeouts | widespread, most UI shards plus about 20 server shards | time-bounded `vi.waitFor`, fake timers, warm-up `beforeAll` |
| V2 vacuous assertions: widened `[200,201]`-style matchers, bare `toThrow()`, `toBeDefined`, silent early returns | widespread across server and UI | exact status and error assertions, `ctx.skip` |
| V5 hand-built mocks of the module under test or of whole barrels (`services/index.js`, adapter registry, execution target) | about 20 | `importOriginal` partial mocks |
| V7 missing negative and boundary tests | about 25 | tests added |
| V1 stale upstream or removed-adapter references | shared-01, adapter-utils-01, server-02/11/16/22, cli-01, ui-06 | updated or flagged for decision |
| Wrong embedded-Postgres teardown (`started.stop` where only `cleanup()` exists) | server-04, 08, 13, 29 | call `cleanup()` |
| Tests that never run (outside vitest include, or skipped everywhere) | db-01 (`packages/db/scripts/*.test.ts`, scheduling migration test), claude-local/codex-local/opencode-local (stale `dist/**/*.test.js` collected) | fix includes and excludes |

## 4. Production findings needing a product decision

These are suspected production or policy issues. Tests were not bent to hide them.

Fork identity and upstream coupling
1. Telemetry defaults to on and `DEFAULT_ENDPOINTS` in `packages/shared/src/telemetry/client.ts` point at upstream hosts (`telemetry.paperclip.ing`, an AWS API Gateway URL). Decide: default off or replace endpoints (shared-01, server-27).
2. `feedback-share-client` defaults to `https://telemetry.paperclip.ing` and `index.ts` always wires it, so opted-in feedback traces would go upstream; feedback destination `paperclip_labs_feedback_v1` also needs confirming (server-12, cli-01).
3. `SidebarAccountMenu.tsx` `SOURCE_REPOSITORY_URL` still points at upstream `paperclipai/paperclip` (ui-06).
4. CLI channels, install and update resolve upstream npm dist-tags and default to GitHub `paperclipai/paperclip`, but `doc/ORIGIN.md` says the fork does not publish to npm. The recovery hint `npx paperclipai run` cannot work (cli-01).
5. `services/pipelines.ts` `buildCaseDeepLink` hard-codes the upstream `/PAP/` company prefix, so drift-notice links are dead for other companies (server-22).
6. Cloud-managed code paths (Paperclip Cloud settings flows, cloud-tenant floors, Kubernetes execution policy, Daytona sandbox, `health.ts` cloud branch) are retained from upstream and tested; confirm they remain in fork scope (ui-13, server-09, server-12, server-32).
7. `teams-catalog` and CLI import default bundled or process agents to `claude_local`; confirm against the selectable-adapter policy (server-27, cli-01).
8. `.agents/` is gitignored but 41 files are tracked; untracked `teable-assistant-ops/SKILL.md` exceeds the 300-char description cap (skills-catalog-01).

Hermes-only policy conflicts
9. `routes/access.ts` still has OpenClaw accept, replay and normalize branches and onboarding text advertises `openclaw_gateway`, though `requireSoleAgentAdapterType` allows only `hermes_gateway`. Remove or relax (server-16).
10. `InviteLanding.tsx` initialises `adapterType` to `claude_local` while the only option is `hermes_gateway`; the accept call sends `claude_local`. Suspected bug (ui-13).
11. `NewAgentDialog` shows "No agent runtime is available" with real modules because `hermes_gateway` is `hideFromVisualSelection`; the committed test passes only through a mock. Onboarding wizard may be affected (ui-05).

Windows support (one decision covers several findings)
12. Decide whether Windows is a supported host. If yes, fix: port-registry `writeRegistryLockOwner` rename EPERM (shared-02, server-31); CLI `durableCopyFile` fsync EPERM and colon in install lock filename (cli-01); `sandbox-orphan-cleanup-spool` directory fsync (server-25); `codex_local` hello probe wrapped in `sh -c` so `.cmd` wrappers fail (server-04); `session-workspace-cwd` using platform `path.normalize` on POSIX paths so `/` is not rejected (server-33); `path.posix` confinement in remote-managed-runtime (adapter-utils-03); `hot-restart` 1500 ms pwsh timeout (server-32); `packLocalPackage` without a shell (create-plugin). If no, `skipIf(win32)` and document it.

Behaviour and contract questions
13. `nameOverrides` equal to an existing agent name plans a duplicate create; test pins this as a known limitation (server-06).
14. OpenAPI document and route-coverage gate omit fork routes (issue subtasks, evidence-links upload, dossier scope-changes, Discord, scheduling, artifacts, WOPI); the coverage test is red. Document them or add exclusions (server-22).
15. `issuesApi.stopActiveRun` posts to a route the server does not define; no UI caller (ui-01).
16. `local-process-sandbox.ts` throws the Linux-only error before validating options (adapter-utils-02).
17. `startup-timing` pins a known AsyncLocalStorage store leak as expected behaviour; invert when fixed (adapter-utils-02).
18. Cross-issue influence limit switches from `log_only` to enforce by hard-coded date 2026-08-11; the `log_only` branch is dead (server-07, server-20).
19. `execution-workspace` repair seed failure surfaces as an untyped 500 (server-11); `routines-e2e` helper retries on HTTP 500, masking an intermittent error (server-24); unused `EnvironmentErrorCode` values (server-09).
20. `isDatabaseConnectionUnavailableError` recurses `error.cause` without a depth guard (server-12); `createRequestPromiseMemo` is keyed by request identity only (server-32).
21. `mcp-isolation` Claude version gate is `^2.1.x` with patch minimum 207 and will fail on 2.2+ (adapter-utils-03); `login-runner-lifecycle` dispose contract is untestable in this package (adapter-utils-03).
22. `skills-releases` hash pins fail under autocrlf checkouts; consider `eol=lf` (server-07).
23. Error-payload field precedence differs across grok-local parse files (adapters-grok-local-01); `describeRunRetryState` joins text with a bare space (ui-10); `nextCronFires` builds a formatter per minute (ui-09).

CI and test-infrastructure follow-ups (each needs its own ci or test PR)
24. `packages/db/vitest.config.ts` excludes `scripts/*.test.ts`; embedded-PG tests use 20-30 s hook timeouts that fail on slow hosts (db-01, server-29).
25. Bubblewrap isolation tests need `PAPERCLIP_TEST_BWRAP`, which no workflow sets (adapter-utils-02).
26. claude-local, codex-local and opencode-local vitest runs collect stale `dist/**/*.test.js` copies.
27. `forbidden-tokens` fails to load on CRLF checkouts of `scripts/check-forbidden-tokens.mjs` (server-12).

## 5. Rewritten files reverted by the verifier

- `cli/src/__tests__/company-import-transfer.test.ts` (cli-01): the rewrite was reverted by the verifier. The file is back at its `develop` content, so the defects found there (V3 timeouts on 40-64 MB fixtures, V4 leaked fetch stub) are not fixed.
- Reverted by the author before verification (not verifier reverts): `NewAgentDialog.test.tsx` mock removal (ui-05, revealed a real failure), `company-search-service` fix (server-06, unverifiable on Windows), an `os.tmpdir()` output attempt in create-paperclip-plugin.

All other shards reported `reverted: []`.

## 6. Shards with no result (unaudited)

Shards that returned `[]` are unaudited: no file in them was reviewed, and their tests carry no verdict. The roll-up data contained results for all 69 shards listed above, so none are known to be empty. Any shard missing from the table in section 1 should be treated as unaudited, not as passing.

## 7. Limits of this audit

- The audit ran on Windows 11. Pass and fail evidence for files that were not edited comes from the `t3-nightly` CI on Linux, not from this audit; local ENV failures (symlink EPERM, missing `/bin/sh`, `tar` drive letters, CRLF) were classified and not treated as defects.
- Embedded Postgres did not start within the hard-coded 20-30 s hooks on this host, so database-backed tests in most server shards and in db-01 were reviewed statically only. Edits to them are unverified until `t3-nightly` runs.
- Edits to POSIX-only files could only be checked by typecheck and collection. They need confirmation on Linux.
- Some large files were reviewed by structural scan rather than line by line (noted in ui-04, ui-06, ui-07, ui-11, ui-12).
- Each shard's counts are as reported by its auditor. Some shards classified fewer files than they contain (see Remark column), and a few rewritten-file lists disagree with the REWRITTEN count (adapter-utils-02 lists 8 against 7, server-01 lists 17 files against a count of 15). The per-shard report is authoritative; cli-02's own report has an internal count mismatch (section 2 text versus section 5 table; the table values are used here).
- Reports for adapters-claude-local-01 and server-31 were regenerated after the main run from the audit journal and the working-tree diff.
- Nothing here was committed or pushed by this audit step.
