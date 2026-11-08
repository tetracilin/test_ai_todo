# Issue #204 — t3-nightly `workspace-runtime` reconcile test drew a managed exposure port

- **Status:** fix ready; PR open to `develop`
- **Issue:** [#204](https://github.com/tetracilin/test_ai_todo/issues/204)
- **Branch:** `fix/issue-204-workspace-reconcile-adopt`
- **Base:** `origin/develop` at `32e8a48e`
- **Date:** 2026-11-08

## Validity and root cause

Still valid: `server/src/__tests__/workspace-runtime.test.ts` allocated the test
service's port by binding `listen(0)` and closing it. The startup reconciliation sweep
(`reconcilePersistedRuntimeServicesOnStartup`) runs the PAP-17419 exposure-reservation
drift guard first. That guard treats any row without a live exposure claim as dormant
and, for a row whose `port` falls inside the managed runtime exposure range
(`42000-42999`), probes the pair (`collectRowExposurePorts` also derives the `+10000`
HMR companion).

When the OS happened to hand the test an ephemeral port inside `42000-42999` and the
test's own fake service was listening there with an owner identity the in-process
registry could not attribute, the row was classified as drifted. The reconcile loop then
takes the drift branch — `reconciled += 1; continue;` — which produces exactly the
nightly result: `{ reconciled: 1, adopted: 0, stopped: 0, restarted: 0,
restartFailed: 0 }`. The run was never about adoption failing; the fixture was
probabilistically indistinguishable from a pre-exposure row whose leased pair was
taken over.

Linux ephemeral ports (32768-60999) overlap the managed app range, so this fails
intermittently in `t3-nightly`; Windows' default ephemeral range starts at 49152, which
is why local Windows runs never reproduced it.

## What changed

- `server/src/__tests__/workspace-runtime.test.ts`:
  - `findFreePort()` now retries until the OS-assigned port is outside the managed
    runtime exposure ranges (`isAllowedRuntimeExposurePort`), with a comment explaining
    the PAP-17419 interaction.
  - The reconcile adoption test ("re-adopts a live service whose shell command differs
    from the surviving process argv") and the adjacent stale-port test now take their
    ports from that helper instead of their own inline `listen(0)` blocks.
- No production code changed. The drift guard is intentional (PAP-17419) and untouched.
- No schema, API, dependency, lockfile, migration, or workflow change.

## Verification

Run from the issue worktree at `develop` @ `32e8a48e`, dependencies linked from the base
checkout (a nested worktree makes `pnpm install` resolve to the enclosing workspace; the
root postinstall symlink step also needs Developer Mode).

- **Deterministic root-cause reproduction (temporary test, not committed):** calling
  `findExposureReservationDrift` with a running, exposure-less row on port `42123` and a
  live listener returns `[{ reason: "live_listener", port: 42123 }]` — the exact drift
  entry that short-circuits adoption. This proves the port-range collision is the cause.
  Result: 1/1 passed.
- **A/B regression check on the modified file:**
  - unmodified `develop` file: `Tests 23 failed | 75 passed | 30 skipped (128)`.
  - modified file: same expected counts — the 23 failures are pre-existing environment
    failures in this nested-worktree session (pnpm/worktree provisioning tests), not
    caused by this change; see below.
- **Target test cannot execute on this host:** the file's embedded-Postgres suites
  self-skip because `initdb` exits 1 in this Windows session (the host's embedded
  Postgres probe fails for all suites, including on unmodified code). The target test is
  in that DB-gated block, so it is one of the 30 skipped tests here. `t3-nightly` on
  Linux runs it with the real database.
- Not run: browser suites (out of scope).

## Follow-up

- The same inline `listen(0)` pattern should not be reintroduced for reconcile fixtures;
  `findFreePort()` is now range-safe for every test in this file.
- No production follow-up: the drift guard behaviour is intended.

## Risk

- Very low. Test-only change; the port helper now retries a few times instead of once.
  `findFreePort()` is used by several tests in the file, all of which only need a free
  port, never a specific range.

## Model used

- Provider: DeepSeek. Model ID: `deepseek-flash` through DeepSeek Harness (DSH), with
  tool use and code execution. No extended-thinking mode.
