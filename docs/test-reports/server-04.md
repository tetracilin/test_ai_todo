# Test Summary Report: shard server-04 (IEEE 829)

## 1 Report identifier and scope
- Report id: server-04
- Project: server (vitest project `@paperclipai/server`, directory `server/src/__tests__/`)
- Files: 19 | Test cases: 244 (after edits). Counting note: 239 `it` statements; `it.each` expansions add cases: codex-device-login-service 1 statement expands to 3 rows (+2), cloud-instance 1 statement expands to 4 rows (+3, introduced by the rewrite); cloud-image-bundled-plugins 1 `it.each` expands to 1 row (Dockerfile default is `daytona`).
- Date: see git

## 2 Summary
Every file was read in full and checked against its production module (built-in agent registry, bundled plugin catalog, change-consent gate, claude_local and codex_local adapters, codex device-login service and reaper, cloud instance and routes, access/CLI-auth routes, cases routes, company/agent removal services). Fork policy checked: built-in agent allowed adapter types and defaults (`claude_local` Haiku for the summarizer), cloud sandbox bundled-plugin catalog vs Dockerfile `CLOUD_BUNDLED_PLUGINS`, and the safe `npx` CLI invocation policy. No test was found asserting upstream-only behaviour or a stale default; the registry-default class of defect (V1) did not occur in this shard.

Real defects found and fixed: a leaked embedded Postgres instance (`started.stop` does not exist on the helper, which exposes `cleanup`), a repo-walk guard that scanned nested agent worktrees (30+ false offenders and two 20 s timeouts), a pure unit test that was silently skipped together with the embedded-Postgres suite, a host-timezone-dependent fake clock, a tautological assertion block, an assertion that cannot fail (`toBeDefined` on a promise result), an iteration-count poll, and Windows path/junction assumptions in the bundled-plugin tests.

One suspected production defect is reported, not bent: `codex_local` environment hello probe with an API key wraps the command in a POSIX `sh -c`, which fails on Windows for a `.cmd` wrapper (see 7).

Verdicts: VALID 6 | VALID_WITH_NOTES 5 | REWRITTEN 7 | OBSOLETE_REMOVED 0 | NEEDS_DECISION 1.

## 3 Variances
- Platform is Windows 11 under heavy shared load (many concurrent vitest processes from other shards). The full 19-file run in one process did not complete in a reasonable time (it stalled on the repo-walking guard, then was stopped), so results below come from the first part of that run plus per-file re-runs. Edited files were all re-run (see 8).
- Embedded Postgres: 6 files have embedded-Postgres suites (built-in-agents 31 tests, cases-routes 14, change-consent-gate 5, cleanup-removal-service 4, codex-device-login-service 9 + hook). On this host the suites were either skipped (support probe negative, about 20 s each) or the `beforeAll` hook timed out at 20 s (cases-routes, codex-device-login-service). Class ENV. These 63 tests were NOT verified dynamically and are assessed by reading only. Their static review found no V1-V5 defect other than the `stop` vs `cleanup` leak fixed in codex-device-login-service.
- claude-local-execute: 22 of 24 fail here with `Failed to start command ...\bin\claude`: the fake CLI is an extensionless `#!/usr/bin/env node` script and Windows cannot execute it. Class ENV (V8). Same root cause for 2 of 10 in claude-local-adapter-environment (managed-config seed and effort probe) and, via `claude_managed_config_dir_failed`, the third (sandbox `--allowedTools` probe; the host-side managed Claude config could not be materialised on Windows). These need Linux/macOS (t3-nightly) to confirm.
- codex-auth-reconciliation: 3 of 6 fail with `EPERM` on `fs.symlink` (confirmed with a one-line node probe). Class ENV (Windows symlink privilege).
- codex-local-adapter-environment: 1 failure, classed REAL (not ENV) and reported as NEEDS_DECISION, see 7.
- cli-auth-routes: the first test timed out once at 20 s on a cold dynamic import of the access routes under load; it passed on re-run. Class ENV (contention).
- The `claude-local-execute` timezone change could not be confirmed on Windows because those tests cannot start the fake CLI here; the expected value is unchanged and was reasoned against `parseClaudeResetClockTime` (timezone-aware, takes `now` as an instant).

## 4 Comprehensive assessment (by rubric code)
- V1 Validity: 0 defects. All subjects exist; registry, catalog and policy assertions match source.
- V2 Meaningful assertions: 3 defects. cloud-instance (two of three assertions in the first test were logical consequences of the first, and the expectation re-derived the implementation: fixed); codex-device-login-reaper last test asserted only `resolves.toBeDefined()` (fixed); built-in-agents "gates Reflection Coach proposal mutations" partly asserts a test-local `applyAcceptedProposalFollowUp` helper rather than production code (noted).
- V3 Determinism: 5 defects. claude-local-execute host-timezone fake clock (fixed); codex-device-login-service iteration-count poll (fixed); real 100 ms sleep used as a negative proof in the reaper-versus-promotion-lock test (noted); cli-auth-routes hard-coded past `expiresAt` 2026-06-23 (noted, no future-check in the validator today); Date.now/Math.random temp names in claude/codex environment tests (noted).
- V4 Isolation: 3 defects. cases-routes pure test hidden inside a skipped Postgres suite (fixed); codex-device-login-service never closed its embedded Postgres (fixed); claude-local-adapter-environment cwd test removes its temp dir outside `finally` (noted).
- V5 Mock fidelity: 2. codex-device-login-service used a non-existent helper member (`stop`) which also hides a type error (fixed); cli-auth-routes replaces the whole `../services/index.js` barrel with a hand-built object (every export the route starts using must be added by hand; noted, not rewritten because `importOriginal` would load the entire service graph).
- V6 Clarity: 1 note. built-in-agents tests are very long multi-phase scenarios (one reason to fail per test is not met).
- V7 Coverage: 3 gaps (see 7).
- V8 Portability: 8 defects. bundled-plugins path.join vs path.resolve expectations and endsWith("/")-based fake loader and symlink privilege (fixed, 9 tests); claude-local-execute, claude-local-adapter-environment fake CLI shebang scripts, POSIX `/agents/agent-alpha/` substring (noted); codex-auth-reconciliation symlink dependency (noted); codex-local-adapter-environment Windows `.cmd` test exposes a production POSIX assumption (NEEDS_DECISION).
- V9 Maintainability: 4 notes. Duplicated `vi.mock` and `vi.doMock` factories in cli-auth-routes; repeated `{ type: "request_confirmation" ... }` fixtures in change-consent-gate; hard-coded model names and the exact sandbox `allowedTools` string in claude-local-execute; five copies of near-identical fake-CLI writers and two copies of `createLocalSandboxRunner` across the claude tests.

## 5 Summary of results
| File | Tests | Verdict | Defect codes | Action |
|---|---|---|---|---|
| server/src/__tests__/built-in-agents.test.ts | 35 | VALID_WITH_NOTES | V2, V6, V9 | none; 4 pass, 31 Postgres tests not runnable here (ENV) |
| server/src/__tests__/bundled-plugins.test.ts | 27 | REWRITTEN | V8 | Windows-portable expectations, fake loader and junction link; 27 pass |
| server/src/__tests__/cases-routes.test.ts | 15 | REWRITTEN | V4 | pure `buildCasePatchUpdateValues` test moved out of the Postgres suite; 1 pass, 14 Postgres tests ENV |
| server/src/__tests__/change-consent-gate.test.ts | 5 | VALID_WITH_NOTES | V7, V9 | none; Postgres, not runnable here (ENV) |
| server/src/__tests__/claude-local-adapter-environment.test.ts | 10 | VALID_WITH_NOTES | V3, V4, V8 | none; 7 pass, 3 ENV failures |
| server/src/__tests__/claude-local-adapter.test.ts | 7 | VALID | - | none; 7 pass |
| server/src/__tests__/claude-local-execute.test.ts | 24 | REWRITTEN | V3, V8 | fixed-UTC fake clock; 2 pass, 22 ENV failures (shebang fake CLI) |
| server/src/__tests__/claude-local-skill-sync.test.ts | 4 | VALID | - | none; 4 pass |
| server/src/__tests__/cleanup-removal-service.test.ts | 4 | VALID | - | none; Postgres, not runnable here (ENV) |
| server/src/__tests__/cli-auth-routes.test.ts | 10 | VALID_WITH_NOTES | V3, V5, V9 | none; 10 pass on re-run |
| server/src/__tests__/cli-invocation-safety.test.ts | 37 | REWRITTEN | V3, V4 | prune `.claude/worktrees/`, read guidance files once; 37 pass |
| server/src/__tests__/cloud-image-bundled-plugins.test.ts | 1 | VALID | - | none; 1 pass |
| server/src/__tests__/cloud-instance.test.ts | 8 (5 before) | REWRITTEN | V2 | explicit expected-value table; 8 pass |
| server/src/__tests__/cloud-routes.test.ts | 5 | VALID | - | none; 5 pass |
| server/src/__tests__/codex-auth-reconciliation.test.ts | 6 | VALID_WITH_NOTES | V8 | none; 3 pass, 3 ENV failures (EPERM symlink) |
| server/src/__tests__/codex-device-login-reaper.test.ts | 9 | REWRITTEN | V2 | last test now asserts sweep counts and terminal state; 9 pass |
| server/src/__tests__/codex-device-login-service.test.ts | 27 (25 statements) | REWRITTEN | V3, V5 | `cleanup()` instead of non-existent `stop`, time-bounded poll, hook timeout; 18 pass, 9 Postgres tests ENV |
| server/src/__tests__/codex-local-adapter-environment.test.ts | 4 | NEEDS_DECISION | V8 | none; 3 pass, 1 REAL failure (Windows probe with API key), see 7 |
| server/src/__tests__/codex-local-adapter.test.ts | 6 | VALID | - | none; 6 pass |

Authoritative counts from this table: VALID 6, VALID_WITH_NOTES 5, REWRITTEN 7, NEEDS_DECISION 1, OBSOLETE_REMOVED 0 (19 files).

## 6 Per-test detail (not clean)
| File | Test | Code | Finding | Action |
|---|---|---|---|---|
| built-in-agents.test.ts | gates Reflection Coach proposal mutations until an accepted follow-up apply step | V2 | The "apply" half runs a helper defined inside the test (`applyAcceptedProposalFollowUp`) that writes instructions only when the interaction is accepted; this asserts the helper, not production. The production part (accept resolves the continuation issue, reject records the reason, no mutation at accept time) is real. | none; see 7 |
| built-in-agents.test.ts | most scenarios (reconcile, approval gate, drift) | V6 | Long multi-step tests with many unrelated assertions. | none |
| bundled-plugins.test.ts | resolves known keys to paths inside the catalog root | V8 | Expected `path.join("/app/...")` while source uses `path.resolve` (drive letter on Windows). | rewritten to `path.resolve` |
| bundled-plugins.test.ts | throws when a symlink inside the root points outside it | V8 | Directory symlink needs privilege on Windows. | `"junction"` link type (ignored on POSIX) |
| bundled-plugins.test.ts | honors the legacy kubernetes path override; honors an env override inside the root; keeps the self-hosted default list | V8 | Same path.join vs path.resolve expectation. | rewritten |
| bundled-plugins.test.ts | installs and loads a missing plugin; reconciles manifest; does not reconcile when versions match; continues past a failing install | V8 | Fake loader located the catalog entry with `endsWith("sandbox-providers/x")`, which fails for backslash paths. | `findCatalogEntry` normalises separators |
| cases-routes.test.ts | omits completedAt from non-status case patches | V4 | Pure function test sat inside `describe.sequential`/`describe.skip` for embedded Postgres, so it was skipped wherever Postgres is unavailable. | moved to its own `describe` |
| change-consent-gate.test.ts | all 5 | V7, V9 | Each test re-inserts the same accepted-interaction row; no case for multiple `targetKeys`, a foreign-company interaction, a rejected/pending interaction or an actor that is not the coach. | none; see 7 |
| claude-local-adapter-environment.test.ts | creates a missing working directory when cwd is absolute | V4 | Temp directory cleanup is after the assertions, not in `finally`. | none |
| claude-local-adapter-environment.test.ts | uses --allowedTools ...; uses the managed Claude config seed ...; warns and omits --effort ... | V8 | Fail on Windows (`claude_managed_config_dir_failed`; shebang script runner). | none; ENV |
| claude-local-execute.test.ts | classifies Claude 'out of extra usage' failures as provider quota errors | V3 | Fake clock set with `new Date(2026, 3, 22, 10, 15)` (host-local time) while the reset is computed in America/Chicago; on a UTC+14 host the expected 21:00Z would be wrong. | fixed instant `2026-04-22T15:15:00.000Z` (10:15 in Chicago) |
| claude-local-execute.test.ts | 22 tests using the fake CLI | V8 | Extensionless shebang script and `/agents/agent-alpha/` substring assume POSIX. | none; ENV, documented |
| claude-local-execute.test.ts | injects bridge env into sandbox-managed remote runs | V9 | Hard-codes the full `allowedTools` string; matches `permissions.ts` today but must be edited with every tool addition. | none |
| cli-auth-routes.test.ts | creates a named board API key and logs audit activity | V3 | `expiresAt` 2026-06-23 is now in the past; passes only because the validator has no future-date check. | none; low risk |
| cli-auth-routes.test.ts | all | V5, V9 | `../services/index.js` replaced by a hand-built object, set twice (`vi.mock` and `vi.doMock`). | none |
| cli-invocation-safety.test.ts | allows only exact-allowlist pnpm commands on every guidance surface; never recommends the broken exec form | V3, V4 | The repo walk descended into `.claude/worktrees/*` (full repo copies created by agent tooling): 30+ false offenders in the first test and a 20 s timeout in the second; each test also re-read every file. | pruned `.claude/worktrees/` at directory level; files read once and shared |
| cloud-instance.test.ts | unifies both prior signals without weakening either restrictive floor | V2 | Re-derived the implementation (`token \|\| managed`) and then asserted two statements implied by the first. | replaced by 4 explicit expected rows |
| codex-auth-reconciliation.test.ts | seeds a stranded managed home...; does not write a secret-bound placeholder...; writes a plain OPENAI_API_KEY... | V8 | Seeding creates a symlink: EPERM on Windows without privilege. | none; ENV |
| codex-device-login-reaper.test.ts | does not throw on a second sweep over an already-deleted sandbox | V2 | Only `resolves.toBeDefined()` (a resolved promise value is always defined). | now asserts counts of both sweeps and the terminal status; renamed to state idempotence |
| codex-device-login-service.test.ts | concurrency block (all) | V5 | `stopDb = started.stop` but the helper returns `cleanup()`; embedded Postgres was never stopped. | use `cleanup()`, 20 s hook timeout like sibling files |
| codex-device-login-service.test.ts | uses of waitForStatus | V3 | Poll bounded by 1000 `setImmediate` turns, not by time. | bounded by a 5 s deadline |
| codex-device-login-service.test.ts | holds the promotion lock so the reaper cannot reclaim a live credential write | V3 | Negative proof uses a real 100 ms sleep. | none; noted |
| codex-local-adapter-environment.test.ts | runs the hello probe when Codex is available via a Windows .cmd wrapper | V8 / product | REAL failure on Windows: probe reports `codex: command not found` because the API-key probe path in `packages/adapters/codex-local/src/server/test.ts` wraps the command in `sh -c`. | none; NEEDS_DECISION |

## 7 Evaluation and recommendations
Product findings:
1. Suspected production defect (codex_local, Windows): `buildProbeCommand` in `packages/adapters/codex-local/src/server/test.ts` (introduced with the sandbox device-login change, commit e5a7fd70) wraps the hello probe in `sh -c '... "$0" "$@"'` whenever `probeApiKey` is set. On Windows (Git Bash `sh`) a `codex.cmd` wrapper is not resolvable, so the environment test reports `codex_hello_probe_failed` even though the `.cmd` wrapper works. The test `runs the hello probe when Codex is available via a Windows .cmd wrapper` was written before that change and sets `OPENAI_API_KEY`, so it now fails on any Windows host with `sh` on PATH. The test was deliberately not weakened. Decision for the owner: either Windows local adapters are out of scope for the fork (staging and production run on Linux; then delete or skip the test with that justification) or the probe must avoid `sh` on win32.
2. `claude_managed_config_dir_failed` on Windows for the sandbox probe (host-side config materialisation) is probably the same class of POSIX assumption; unconfirmed, needs a look on Windows if Windows hosts are supported.
3. The `.claude/worktrees` blind spot in `cli-invocation-safety` is now handled in the test; no production change needed. Guidance in `docs/` is scanned too, so reports must not quote the unsafe invocation forms verbatim.

Coverage gaps (not added, to keep the diff minimal):
- change-consent-gate: no test for several `targetKeys` in one call (all-or-nothing), an accepted interaction from another company, a rejected or pending interaction, or an actor that is not the Reflection Coach.
- built-in-agents: the proposal-apply step is exercised only through a test-local helper; add a test against the real apply path (route/service) when it exists.
- cloud-routes: no upstream failure test (non-2xx or network error from the control plane) and no cache-expiry-on-error test.
- cli-auth-routes: no negative test for expired or cancelled challenges and token mismatch on approve.
- cleanup-removal-service: no test for removing an agent that is `reportsTo` target of another agent.

Recommendations:
- Run the 63 Postgres tests and the 22+3 POSIX-only claude tests in t3-nightly (or a Linux host) as the authoritative signal for this shard; this Windows run cannot confirm them.
- Consider one shared fake-CLI writer and one shared `createLocalSandboxRunner` for the claude tests (V9).
- Consider platform guards (`describe.skipIf(process.platform === "win32")`) with a stated reason for the fake-CLI suites if Windows is not a supported test platform; not added here because a skip would hide the signal without a product decision.

## 8 Summary of activities
Files rewritten (all test files, no production code, config or snapshot touched; no tests deleted):
- server/src/__tests__/bundled-plugins.test.ts: Windows-portable expected paths (`path.resolve`), separator-normalising fake loader lookup, `"junction"` symlink type; 9 failing tests now pass, none weakened.
- server/src/__tests__/cases-routes.test.ts: moved the pure patch-builder test out of the embedded-Postgres suite so it always runs.
- server/src/__tests__/claude-local-execute.test.ts: fake clock set from a fixed UTC instant instead of host-local time.
- server/src/__tests__/cli-invocation-safety.test.ts: skip `.claude/worktrees/` at directory level and read the guidance files once; the file went from 2 failed / 35 passed (two timeouts and 30+ false offenders) to 37 passed in about 10 s.
- server/src/__tests__/cloud-instance.test.ts: tautological first test replaced by an explicit 4-row expected-value table (5 tests became 8 cases, all pass).
- server/src/__tests__/codex-device-login-reaper.test.ts: idempotence test now asserts both sweeps and the terminal status (9 pass).
- server/src/__tests__/codex-device-login-service.test.ts: embedded Postgres closed via `cleanup()`, 20 s hook timeout, time-bounded `waitForStatus`.

Deletions: none.

Commands run (all from the repo root, one vitest process at a time):
- `npx vitest run` on all 19 files (baseline, stopped after claude-local/cleanup files because the repo-walking guard hung): built-in-agents 4 pass/31 skipped; bundled-plugins 9 failed (before fix); cases-routes 14 skipped; change-consent-gate 5 skipped; claude-local-adapter-environment 3 failed; claude-local-execute 22 failed; cleanup-removal-service 4 skipped.
- `npx vitest run` on bundled-plugins, codex-device-login-reaper, cloud-image-bundled-plugins, cloud-routes, cloud-instance, claude-local-adapter, claude-local-skill-sync, codex-local-adapter: 8 files, 67 tests passed.
- `npx vitest run` on cli-auth-routes, codex-auth-reconciliation, codex-local-adapter-environment, codex-device-login-service: 5 failed (3 EPERM symlink ENV, 1 Postgres hook timeout ENV for the concurrency block counted as hook failure plus 9 skipped, 1 REAL Windows probe), 33 passed; cli-auth-routes first-test timeout was ENV and passed on re-run (10/10 in the re-run with cli-invocation-safety).
- `npx vitest run server/src/__tests__/cli-invocation-safety.test.ts` after the fix: 37 passed.
- `npx vitest run` on claude-local-adapter-environment, cli-auth-routes, cases-routes: 3 ENV failures (claude), cases-routes Postgres hook timeout (ENV), cli-auth-routes passed.
- `npx vitest run server/src/__tests__/claude-local-execute.test.ts` after the edit: 2 passed, 22 ENV failures (cannot execute shebang fake CLI).
- Two temporary diagnostic test files (codex hello probe, claude sandbox probe) were created and deleted in the same command; one node one-liner confirmed `EPERM` for `fs.symlinkSync` on this host.

## 9 Approvals
- Prepared by: ____________________  Date: __________
- Reviewed by: ____________________  Date: __________
- Approved by: ____________________  Date: __________
