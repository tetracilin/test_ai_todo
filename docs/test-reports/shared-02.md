# Test Summary Report: shard shared-02 (IEEE 829)

## 1 Report identifier and scope
- Report id: shared-02
- Project: packages/shared (vitest project `@paperclipai/shared`)
- Files: 21 | Test cases: 239 (it.each expansions included: secret.test.ts 4 vault-address rows, skill-policy.test.ts 4+4+5+5 rows)
- Date: see git

## 2 Summary
Every file was read in full and checked against its production module (validators, constants, wp0-phrases, workspace-commands, worktree helpers). All are pure schema/helper tests with no mocks, network or timers except the two worktree filesystem suites. Fork policy (WP-0 Vietnamese phrase table, runtime exposure / tailscale, trust policy, skill policy) is exercised and consistent with current behaviour; no upstream-only assertions found.

Verdicts: VALID 12 | VALID_WITH_NOTES 7 | REWRITTEN 1 | OBSOLETE_REMOVED 0 | NEEDS_DECISION 1.

## 3 Variances
- Platform is Windows. Baseline run: 232 pass, 7 fail.
  - worktree-seed-source.test.ts: 4 failures, class ENV (symlink creation EPERM without Developer Mode/admin; ENOTDIR vs ENOENT for lstat below a regular file). Fixed by guarding (see section 8).
  - worktree-port-registry.test.ts: 2 failures plus 1 unhandled rejection, class ENV (EPERM on renameSync of owner.json.<tmp> over an existing file inside the lock dir, in writeRegistryLockOwner). Not edited; see section 7.
- Port-registry tests could not be confirmed on POSIX here.

## 4 Comprehensive assessment (by rubric code)
- V1 Validity: 0 defects.
- V2 Meaningful assertions: 0 defects (every test can fail; negative schema cases present).
- V3 Determinism: 3 notes, all in worktree-port-registry.test.ts (real 5.25 s delay, Atomics.wait 1.5 s, 100 ms sleep race window; real wall clock and utimes).
- V4 Isolation: 0 defects (temp dirs cleaned in afterEach).
- V5 Mock fidelity: 0 (no mocks).
- V6 Clarity: 3 notes (multi-assertion tests in issue/plugin; one name/body mismatch in claude-setup-token-session; wp0-phrases PENDING_CAPTURE consts declared after first lexical use).
- V7 Coverage: 1 gap noted (scheduling), plus gaps in section 7.
- V8 Portability: 6 defects (4 in worktree-seed-source, fixed; 2 in worktree-port-registry, open).
- V9 Maintainability: 3 notes (large repeated manifest literals; hard-coded ordered id lists in wp0-phrases; `as any` in work-product.test.ts).

## 5 Summary of results
| File | Tests | Verdict | Defect codes | Action |
|---|---|---|---|---|
| packages/shared/src/validators/artifact.test.ts | 4 | VALID | - | none |
| packages/shared/src/validators/claude-setup-token-session.test.ts | 15 | VALID_WITH_NOTES | V6 | none |
| packages/shared/src/validators/company-skill.test.ts | 4 | VALID | - | none |
| packages/shared/src/validators/instance.test.ts | 20 | VALID | - | none |
| packages/shared/src/validators/issue.test.ts | 34 | VALID_WITH_NOTES | V6 | none |
| packages/shared/src/validators/plugin.test.ts | 26 | VALID_WITH_NOTES | V6, V9 | none |
| packages/shared/src/validators/routine.test.ts | 6 | VALID | - | none |
| packages/shared/src/validators/runtime-exposure.test.ts | 16 | VALID | - | none |
| packages/shared/src/validators/scheduling.test.ts | 3 | VALID_WITH_NOTES | V7 | none |
| packages/shared/src/validators/secret.test.ts | 19 | VALID | - | none |
| packages/shared/src/validators/skill-policy.test.ts | 23 | VALID | - | none |
| packages/shared/src/validators/status-card.test.ts | 2 | VALID | - | none |
| packages/shared/src/validators/tool-access.test.ts | 6 | VALID | - | none |
| packages/shared/src/validators/trust-policy.test.ts | 2 | VALID | - | none |
| packages/shared/src/validators/work-product.test.ts | 2 | VALID | - | none |
| packages/shared/src/work-product.test.ts | 9 | VALID_WITH_NOTES | V9 | none |
| packages/shared/src/workspace-commands.test.ts | 6 | VALID | - | none |
| packages/shared/src/workspace-file-resource.test.ts | 3 | VALID | - | none |
| packages/shared/src/worktree-port-registry.test.ts | 5 | NEEDS_DECISION | V3, V8 | none; 2 ENV failures on Windows, see section 7 |
| packages/shared/src/worktree-seed-source.test.ts | 8 | REWRITTEN | V8 | symlink and ENOTDIR tests platform-guarded |
| packages/shared/src/wp0-phrases.test.ts | 26 | VALID_WITH_NOTES | V6, V9 | none |

Authoritative counts from this table: VALID 12, VALID_WITH_NOTES 7, REWRITTEN 1, NEEDS_DECISION 1, OBSOLETE_REMOVED 0 (21 files).

## 6 Per-test detail (not clean)
| File | Test | Code | Finding | Action |
|---|---|---|---|---|
| worktree-seed-source | rejects a dangling config symlink instead of falling back... | V8 | symlinkSync EPERM on Windows without privilege | it.skipIf(!canSymlink) capability probe |
| worktree-seed-source | rejects a dangling .paperclip symlink instead of falling back... | V8 | same | same |
| worktree-seed-source | takes the named source when .paperclip is a symlink to a directory with no config | V8 | same | same |
| worktree-seed-source | fails closed when the declared config cannot be inspected | V8 | asserts POSIX ENOTDIR; Windows lstat yields ENOENT | it.skipIf(win32) |
| worktree-port-registry | reclaims an old lock when its pid belongs to a different process | V8 | EPERM rename in production lock writer on Windows (ENV) | none |
| worktree-port-registry | refreshes the lease while a synchronous critical section blocks the main thread | V3, V8 | EPERM (ENV); relies on 1.5 s real block and wall-clock mtime | none |
| worktree-port-registry | refreshes the lease throughout an async critical section | V3 | real 5.25 s delay vs 5 s stale threshold | none |
| worktree-port-registry | does not reclaim a stale lock while its fallback ownership probe responds | V3 | fixed 100 ms sleep to prove the second holder did not enter | none |
| claude-setup-token-session | rejects a single control byte and accepts a printable code | V6 | name says control byte, body only asserts two accepted codes | none |
| scheduling | accepts canonical IANA timezones and UTC | V7 | depends on host Intl timezone data; no boundary cases | none |
| work-product (root) | accepts work product with resourceRef in metadata | V9 | `(result.metadata as any)` | none |
| wp0-phrases | asks for the card number in the one shape... / assigns retry ownership... | V9 | exact ordered id arrays couple tests to template declaration order | none |

## 7 Evaluation and recommendations
- Product finding (needs decision): worktree-port-registry.ts writeRegistryLockOwner (around line 172) renames a temp file over owner.json; on Windows this fails with EPERM, so the port-registry lock cannot be acquired/refreshed there. Tests were not bent. Decide whether Windows is a supported host for worktree commands; if so add retry/fallback on EPERM/EBUSY, otherwise skipIf(win32) the lock tests.
- Coverage gaps (not added): scheduling timezone boundaries; no test for IPv6 CIDRs in issue egress settings; no N-waiter contention test for the port registry.
- Suggest injecting a fake clock into the port-registry lease tests to remove about 7 s of real waiting.

## 8 Summary of activities
- Rewritten: packages/shared/src/worktree-seed-source.test.ts, added platform guards (symlink capability probe, win32 skip for the ENOTDIR assertion). No assertion weakened, no test deleted.
- Deletions: none.
- Commands: `npx vitest run <all 21 files>` baseline: 232 pass, 7 fail, 1 unhandled error (all ENV). `npx vitest run packages/shared/src/worktree-seed-source.test.ts` after edit: 4 pass, 4 skipped on this Windows host. Remaining failures: the 2 port-registry ENV failures.

## 9 Approvals
Prepared by: ____________  Date: ________
Reviewed by: ____________  Date: ________
Approved by: ____________  Date: ________
