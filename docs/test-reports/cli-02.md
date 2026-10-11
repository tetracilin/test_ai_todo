# Test Summary Report - shard cli-02 (IEEE 829 structure)

## 1 Report identifier and scope
- Report id: cli-02. Project: `cli` (vitest project `paperclipai`). Date: see git.
- Files: 12 under `cli/src/__tests__/`. Test cases: 158 (it.each expansions: service-manager 3 for the systemd line-break table, worktree 4 for the stale-manifest variants).
- Subject: the fork `cli` package on current develop (secrets, service manager, skills/teams catalog commands, telemetry, tokens, update, worktree).

## 2 Summary
Every file was read in full and checked against the production modules it imports. No file tests removed or upstream-only behaviour: all subjects exist and assertions match current fork behaviour (the `paperclipai/paperclip` strings in update-command are only fixture data for a git-source manifest). Verdicts: VALID 3, VALID_WITH_NOTES 4, REWRITTEN 5, OBSOLETE_REMOVED 0, NEEDS_DECISION 0. No tests deleted, no assertions weakened.

## 3 Variances
Host is Windows 11. Failures observed on unedited code are all ENV (not REAL):
- Symlink creation needs privilege (EPERM): service-manager (1), update-command (9, `flipCurrentAtomic` symlinks), worktree symlink variant (1).
- Atomic `rename` onto an existing file inside the port-reservation lock dir gives EPERM: worktree "preserves repo-managed worktree checkouts" and "avoids ports already claimed".
- Embedded Postgres tests time out (20-30 s) on this host: worktree legacy-evidence, quarantine, local-board seed, lagging-source seed, reseed, pauseSeededScheduledRoutines (6 tests). These are real DB tests; their logic was reviewed by reading only.
- Tests that did run and pass here: all of secrets, service-health-check, skills, teams, telemetry, token, update-notice, worktree-merge-history, zip-codec, and 18 service-manager, 5 update-command, 54 worktree cases (51 before edits).
- Tests failing for ENV reasons that could not be verified here: 22 in total (service-manager 1, update-command 9, worktree 12 before edits; worktree 9 after, because 3 became portable). Linux CI (t3-nightly) is the authority for them.

## 4 Comprehensive assessment (defects by rubric code)
- V1 Validity: 0 defects.
- V2 Meaningful assertions: 0 defects. Mostly strong, exact-match assertions.
- V3 Determinism: 2 minor notes (real 20 ms / 100 ms sleeps used as negative-wait in service-health-check "serializes concurrent restarts" and worktree "serializes concurrent ensure-seeded"; both assert ordering via promise gating so the sleeps only widen the window, not the pass condition).
- V4 Isolation: 5 defects fixed (global `fetch` stub never unstubbed in secrets and token; env not restored in secrets; ambient `PAPERCLIP_TASK_ID`/`AWS_PROFILE` could change outcomes in teams and secrets). Notes: tmp dirs leaked in service-health-check, telemetry, and update-notice cleanup is fine.
- V5 Mock fidelity: 0 defects. Command runners and fetch are the only fakes; SUT never mocked.
- V6 Clarity: update-command and update-notice use dense multi-statement one-liners (note, not changed).
- V7 Coverage: gaps listed in section 7.
- V8 Portability: 4 fixed (POSIX literal paths in rebindWorkspaceCwd x2 and reseed target paths, exec-bit assertion); 3 remaining ENV items need symlink/rename/PG behaviour (noted, not skipped).
- V9 Maintainability: worktree.test.ts repeats ~20 lines of source/target config setup in 8 tests (note); skills/teams duplicate `jsonResponse`/`makeProgram` helpers.

## 5 Summary of results
| path | tests | verdict | defect codes | action |
|---|---|---|---|---|
| cli/src/__tests__/secrets.test.ts | 8 | REWRITTEN | V4 | unstub fetch, restore env, clear AWS_PROFILE |
| cli/src/__tests__/service-health-check.test.ts | 7 | VALID_WITH_NOTES | V3, V4 | none; real 20 ms sleep, tmp dirs not removed |
| cli/src/__tests__/service-manager.test.ts | 19 | VALID_WITH_NOTES | V8 | none; symlink test needs privilege on Windows (ENV) |
| cli/src/__tests__/skills.test.ts | 13 | VALID | V9 note | none |
| cli/src/__tests__/teams.test.ts | 11 | REWRITTEN | V4 | clear ambient PAPERCLIP_TASK_ID |
| cli/src/__tests__/telemetry.test.ts | 2 | VALID_WITH_NOTES | V4 | none; temp roots not removed |
| cli/src/__tests__/token.test.ts | 6 | REWRITTEN | V4 | unstubAllGlobals in afterEach |
| cli/src/__tests__/update-command.test.ts | 14 | VALID_WITH_NOTES | V6, V8 | none; 9 tests fail on Windows symlinks (ENV) |
| cli/src/__tests__/update-notice.test.ts | 2 | VALID | V7 note | none |
| cli/src/__tests__/worktree-merge-history.test.ts | 8 | VALID | none | none |
| cli/src/__tests__/worktree.test.ts | 63 | REWRITTEN | V8, V9 | portable expected paths, guard exec-bit assertion |
| cli/src/__tests__/zip-codec.test.ts | 5 | VALID | none | none |

## 6 Per-test detail (tests that are not clean)
| file | test | code | finding | action |
|---|---|---|---|---|
| secrets.test.ts | "wraps provider config..." and "wraps secret metadata..." | V4 | `vi.stubGlobal("fetch")` never undone; `PAPERCLIP_API_*` deletions leaked | added `vi.unstubAllGlobals()` and env restore in afterEach |
| secrets.test.ts | "passes AWS doctor checks..." | V4 | sets AWS_PROFILE; beforeEach did not clear an ambient one for the failing-config test | beforeEach now deletes AWS_PROFILE |
| teams.test.ts | all in "teams CLI commands" | V4 | production reads `PAPERCLIP_TASK_ID` to auto-request approval; ambient value would change outcomes | beforeEach deletes it |
| token.test.ts | all | V4 | fetch stub leaked | afterEach unstubAllGlobals |
| service-health-check.test.ts | "serializes concurrent restarts..." | V3 | 20 ms real sleep as negative wait | none (ordering still asserted deterministically) |
| service-health-check.test.ts | beforeEach | V4 | mkdtemp PAPERCLIP_HOME never removed | note |
| service-manager.test.ts | "refuses to replace a symlinked service definition" | V8 | EPERM on Windows | ENV, none |
| update-command.test.ts | 9 tests using `flipCurrentAtomic` | V8 | EPERM symlink on Windows (ENV) | none |
| worktree.test.ts | "rebinds same-repo workspace paths..." | V8 | POSIX literal expectation vs path.resolve | expected values wrapped in path.resolve |
| worktree.test.ts | "derives worktree reseed target paths..." | V8 | same | expected homeDir via path.resolve |
| worktree.test.ts | "copies shared git hooks..." | V8 | exec-bit assertion meaningless on Windows | guarded with platform check |
| worktree.test.ts | symlink variant of stale manifest; 2 port-reservation tests | V8 | EPERM symlink / lock rename (ENV) | none |
| worktree.test.ts | 6 embedded Postgres tests | V8 | time out on this host (ENV) | none |

## 7 Evaluation and recommendations
- No suspected production bugs. No fork-policy staleness found.
- Coverage gaps (not added): update-notice has no test for network failure/non-200 or expired cache; telemetry has no test for CI-env disable; token has no 4xx error path; service-manager has no systemd start/stop/status tests; skills has no 404/ambiguous-in-command path.
- Recommend a shared `cli/src/__tests__/helpers` env/fetch fixture and a config-fixture builder to remove the repeated worktree setup.
- Windows contributors should run these in WSL; the symlink and lock-rename failures are host limits.

## 8 Summary of activities
- Rewritten: secrets.test.ts (isolation), teams.test.ts (isolation), token.test.ts (isolation), worktree.test.ts (portability, 3 tests). No deletions.
- Commands: `npx vitest run` per file. Results: secrets 8/8, token 6/6, teams 11/11 after edit; worktree `-t "rebind|reseed target|git hooks"` 5/5 after edit. Unedited run before edits: service-manager 18/19 (ENV), update-command 5/14 (ENV), worktree 51/63 (12 ENV; 3 of these fixed by the edits), all others green.

## 9 Approvals
Prepared by: ____________  Reviewed by: ____________  Date: ________
