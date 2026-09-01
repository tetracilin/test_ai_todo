---
title: "TVR-W06 — Worker Log API logRef filesystem-path exposure (verdict + fix)"
created: 2026-08-30T19:10:00Z
updated: 2026-08-30T19:10:00Z
author: t3-security
status: fixed
tags: [security, task-view-renewal, tvr-w06, log-leak, p1]
---

# TVR-W06 — Worker Log API `logRef` filesystem-path exposure

Task: `t_d9429d04` (from t3-qa review D4). Branch base: `integration/task-view-renewal @ 2146dafe4` (base `8fea5a31d`).

## Verdict: CONFIRMED DEFECT (P1) — fixed

`logRef` **is** a relative filesystem path, and it **did** reach the browser
response on the `local_file` store. This violates TVR-W06 ("No direct filesystem
log path in browser response"). Minimal, low-risk fix applied.

## Evidence chain

1. **`logRef` is a filesystem path, not an opaque key.**
   `server/src/services/run-log-store.ts:271-282` `begin()` builds it as
   `path.join(companyId, agentId, `${runId}.ndjson`)` (segments sanitized via
   `safeSegments`), then returns `{ store: "local_file", logRef: relPath }`.
   `read`/`append`/mirror paths all treat it as a path:
   `resolveWithin(basePath, handle.logRef)` (`:50-54`, `:125`, `:286`), i.e. it
   is resolved against the on-disk log base directory. So the value is shaped
   like `<companyId>/<agentId>/<runId>.ndjson` — a server-internal relative FS
   path that leaks the on-disk log layout.

2. **It reached the browser response.**
   - `server/src/services/heartbeat.ts:19404-19412` `readLog` returned
     `{ runId, store: run.logStore, logRef: run.logRef, ...result }`.
   - Route `GET /heartbeat-runs/:runId/log`
     (`server/src/routes/agents.ts:5080-5094`) is the task-scoped reader surface
     (`heartbeatsApi.log`) and JSON-serializes that object to the client
     (`runRedactions.redactForRun` only strips company secret values, not the
     `logRef`/`store` structural fields).
   - `ui/src/api/heartbeats.ts:101-104` typed the response as
     `{ runId, store, logRef, content, nextOffset? }` — the browser saw `logRef`.

3. **Second identical surface (same class of bug).**
   `server/src/services/workspace-operations.ts:696-718` `readLog` returned the
   same `{ operationId, store, logRef, ...result }`, exposed at
   `GET /workspace-operations/:operationId/log`
   (`server/src/routes/agents.ts:5107-5121`, `heartbeatsApi.workspaceOperationLog`).
   Fixed together — fix the class, not just the reported site.

4. **Removal is safe (no consumer reads it).**
   Every log-read consumer uses only `content`/`nextOffset`:
   - `ui/src/components/useSummaryDraftStream.ts:146-153`
   - `ui/src/components/transcript/useLiveRunTranscripts.ts:294-305`
   - `ui/src/pages/AgentDetail.tsx:3914,3944,3978` and the workspace-op modal
     `:590-599`.
   The `run.logRef` / `operation.logRef` presence booleans used elsewhere in the
   UI come from the run/operation **list** objects, a different payload — not
   touched by this fix.

## Fix (minimal)

Strip `store` and `logRef` from both read payloads at the **service layer** (one
choke point per surface, covers every caller including the routes):

- `server/src/services/heartbeat.ts` `readLog` → returns `{ runId, ...result }`.
- `server/src/services/workspace-operations.ts` `readLog` → returns
  `{ operationId, ...result }`.
- `ui/src/api/heartbeats.ts` — response types narrowed to
  `{ runId, content, nextOffset? }` and `{ operationId, content, nextOffset? }`.
- `server/src/__tests__/agent-live-run-routes.test.ts` — updated the log-read
  assertion to the redacted shape and added explicit
  `not.toHaveProperty("logRef" | "store")` regression guards for TVR-W06.

Both `content` and `nextOffset` are preserved, so log tailing/pagination is
unchanged.

## Verification

- `server` `agent-live-run-routes.test.ts`: **10 passed** (includes the new
  TVR-W06 guards).
- `server` `workspace-operations-reconciliation` + `heartbeat-runtime-skills`:
  pass (1 passed / 4 skipped — pre-existing skips).
- `ui` `useSummaryDraftStream` + `useLiveRunTranscripts`: **20 passed**.
- `ui` `tsc -b`: clean.
- `server` `tsc`: no new errors on the two changed service files (remaining
  errors are pre-existing `@paperclipai/plugin-sdk` dist-not-built noise,
  unrelated to this change).

## Scope note

Committed to this task's own worktree (`.worktrees/t_d9429d04`), not the release
branch, per task instructions.
