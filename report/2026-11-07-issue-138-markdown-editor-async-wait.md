# Issue #138 — flaky MarkdownEditor async-value test

- **Status:** fixed; PR open to `develop`
- **Issue:** [#138](https://github.com/tetracilin/test_ai_todo/issues/138) — "Flaky test: MarkdownEditor 'applies async ...' fails intermittently in unit job"
- **Branch:** `fix/issue-138-markdown-editor-async-wait`
- **Base:** `origin/develop` at `1828f489`
- **Date:** 2026-11-07

## Validity

The issue is still valid on the current `develop`. The test
`applies async external value updates once the editor ref becomes ready`
(`ui/src/components/MarkdownEditor.test.tsx`) still asserted the loaded text after one
fixed `flush()`.

Root cause: the mocked `MDXEditor` attaches its imperative handle in a zero-delay
`setTimeout` callback. `MarkdownEditor` re-applies the latest controlled value from that
callback, which calls the mock's `setContent`. A single `flush()` (one macrotask) can
resolve before React commits that update when the runner is under load, so
`container.textContent` was still the placeholder. That matches the reported
`expected 'Markdown body' to contain 'Loaded plan body'` failure.

## What changed

- `ui/src/components/MarkdownEditor.test.tsx`: the test now waits with `vi.waitFor` for
  the loaded text instead of asserting after one `flush()`. A short comment records the
  timer/callback race. The file already uses `vi.waitFor` for async settling in its raw
  textarea fallback tests, so this follows the existing pattern.
- No production code changed. No other test changed.

## Verification

Local runs used a temporary, uncommitted runner under the worktree's gitignored `tmp/`:
the workspace-write sandbox denies `child_process` spawns with piped stdio, so esbuild's
service and vitest's default forked worker pool cannot start. The temporary config swaps
the esbuild transform for TypeScript's in-process `transpileModule` and uses the
`threads` pool; a preload shim short-circuits Vite's Windows `net use` realpath probe.
The test and component code are identical to what CI runs; only the transform and pool
differ. The shim files are not committed.

- Target test, 20 consecutive runs while a CPU load generator ran
  (`tests 128–174ms` each, all `exit=0`): **20/20 pass**.
- Full file, one run: **38/38 tests pass** (`Test Files 1 passed`).
- `pnpm check:token-gates`: all four gates clean (801 files scanned).
- `tsc -b` for `ui` in the worktree: exit 0.
- Not run locally: the canonical `npx vitest` invocation (blocked by the sandbox
  spawn rule, see above) and the Playwright suites (out of scope for a unit-test fix).
  The PR's `unit` check runs the real ui lane.

## Follow-up

- None required for this issue.
- The repo-wide `build-image` check is red until PR #203 (Corepack/Node 26) merges; that
  is unrelated to this change and is noted in the PR body.

## Risk

- Low. One test file, no runtime behavior change.
- The wait is bounded by vitest's default 1s `waitFor` timeout, so a genuine regression
  fails the test instead of hanging.

## Model used

- Provider: DeepSeek. Model ID: `deepseek-flash` through DeepSeek Harness (DSH), with
  tool use and code execution. No extended-thinking mode.
