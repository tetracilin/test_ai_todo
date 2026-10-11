# Test Summary Report: shard server-33 (IEEE 829)

## 1 Report identifier and scope

- Report id: server-33
- Project: `server` (vitest project `@paperclipai/server`), t3-nightly "slow-tests" audit
- Files: 14. Test cases: 218 (setup-token-session 60 incl. 11 embedded-Postgres cases; workspace-runtime-exposure 28; port-reservation 34; transport-binding 22; backfill 16; shutdown 13; scheduler 12; url-utils 9; ready-comment 7; wopi 4; reaper 4; read-model 4; tailscale-hostname 3; session-workspace-cwd 2). No `it.each` expansions except the cancel/expiry loop in setup-token-session (2 variants x 2 tests, counted individually).
- Date: see git.
- Rubric: ISO/IEC/IEEE 29119 / ISTQB, codes V1-V9.

## 2 Summary

Every file and test was read and checked against its production source on the current fork. No test asserts upstream-only behaviour; all subjects (runtime-exposure broker/port mediation, setup-token login flow, WOPI sessions, workspace git scheduler, shutdown ordering) exist and match fork behaviour.

Verdicts: VALID 5, VALID_WITH_NOTES 1, REWRITTEN 7, NEEDS_DECISION 1, OBSOLETE_REMOVED 0.

Rewrites were targeted: removal of a fixed-sleep race, a test that asserted a test double rather than the SUT, a host-port dependency, Windows symlink and cold-start fragility, dead code, and a few cheap negative-path gaps. No assertion was weakened and no test was deleted or skipped.

## 3 Variances

- Host is Windows. `workspace-runtime-exposure.test.ts` (21 of 28 cases) cannot run here: it uses sh-quoted `node -e` commands, unquoted Windows temp paths, `/proc` listener diagnosis and loopback bind semantics (ENV). The 7 `classifyExposureHostCollisions` cases run and pass. The edits to the EADDRINUSE scenarios in that file are therefore NOT dynamically verified (the file loads and the pure cases pass); confirm them in t3-nightly on Linux.
- Embedded PostgreSQL does not start within the 30 s hook timeout on this machine (ENV). The 11 DB-store cases in `setup-token-session.test.ts` (including one added case) did not execute locally. The 49 non-DB cases pass.
- `session-workspace-cwd.test.ts` fails on Windows (ENV, with a suspected production portability defect, see section 7).

## 4 Comprehensive assessment (cross-cutting defects)

| Code | Count | Notes |
|---|---|---|
| V1 Validity | 0 | no stale or upstream-only assertions found |
| V2 Meaningful assertions | 1 | setup-token-session "durable state scope" asserted the in-test FakeStore, not the service (fixed) |
| V3 Determinism | 4 | 20 ms sleep vs 5 ms retention timer; 250 ms sleep vs 150 ms settle; 500 ms hard timeout vs cold node start; exposure tests pinned to port 42000 being free (all fixed). Residual: real 600 ms delay in DB lock test (relative to DB clock, accepted) |
| V4 Isolation | 1 | `lockDb` connection leaked if the lock test failed (fixed with finally) |
| V5 Mock fidelity | 2 | hand-built `environments`/`environmentRuntime` stubs cast `as never` in transport-binding; FakeStore re-implements store scoping (noted, not changed; production store covered by DB cases) |
| V6 Clarity | 2 | misleading name "keeps the HMR companion reserved" (renamed); stale "this phase" comment (fixed) |
| V7 Coverage | 4 | shutdown: no postgres-stop-failure, absent app hook, import-rejection cases; tailscale parse boundaries; DB markState scoping (all added) |
| V8 Portability | 3 | symlink EPERM on Windows (junction now); POSIX paths in session-workspace-cwd; exposure suite POSIX-only (documented) |
| V9 Maintainability | 3 | dead `void isTerminalSessionState`, `void started/process`, unused `delay` (removed); two duplicate receive-token transport cases in session test (noted) |

## 5 Summary of results

| File | Tests | Verdict | Defects | Action |
|---|---|---|---|---|
| server/src/services/runtime-exposure/port-reservation.test.ts | 34 | REWRITTEN | V6 | renamed one misleading test; passes |
| server/src/services/runtime-exposure/tailscale-hostname.test.ts | 3 | REWRITTEN | V7 | added trim/null/non-string/leading-hyphen boundary test; passes |
| server/src/services/session-workspace-cwd.test.ts | 2 | NEEDS_DECISION | V8 | unchanged; fails on Windows (ENV), suspected production portability defect |
| server/src/services/setup-token-reaper.test.ts | 4 | VALID | none | none; passes |
| server/src/services/setup-token-session.test.ts | 60 | REWRITTEN | V2 V3 V4 V7 V9 | see section 8; 49 pass, 11 DB cases blocked by ENV |
| server/src/services/setup-token-transport-binding.test.ts | 22 | REWRITTEN | V3 V6 V9 | see section 8; passes |
| server/src/services/wopi.test.ts | 4 | VALID_WITH_NOTES | V7 | none; passes (gaps in section 7) |
| server/src/services/workspace-git-operation-scheduler.test.ts | 12 | REWRITTEN | V3 V8 | junction on win32, wider hard-timeout margins; passes (was 2 ENV failures) |
| server/src/services/workspace-runtime-exposure-backfill.test.ts | 16 | VALID | none | none; passes |
| server/src/services/workspace-runtime-exposure.test.ts | 28 | REWRITTEN | V3 V8 | removed host-port-42000 dependency; 7 pass, 21 ENV-blocked |
| server/src/services/workspace-runtime-read-model.test.ts | 4 | VALID | none | none; passes |
| server/src/services/workspace-runtime-ready-comment.test.ts | 7 | VALID | none | none; passes |
| server/src/shutdown.test.ts | 13 | REWRITTEN | V7 | added 3 negative-path tests; passes |
| server/src/url-utils.test.ts | 9 | VALID | none | none; passes |

## 6 Per-test detail (not clean)

| File | Test | Code | Finding | Action |
|---|---|---|---|---|
| port-reservation | keeps the HMR companion reserved even when only the app port is claimed | V6 | name promised an HMR-companion check, body checks the leased HMR port claimed as another workspace's app port | renamed |
| session-workspace-cwd | rejects system roots... | V8 | `path.normalize` in production turns `/` into `\` on win32 so assertions fail on Windows | none (NEEDS_DECISION) |
| setup-token-session | marks the durable record state by the full owner scope | V2 | assertion exercised FakeStore only | now captures identities the service passes to `markState` and asserts each equals the full owner scope |
| setup-token-session | purges the retained completion when the retention window ends | V3 | 20 ms sleep racing a 5 ms timer | `vi.waitFor` with 2 s bound |
| setup-token-session | rejects a second active record... (DB) | V7 | rejected insert not shown to leave the original intact | added assertion |
| setup-token-session | returns no row when the claim row lock holds... (DB) | V4 | second connection leaked on failure | try/finally |
| setup-token-session | denies a direct non-loopback HTTP receive-token request / denies a spoofed forwarded HTTPS receive-token request | V9 | identical inputs to earlier guard cases | noted, kept |
| setup-token-transport-binding | forwards only allowlisted... success path | V3 | `delay(250)` racing the runner's 150 ms settle | wait for the second PTY write |
| setup-token-transport-binding | ignores a runtime-supplied command | V9 | dead `void started` | removed |
| setup-token-transport-binding | (file level) | V9/V6 | dead `void isTerminalSessionState`, `void process`, stale "this phase" comment | removed/updated |
| setup-token-transport-binding | production provider tests | V5 | hand-built stubs cast `as never` | noted |
| scheduler | coalesces the same canonical key... | V8 | `fs.symlink(..., "dir")` EPERM on Windows | junction on win32 |
| scheduler | kills a hung subprocess... | V3 | 500 ms hard timeout can fire before a cold `node` writes its pid file | 2 s / 5 s |
| exposure | three "does not quarantine" EADDRINUSE cases | V3 | asserted allocation `[42000]` and guest keyed on 42000, failing if a lane already holds 42000 | guest fabricates for any assigned port; assert exactly one allocation and the actual port (not run on Windows) |
| exposure | all lifecycle/guest tests | V8 | POSIX shell, `/proc` | documented |
| tailscale-hostname | (gap) | V7 | trim, null payload, non-string, leading hyphen untested | added |
| shutdown | (gap) | V7 | postgres stop failure, absent app hook, import rejection untested | added 3 tests |
| shutdown | removes the eager signal handlers from the real embedded-postgres import | V5 | passes vacuously if the dependency stops adding listeners | noted |

## 7 Evaluation and recommendations

Product finding (NEEDS_DECISION): `server/src/services/session-workspace-cwd.ts` uses `path.normalize` for session workspace cwd values that name remote sandbox (POSIX) paths. On Windows hosts `isUnsafeSessionWorkspaceCwd("/")` returns false, so unsafe system roots are not rejected. `path.posix.normalize` would be correct on every host. The test is right; do not bend it.

Coverage gaps (not added):
- wopi: no test for lock expiry by clock, token minimum-length boundary, or `create` pruning of expired sessions.
- port-reservation: `findExposureReservationDrift` for `failed` status rows and in-memory runtime precedence versus broker mapping are only covered indirectly.
- workspace-runtime-exposure: the 21 integration cases need Linux; the nightly is the only gate.
- setup-token-session DB cases need an environment where embedded Postgres starts; confirm the added `markState` case in nightly.

Recommendation: run these files on the Linux nightly after merge and confirm the exposure and DB cases.

## 8 Summary of activities

Files rewritten:
- `runtime-exposure/port-reservation.test.ts`: renamed a misleading test.
- `runtime-exposure/tailscale-hostname.test.ts`: added boundary test.
- `setup-token-session.test.ts`: fixed-sleep race replaced by bounded `vi.waitFor`; durable-scope test now checks the service's identities; added DB `markState` scope case; try/finally for lock connection; extra assertion in slot test.
- `setup-token-transport-binding.test.ts`: removed 250 ms sleep, dead code, stale comment.
- `workspace-git-operation-scheduler.test.ts`: junction on win32; larger hard-timeout margins.
- `workspace-runtime-exposure.test.ts`: removed dependence on port 42000.
- `shutdown.test.ts`: added three negative-path tests.

Deletions: none.

Commands (repo root, one vitest process at a time): `npx vitest run <file>` for all 14 files as baseline and after edits.
Results after edits: tailscale-hostname 3/3, port-reservation 34/34, reaper 4/4, url-utils 9/9, wopi 4/4, backfill 16/16, read-model 4/4, ready-comment 7/7, transport-binding 22/22, scheduler 12/12 (was 10/12), shutdown 13/13, setup-token-session 49 pass + 11 ENV-blocked (hook timeout), session-workspace-cwd 1 pass and 1 fail (unchanged, ENV plus suspected product defect), workspace-runtime-exposure 7 pass (`-t classifyExposureHostCollisions`) + 21 ENV-blocked.

## 9 Approvals

Prepared by: ______________________  Date: __________

Reviewed by: ______________________  Date: __________

Approved by: ______________________  Date: __________
