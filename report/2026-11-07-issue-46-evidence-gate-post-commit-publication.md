# Issue #46 — evidence gate published its audit event before the transaction committed

- **Status:** fix ready; PR open to `develop`
- **Issue:** [#46](https://github.com/tetracilin/test_ai_todo/issues/46)
- **Branch:** `fix/issue-46-evidence-gate-post-commit-publication`
- **Base:** `origin/develop` at `3e50ed78`
- **Date:** 2026-11-07

## Validity

Still valid on current `develop`. `server/src/services/issues.ts` writes the
`issue.evidence_gate.closed` activity row with `logActivity(tx, {...})` and no third
argument, inside the row-locked `done` transition transaction. `logActivity` publishes
immediately when no post-commit queue is supplied, so SSE subscribers and plugin handlers
heard about the close before the transaction could commit (or roll back).

## What changed

- `server/src/services/issues.ts`: pass the transaction's `activityPublications` queue as
  the third `logActivity` argument for `issue.evidence_gate.closed`. The row is still
  written inside the transaction; only the publication is deferred until after commit,
  matching the existing `issue.inbox_archived` and decision-service calls.
- `server/src/__tests__/issue-evidence-gate.test.ts`: regression test. It hands
  `issueService.update()` an explicit post-commit queue and asserts the evidence-gate
  publication lands on that queue. Before this fix the queue stayed empty because the
  event was published inline, so the test fails on the old code.
- No schema, API, dependency, lockfile, or workflow change.

## Verification

- `tsc -p server/tsconfig.json --noEmit` in the worktree: exit 0 (server typecheck).
- The DB-backed suite (`server/src/__tests__/issue-evidence-gate.test.ts`) could **not**
  be executed in this session's sandbox:
  - `pnpm install --frozen-lockfile` cannot complete. Lifecycle scripts (esbuild's
    `install.js`) are spawned with piped stdio, which the sandbox denies with
    `spawn EPERM`; `--ignore-scripts` leaves the nested worktree's dependency links
    incomplete.
  - A sandbox-compatible runner was attempted (in-process TypeScript transform, worker
    threads instead of forks, a shim that starts the real embedded Postgres with
    ignored stdio and synthesizes its readiness line). It reached the test module, but
    the sandbox also fails to resolve pnpm's Windows junctions to their real paths, so
    dependency lookups inside `node_modules` packages (`superagent`, then a wrong
    `@noble/hashes` version) fail before the suite can run.
- Consequence: the regression test is added but will first execute in CI. The `t3-ci`
  `unit` job does not run server suites; `t3-nightly` does, after merge. The service
  change itself is typechecked locally.

## Follow-up

Two more `logActivity(tx, ...)` calls in the same update transaction still publish
inline on a status change:

- `execution_workspace.source_issue_reopened` (around line 8056)
- `issue.thread_interaction_expired` (around line 8086)

They are the same class of bug but outside this issue's scope. Recommend one follow-up
issue that routes both through `activityPublications`.

## Risk

- Low. One call site; the activity row content and transaction behavior are unchanged.
  The only behavioral difference is that the publication now happens after commit.
- If a caller passes no post-commit queue (non-route callers), the internal
  `ownedActivityPublications` queue is used and drained after the internal transaction
  commits, which is the same timing the other actions already use.

## Model used

- Provider: DeepSeek. Model ID: `deepseek-flash` through DeepSeek Harness (DSH), with
  tool use and code execution. No extended-thinking mode.
