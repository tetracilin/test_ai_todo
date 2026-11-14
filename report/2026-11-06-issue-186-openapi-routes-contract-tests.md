# Issue #186 — restore the openapi-routes contract tests

**Run:** DSH superagent (DeepSeek Harness), 2026-11-06
**Issue:** [#186](https://github.com/tetracilin/test_ai_todo/issues/186)
**Branch:** `fix/issue-186-restore-openapi-routes-tests`
**Base:** `develop` at `1828f489`

## Status

The suite is restored and green. The route-coverage assertion keeps the four
known gaps pinned, so new drift still fails the build.

## What was wrong

Commit `68fb60e9` (PR #180) deleted all of `server/src/__tests__/openapi-routes.test.ts`
to clear one red t3-nightly assertion. Four of its five tests did not depend on
that assertion, so the deletion also removed:

- `/api/openapi.json` is served through `errorHandler`
- auth and response-code invariants
- the Claude browser-code grammar and strict setup-token response shapes
- the 404 non-member gate on setup-token cancel

## What changed

- Restored `server/src/__tests__/openapi-routes.test.ts` (376 lines).
- The route-coverage test now pins the known drift in two exact allowlists:
  - `knownUnmappedRouteFiles`: `artifacts.ts`, `discord-integrations.ts`,
    `scheduling.ts`, `wopi.ts`
  - `knownUndocumentedRoutes`: the four routes those files register outside the
    documented surface
- Each allowlist is asserted to be exactly the current drift, so documenting a
  route or mapping a file fails the test until its entry is removed. New drift
  fails immediately.
- Restored the file's entry in `scripts/serialized-shard-durations.json` (3234 ms).

## Verification

```sh
npx vitest run server/src/__tests__/openapi-routes.test.ts
```

Result: 5 of 5 tests pass. Before the change the coverage test failed with
4 `missingInSpec` routes and 4 `unknownRouteFiles`, exactly as #186 reported.

The server suite was run directly (not through `pnpm test`) as `CLAUDE.md`
requires for `server/` changes.

## Remaining work (follow-up, not in this PR)

Documenting the drift is a larger change: 43 routes across the four files, in
`server/src/routes/openapi.ts`. The allowlists are the tracking device. Delete
entries as the documentation lands.

## Risk

Low. Test-only change plus one manifest value. No production code, API, schema
or workflow change.
