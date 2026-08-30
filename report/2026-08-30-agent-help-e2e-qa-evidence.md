---
title: "Agent-help end-to-end collaboration flow — QA evidence report"
created: "2026-08-30T19:50:00Z"
updated: "2026-08-30T19:50:00Z"
author: "t3-qa"
status: "complete"
tags: ["qa", "agent-help", "acceptance", "blocking-defect"]
---

# Agent-help end-to-end collaboration flow — QA evidence report

Verdict: **FAIL / BLOCK RELEASE.** The combined frontend + backend work does not
form a working end-to-end flow. The frontend and the backend were built against
two different, mutually incompatible contracts, so one click can never produce
an agent invocation. Backend and frontend each pass their own isolated tests;
the integration is broken at the wire level.

## 1. Scope and refs verified

- Workspace: `/root/projects/t3-paperclip-Aitodo/.worktrees/t_819fd622`
  (branch `wt/t_819fd622`), base `8fea5a31d`.
- Frontend work: `wt/t_32f37abe` (`57368124b`, `c4552f3a4`, `a6f359b2c`) —
  "Get agent help" button on task detail.
- Backend work: `wt/t_5bf5dae1` (`2290c29be`) — `POST /api/issues/:issueId/help`.
- Two contract documents were found, and they disagree:
  - `.claude/design-doc-agent-help-metadata-contract.md` (commit `0663f26d7`,
    "Approved implementation contract", t3-architect, 12:09 UTC) — specifies
    `POST /api/issues/:issueId/agent-help`, empty body `{}` + `Idempotency-Key`
    header, response `{ launch_id, issue_id, status: "queued"|"already_queued",
    accepted_at }`, error codes `TASK_ACCESS_DENIED`/`TASK_NOT_FOUND`/
    `TASK_CONTEXT_INVALID`/`TASK_CONTEXT_CONTAINS_SECRET`/
    `AGENT_HELP_ALREADY_ACTIVE`/`AGENT_LAUNCH_UNAVAILABLE`.
  - `docs/specs/agent-help-handoff-contract.md` (commit `cab882855`, "Draft v1",
    17:22 UTC) — specifies `POST /api/issues/:issueId/help`, body
    `{ message (required), idempotencyKey (optional) }`, response
    `{ status: "queued"|"skipped", run, wakeupRequestId, agent }`, error codes
    `invalid_help_message`/`task_unassigned`/`task_status_ineligible`/
    `agent_not_invokable`.

## 2. Commands run and outcomes

Environment: Node v22.23.2, pnpm 9.15.4, vitest 4.1.10, Postgres 16 (docker
`t3-task-view-qa-pg`, 127.0.0.1:55432, db `paperclipqa`).

```sh
# Merge both parent branches into the workspace branch (clean, no conflicts)
git merge --no-edit a6f359b2c          # fast-forward: frontend 3 commits
git merge --no-edit 2290c29be          # ort merge: backend 1 commit

# Backend unit + regression
cd server && npx vitest run src/__tests__/agent-help-handoff-routes.test.ts --pool=forks --maxWorkers=2
#   -> 22 passed (22)
npx vitest run src/__tests__/agent-live-run-routes.test.ts --pool=forks --maxWorkers=2
#   -> 10 passed (10)

# Frontend unit
cd ui && npx vitest run src/api/issues.test.ts src/pages/IssueDetail.test.tsx --pool=forks --maxWorkers=2
#   -> 72 passed (72)

# Browser E2E (network-mocked; does NOT exercise real backend)
DATABASE_URL='postgres://paperclipqa:paperclipqa@127.0.0.1:55432/paperclipqa_ah_e2e' \
  npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/agent-help-button.spec.ts
#   -> 3 passed (37.5s)
```

Note on the requested worker constraint: vitest 4.1.10 rejects the
`--poolOptions` and `--minWorkers` CLI flags (`CACError: Unknown option`). The
server vitest config already pins `pool: "forks"` / `maxWorkers: 1`; I used
`--pool=forks --maxWorkers=2` (the forks pool's worker cap) everywhere above.

Live reproduction against a real server (server booted with the QA Postgres;
migrations already applied):

```sh
# Frontend's exact request -> 404 (route does not exist)
curl -X POST http://127.0.0.1:3199/api/issues/00000000-0000-4000-8000-000000000001/agent-help \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: 00000000-0000-4000-8000-000000000002' \
  -d '{}'
#   HTTP 404  {"error":"API route not found"}

# Backend's route, empty body -> 400 (message required)
curl -X POST http://127.0.0.1:3199/api/issues/00000000-0000-4000-8000-000000000001/help \
  -H 'Content-Type: application/json' -d '{}'
#   HTTP 400  {"error":"Provide a help message between 1 and 4000 characters.","code":"invalid_help_message"}

# Backend's route, with message, nonexistent issue -> 404 "Issue not found"
curl -X POST http://127.0.0.1:3199/api/issues/00000000-0000-4000-8000-000000000001/help \
  -H 'Content-Type: application/json' -d '{"message":"help me"}'
#   HTTP 404  {"error":"Issue not found"}
```

Server log confirms: `POST /issues/.../agent-help 404` (route never matched);
`POST /issues/:issueId/help 400` and `404` with the matching `routePath`.

## 3. Contract-case mapping (acceptance)

Legend: PASS = verified working; DEFECT = blocking defect (integration).

| # | Contract case | Result | Evidence |
|---|---------------|--------|----------|
| 1 | One click -> one agent invocation with correct task identifier, title, description, project goal, current status | **DEFECT (blocking)** | Frontend calls `POST /api/issues/:id/agent-help` with empty body `{}` + `Idempotency-Key` header. Backend only registers `POST /api/issues/:id/help` and requires a `message` body. Live repro: 404 "API route not found". No invocation is ever produced. |
| 2 | Unauthorized user | PASS (backend) / n/a (integration) | Backend test "rejects unauthenticated callers with 401 and agent actors with 403". Verified in isolation; unreachable from the real UI because of #1. |
| 3 | Unassigned task | PASS (both sides, in isolation) | Backend 409 `task_unassigned` test green; frontend disables the button with accessible reason "Assign an agent to this task first." (IssueDetail.test.tsx). Unreachable end-to-end because of #1. |
| 4 | Missing metadata | PASS (backend) / DEFECT (frontend) | Backend rejects missing `message` with 400 `invalid_help_message`; assembles all task metadata server-side from canonical records (nullable columns -> JSON `null`, never omitted) — all unit tests green. But the frontend sends **no message at all**, so even against the correct route it would 400. |
| 5 | Rapid repeated clicks | PASS (each layer, but incompatible) | Frontend pending-ref + `isPending` debounce (unit test asserts exactly 1 call). Backend key-based dedup + 10s-bucket synthesis (unit tests green). But the frontend sends the key in an `Idempotency-Key` header the backend ignores (backend reads `idempotencyKey` from the body), and the frontend generates a fresh UUID per click, so the two dedup mechanisms never interoperate. |
| 6 | Backend failure | PASS (frontend surfaces safe copy) | Frontend `agentHelpFailureCopy` maps codes to fixed copy; unit test + browser test assert the raw server error string never renders. Backend 500 path green. |
| 7 | Agent-provider failure | PASS (backend) / mapping mismatch (frontend) | Backend 409 `agent_not_invokable` (paused/terminated/missing/cross-company) and 202 `skipped` propagation all green. Frontend maps a *different* code set (`AGENT_LAUNCH_UNAVAILABLE` etc.), so a real backend error would render the generic "Unable to request agent help. Retry shortly." |
| 8 | UI accessibility | PASS | Button carries `aria-label`, `aria-describedby` + `sr-only` reason span, `title` tooltip, disabled state; `role="status"` announces queued. Covered by IssueDetail.test.tsx and the browser E2E. |
| 9 | Errors expose no secrets / hidden prompt data | PASS | Frontend renders only code-mapped fixed copy (never `error.message`/`error.body`); browser test asserts `"provider token unavailable"` never appears. Backend returns fixed messages + codes only. |

## 4. Blocking defect — root cause

Two parallel "approved" contract documents exist and specify incompatible wire
formats:

1. `.claude/design-doc-agent-help-metadata-contract.md` (t3-architect,
   `0663f26d7`) — **the frontend implemented this.**
2. `docs/specs/agent-help-handoff-contract.md` (`cab882855`) — **the backend
   implemented this.**

The incompatibilities, all independently verified in source:

| Dimension | Frontend (contract 1) | Backend (contract 2) |
|-----------|----------------------|---------------------|
| Endpoint | `POST /api/issues/:id/agent-help` | `POST /api/issues/:id/help` |
| Request body | `{}` (empty, no keys) | `{ "message" (required), "idempotencyKey"? }` |
| Idempotency key | `Idempotency-Key` HTTP header, fresh UUID per click | `idempotencyKey` body field, else server-synthesized 10s bucket |
| Success response | `{ launch_id, issue_id, status: "queued"\|"already_queued", accepted_at }` | `{ status: "queued"\|"skipped", run, wakeupRequestId, agent }` |
| Error codes | `INVALID_AGENT_HELP_REQUEST`, `TASK_ACCESS_DENIED`, `TASK_NOT_FOUND`, `AGENT_HELP_ALREADY_ACTIVE`, `TASK_CONTEXT_INVALID`, `TASK_CONTEXT_CONTAINS_SECRET`, `AGENT_LAUNCH_UNAVAILABLE` | `invalid_help_message`, `task_unassigned`, `task_status_ineligible`, `agent_not_invokable` |
| Human message | none (server builds everything) | required (`message` 1..4000 chars) |
| Payload shape | `{ schema_version, task{id,title,description,current_status}, project{id,goal} }` | `{ kind, message, requestedByUserId, task{id,identifier,issueNumber,title,description,status}, project{id,name,goal{id,title,description}}, assignedAgent{id,name} }` |

Reproduction steps:

1. Boot the server (e.g. `cd server && DATABASE_URL=... npx tsx src/index.ts`).
2. Click "Get agent help" on any eligible task, or equivalently issue the
   frontend's exact HTTP request.
3. Observe `404 {"error":"API route not found"}` — the endpoint the UI calls is
   not registered anywhere (`server/src/routes/agents.ts` registers only
   `POST /issues/:issueId/help`, line 5369).
4. The UI's `onError` path shows the generic toast "Agent help failed" /
   "Unable to request agent help. Retry shortly." and no wakeup/run is created.

Secondary effect: even if the endpoint path were aligned, the frontend's empty
body would fail the backend's required-`message` validation (400
`invalid_help_message`), and the frontend's error-code switch would not match
any backend code, so every backend error would render generic copy.

## 5. Test-coverage gap (why the suites stayed green)

- The backend's 22 tests mock the services and only exercise `.../help`.
- The frontend's 72 tests mock `issuesApi` and only exercise `.../agent-help`.
- The browser E2E suite (`tests/e2e/agent-help-button.spec.ts`) explicitly
  mocks `POST /api/issues/*/agent-help` at the network layer, with the comment
  "The agent-help backend endpoint is merged on a sibling branch, so this suite
  mocks ... at the network layer". It therefore cannot detect the mismatch, and
  its green result (3/3) does not constitute integration evidence.

There is no single test that mounts the real router and drives the real UI
request shape, which is the gap that let this ship to the integration gate.

## 6. Not run / environment notes

- Browser E2E could not boot via its default `onboard --run` webServer in this
  root container (embedded-PostgreSQL `initdb` fails: "files ... will be owned
  by user 'postgres'"). It was run successfully by pointing `DATABASE_URL` at a
  scratch Postgres DB (`paperclipqa_ah_e2e`) so `onboard` used external
  Postgres. This required a UI build first (`pnpm --filter @paperclipai/ui
  build`, 33s).
- A full real happy-path exercise (create company + invokable agent + assigned
  `todo` issue, then `/help`) was not completed: the blocking endpoint defect
  makes the combined flow unreachable, and the backend payload mapping is
  already covered by the 22 unit tests plus the prior real-Postgres payload QA
  (task `t_cfdc0fbe`).
- The frontend's `agentHelpFailureCopy` code list does not include any backend
  code, so backend error copy is always generic — noted under case 7 above.

## 7. Parallel implementation on an unmerged branch

A second, complete backend implementation of the frontend's `/agent-help`
contract exists on branch `t3-paperclip-aitodo/t_907cdaa8-agent-help-task-context-endpoint`
(commit `60674daeb`, task `t_907cdaa8`, 16:14 UTC). It registers
`POST /api/issues/:issueId/agent-help` (empty body + UUID `Idempotency-Key`),
builds the `agent_help.task_context.v1` payload, and dispatches through the
Hermes-only wakeup path — i.e. it is wire-compatible with the frontend
(`t_32f37abe` / `t_efd75fc4`). This commit is **not** in `origin/main` and was
**not** part of this verification's assigned parent set (t_32f37abe +
t_5bf5dae1), so it is absent from the combined state I verified.

Consequence for resolution: the decomposition produced two competing tracks —

- Track A (contract 1, `/agent-help`): `t_718b81cc` (contract) → `t_907cdaa8`
  (backend `60674daeb`) + `t_efd75fc4`/`t_32f37abe` (frontend).
- Track B (contract 2, `/help`): `t_05d5f360` (contract) → `t_5bf5dae1`
  (backend `2290c29be`) + `t_32f37abe` (frontend, which nevertheless
  implemented `/agent-help`).

This QA task was assigned the mismatched pair (frontend `/agent-help` from Track
A, backend `/help` from Track B). The orchestrator must pick one track and merge
the consistent pair — most plausibly Track A, since both a `/agent-help` backend
and frontend already exist — rather than re-implementing either side.

## 8. Conclusion

Backend `2290c29be` (assigned to this task) implements
`docs/specs/agent-help-handoff-contract.md` (`/help`); the frontend implements
`.claude/design-doc-agent-help-metadata-contract.md` (`/agent-help`). The two
are incompatible, so the combined pair assigned to this QA task does not work.
A wire-compatible `/agent-help` backend (`60674daeb`, task `t_907cdaa8`) exists
on an unmerged branch and would pair correctly with the frontend. The
orchestrator must reconcile the two contract documents and select the
consistent implementation track before this can pass QA.
