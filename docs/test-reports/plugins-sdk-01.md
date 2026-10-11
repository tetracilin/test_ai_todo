# Test Summary Report: plugins-sdk-01 (IEEE 829)

## 1 Report identifier and scope
- Shard: plugins-sdk-01; project `packages/plugins/sdk`; 7 files; 62 test cases (the 5-row `it.each` in host-client-factory counts as 5); date: see git.

## 2 Summary
All 7 files were read in full and checked against `src/protocol.ts`, `src/worker-rpc-host.ts`, `src/host-client-factory.ts`, `src/testing.ts` and `src/ui/clipboard.ts`. All subjects still exist in the fork and the assertions match current behaviour. None of these tests exercises upstream-only or fork-policy-sensitive behaviour. Verdicts: VALID 1, VALID_WITH_NOTES 5, REWRITTEN 1, OBSOLETE_REMOVED 0, NEEDS_DECISION 0.

## 3 Variances
- Windows: the symlink test failed with EPERM (ENV, no elevation). It was fixed by using a junction on win32.
- The `@ts-expect-error` directives in `protocol.duplex-channel.test.ts` are only enforced by `tsc --noEmit` (`pnpm typecheck`, tsconfig includes `src`). Vitest does not type-check them, and tsc was not run here.

## 4 Comprehensive assessment
- V1 Validity: 0 defects.
- V2 Meaningful assertions: 1 file affected (duplex-channel). The runtime `expect(x).toBeDefined()` lines cannot fail. The real checks are the compile-time directives. 7 tests are type-only.
- V3 Determinism: 3 tests used a 20 ms sleep to "flush". The flush was unnecessary because writes are synchronous and ordered, so the sleep was removed (2 helpers, 5 tests). `setImmediate` in the setup-token PTY test is harmless.
- V4 Isolation: 0 defects. Streams are destroyed, the temp dirs and the `__paperclipPluginBridge__` global are restored.
- V5 Mock fidelity: `host-client-factory` builds partial `as unknown as HostServices` stubs. This is acceptable because only the delegate under test is called, and the tests assert it is not called on denial.
- V6 Clarity: the 'test_...' naming style in 2 tests is cosmetic.
- V7 Coverage: gaps are listed in section 7.
- V8 Portability: 1 defect (the symlink test, fixed).
- V9 Maintainability: the `callWorker` / readline harness is copy-pasted about 8 times in worker-rpc-host.test.ts and again in environment-sync-negotiation.test.ts. This is a candidate for a shared helper and was not refactored (scope).

## 5 Summary of results
| path | tests | verdict | defect codes | action |
|---|---|---|---|---|
| packages/plugins/sdk/src/protocol.duplex-channel.test.ts | 15 | VALID_WITH_NOTES | V2 | none; tsc enforces the type assertions |
| packages/plugins/sdk/tests/environment-sync-negotiation.test.ts | 4 | VALID_WITH_NOTES | V9 | none |
| packages/plugins/sdk/tests/host-client-factory.test.ts | 20 (5 via each) | VALID | none | none |
| packages/plugins/sdk/tests/protocol.postupload.test.ts | 2 | VALID_WITH_NOTES | V2 | none; type contract with trivial runtime asserts |
| packages/plugins/sdk/tests/testing-actions.test.ts | 4 | VALID | none | none |
| packages/plugins/sdk/tests/ui-clipboard.test.ts | 1 | VALID_WITH_NOTES | V7 | none; only the delegation path is tested |
| packages/plugins/sdk/tests/worker-rpc-host.test.ts | 16 | REWRITTEN | V8, V3, V9 | junction on win32; 20 ms sleeps replaced by an ordering barrier |

## 6 Per-test detail (non-clean tests)
| file | test | code | finding | action |
|---|---|---|---|---|
| worker-rpc-host | isWorkerEntrypoint matches an entrypoint reached through a symlinked directory | V8 | EPERM on Windows without elevation | use "junction" on win32; passes |
| worker-rpc-host | emits one span.record ... / sends a finite startTimeMs ... / emits no span.record when ... | V3 | fixed 20 ms sleep before asserting; an absence assertion is only valid with an ordering guarantee | sleep removed; relies on synchronous ordered stdout |
| worker-rpc-host | stamps the active invocation id ... / drops an empty chunk ... | V3 | same 20 ms sleep | sleep removed |
| worker-rpc-host | setup-token PTY dispatch | V3 (minor) | `setImmediate` tick before asserting; ordering already guaranteed | left |
| duplex-channel | the 7 "rejects ..." tests | V2 | runtime assertion is `toBeDefined`; the real check is the `@ts-expect-error` under tsc | left; documented |
| duplex-channel | accepts ... tests | V2 | assert only values just assigned | left |
| postupload | both tests | V2 | mostly type and echo assertions; the real behaviour is covered by environment-sync-negotiation | left |
| environment-sync-negotiation | advertises ... only when hooks defined | V6 | two scenarios in one test | left |

## 7 Evaluation and recommendations
- No product bugs found. Capability gating, invocation-scope denial, cross-tenant config guard and the human-attributed comment gate all match the source (host-client-factory.ts lines ~472, 479, 922).
- Gaps:
  - The `isWorkerEntrypoint` symlink case has no coverage for a missing path.
  - `copyTextToClipboard` has no test for the bridge being absent.
  - Neither `environmentSyncIn` nor `environmentSyncOut` has a test for a plugin hook that throws.
  - The duplex-channel type tests could move to `expectTypeOf` / `vitest --typecheck`, so the type contract is enforced in the test run.
- Extract the shared worker-RPC test harness into a `tests/helpers` file.

## 8 Summary of activities
- Rewritten: `tests/worker-rpc-host.test.ts` (Windows-safe junction; removed 2 sleeps).
- Deletions: none.
- Commands:
  - `npx vitest run packages/plugins/sdk`: baseline 61 of 62 passed; the 1 failure was ENV (EPERM symlink).
  - `npx vitest run packages/plugins/sdk/tests/worker-rpc-host.test.ts`, run twice after the edit: 16 of 16 passed both times.

## 9 Approvals
Prepared by: ____________  Reviewed by: ____________  Approved by: ____________
