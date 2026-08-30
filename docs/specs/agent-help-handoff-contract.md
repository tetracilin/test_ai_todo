# Agent-Help Handoff Contract

Status: Draft v1
Audience: backend + frontend implementers of the human-triggered "ask agent for help" action.

Purpose: Define the exact contract for the "ask agent for help" button on a task
(issue) — button eligibility, assigned-agent resolution, the LLM invocation
boundary, the structured metadata payload, permissions, and error/edge states —
so backend and frontend can be built without guessing field names, payload shape,
endpoint, permissions, or status behavior.

## Normative Language

The key words `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, `MAY`, and `OPTIONAL`
are to be interpreted as in RFC 2119.

## Ground Truth (as-built references)

All field names below are taken from the current codebase, not invented:

- Task model: `issues` table — `packages/db/src/schema/issues.ts`.
  - `id` (uuid, `NOT NULL`, PK), `identifier` (text, nullable, e.g. `"ENV-13"`),
    `issueNumber` (integer, nullable), `title` (text, `NOT NULL`),
    `description` (text, nullable), `status` (text, `NOT NULL`, default
    `"backlog"`), `assigneeAgentId` (uuid → `agents.id`, nullable),
    `projectId` (uuid → `projects.id`, nullable), `goalId` (uuid → `goals.id`,
    nullable), `companyId` (uuid, `NOT NULL`), `executionRunId`
    (uuid → `heartbeat_runs.id`, nullable).
- Status enum: `ISSUE_STATUSES` in `packages/shared/src/constants.ts` =
  `["backlog","todo","in_progress","in_review","done","blocked","cancelled"]`
  (`IssueStatus`).
- Agent model: `agents` table — `packages/db/src/schema/agents.ts`
  (`id`, `name`, `companyId`, `status`, `adapterType`).
- Project/goal model: `projects` (`name`, `description`, `goalId`), `goals`
  (`title`, `description`). Goal resolution for an issue follows
  `resolveIssueProjectAndGoal` in `server/src/routes/issues.ts:5663`
  (issue.goalId → project goal → default company goal).
- Wakeup mechanism: `heartbeat.wakeup()` → `enqueueWakeup()`
  (`server/src/services/heartbeat.ts:17628`), backed by the
  `agent_wakeup_requests` table (`packages/db/src/schema/agent_wakeup_requests.ts`).
  A wakeup registers a `heartbeat_runs` run, and the LLM is invoked **inside run
  execution** (`executeRun`, `heartbeat.ts`).
- Auth helpers: `assertBoard`, `getAccessibleResource`, `getActorInfo`
  (`server/src/routes/authz.ts`). Error shapes: `server/src/errors.ts` +
  `server/src/middleware/error-handler.ts` (`{ error, code?, details? }`).
- Reference precedent for a board-only, task-scoped POST that touches runs:
  `POST /issues/:issueId/active-run/stop` in `server/src/routes/agents.ts`
  (commit `5edb99af8`).

This feature is a thin, purpose-built wrapper over the existing wakeup path. It
MUST NOT introduce a second LLM invocation channel.

## 1. Endpoint

`POST /api/issues/:issueId/help`

- `:issueId` MUST accept **either** the issue `id` (uuid) **or** the
  `identifier` (e.g. `ENV-13`), resolved with the existing
  `normalizeIssueIdentifier` + `issueService` lookup used by sibling routes.
- Mounted alongside the other issue routes in `server/src/routes/`
  (`agents.ts` already hosts `active-run/stop`; place `help` next to it or in
  `issues.ts` — implementer's choice, but exactly one route).

### Request body (frontend → backend)

```json
{
  "message": "Please double-check the failing pagination test before you continue.",
  "idempotencyKey": "help-9f2c1a84-1730490000000"
}
```

| Field            | Type              | Required | Notes |
|------------------|-------------------|----------|-------|
| `message`        | string            | yes      | Human's free-text ask. `MUST` be trimmed; length 1..4000 chars. Empty/whitespace-only → `400`. |
| `idempotencyKey` | string            | no       | Debounce/dedupe key (see §6). If omitted, backend generates one. Max 200 chars. |

The frontend `MUST NOT` send task metadata (title, description, status, goal,
agent id). The backend is the single source of truth for those and assembles
them server-side (§4, §5). The client only supplies the human message.

## 2. Button Eligibility (frontend)

The "ask agent for help" button:

- `MUST` be **shown** only on the task (issue) detail view of a task the current
  user's company can access.
- `MUST` be **enabled** only when ALL of:
  1. The task has an assigned agent (`issue.assigneeAgentId != null`). If
     unassigned, the button is `disabled` with tooltip
     "Assign an agent to this task first." (Backend still enforces — §6.)
  2. The task `status` is one of `todo`, `in_progress`, `in_review`, `blocked`.
     - `MUST` be disabled for `done` and `cancelled` (terminal).
     - `MUST` be disabled for `backlog` — `enqueueWakeup`/`queueIssueAssignmentWakeup`
       intentionally skip `backlog` (see `issue-assignment-wakeup.ts:31`), so a
       help request on a `backlog` task would be silently dropped.
  3. The current user has board write access to the task's company (§7).
- `SHOULD` enter a transient disabled/loading state on click until the response
  returns, to suppress rapid double-clicks (defense in depth with §6).

Eligibility is a UX affordance only. The backend re-validates every condition
and is authoritative; the frontend `MUST NOT` rely on hiding the button for
security.

## 3. Assigned-Agent Resolution

- The target agent is resolved **server-side** as `issue.assigneeAgentId`.
- Behavior when the task is **unassigned** (`assigneeAgentId == null`):
  **BLOCK.** Return `409 { "code": "task_unassigned" }` (§6). Do NOT fall back to
  a manager, lead, or any other agent, and do NOT auto-assign. Resolution is
  strictly the current assignee, so the human always knows which agent they are
  invoking.
- If the assignee agent is not invokable (paused / terminated / pending_approval /
  broken reporting chain), return `409` with the reason from
  `agentInvokability` (`server/src/services/agent-invokability.ts`) rather than
  enqueuing a wake that would be skipped.

## 4. LLM Invocation Boundary

- The frontend `MUST NOT` call any model/LLM directly. It only calls
  `POST /api/issues/:issueId/help`.
- The backend performs the model invocation **indirectly** by enqueuing a
  wakeup for the assignee agent via `heartbeat.wakeup(assigneeAgentId, ...)`.
  The LLM call happens later, inside `executeRun`, exactly as for every other
  agent run. The HTTP handler `MUST NOT` block on model output.
- Mapping onto `enqueueWakeup` (`WakeupOptions`):
  - `source: "on_demand"`
  - `triggerDetail: "manual"`
  - `reason: "human_agent_help"`
  - `requestedByActorType: "user"`
  - `requestedByActorId`: the acting user id (`getActorInfo(req).actorId`)
  - `idempotencyKey`: from body or generated (§6)
  - `payload`: the structured metadata object in §5 plus the human `message`
  - `contextSnapshot`: `{ issueId, triggeredBy: "user", helpRequest: true }`

### Response (backend → frontend)

On accepted enqueue (a run was created):

```
202 Accepted
{
  "status": "queued",
  "run": { "id": "<heartbeat_run uuid>", "status": "queued" },
  "wakeupRequestId": "<agent_wakeup_requests uuid>",
  "agent": { "id": "<agent uuid>", "name": "Ada" }
}
```

On a valid request that the wakeup layer skipped (e.g. scheduling suppressed,
coalesced duplicate) — `heartbeat.wakeup` returns `null`:

```
202 Accepted
{ "status": "skipped", "reason": "<skip reason>", "agent": { "id": "...", "name": "..." } }
```

`202` (not `200`) signals async acceptance; work continues in the background.

## 5. Structured Metadata Payload (backend-assembled)

Assembled server-side and passed as `enqueueWakeup(...).payload`. Concrete
shape (this is the exact JSON example the acceptance criteria require):

```json
{
  "kind": "agent_help_request",
  "message": "Please double-check the failing pagination test before you continue.",
  "requestedByUserId": "user_01H...",
  "task": {
    "id": "b73d7a73-1943-7860-851c-177c214c6e96",
    "identifier": "ENV-13",
    "issueNumber": 13,
    "title": "Fix pagination on the issues list endpoint",
    "description": "Cursor pagination returns duplicates across pages when...",
    "status": "in_progress"
  },
  "project": {
    "id": "3f1c...",
    "name": "Platform Core",
    "goal": {
      "id": "9a2b...",
      "title": "Ship stable public API v1",
      "description": "All list endpoints paginate deterministically."
    }
  },
  "assignedAgent": { "id": "c4d5...", "name": "Ada" }
}
```

### Field sourcing and missing-value behavior

| Payload field                 | Type              | Source (model.field / resolver)                              | If missing |
|-------------------------------|-------------------|-------------------------------------------------------------|------------|
| `kind`                        | string (const)    | Literal `"agent_help_request"`                              | never missing |
| `message`                     | string            | request body `message` (trimmed)                            | request rejected `400` before payload build |
| `requestedByUserId`           | string            | `getActorInfo(req).actorId`                                 | never missing (auth required) |
| `task.id`                     | string (uuid)     | `issues.id`                                                 | never null (`NOT NULL` PK) |
| `task.identifier`             | string \| null    | `issues.identifier`                                         | `null` — column is nullable; emit `null`, never omit |
| `task.issueNumber`            | integer \| null   | `issues.issueNumber`                                        | `null` |
| `task.title`                  | string            | `issues.title`                                              | never null (`NOT NULL`) |
| `task.description`            | string \| null    | `issues.description`                                        | `null` — nullable; emit `null`, never `""`, never omit |
| `task.status`                 | string (enum)     | `issues.status` (`IssueStatus`)                             | never null (`NOT NULL`, default) |
| `project`                     | object \| null    | `resolveIssueProjectAndGoal(issue).project`                | `null` when task has no project |
| `project.id`                  | string (uuid)     | `projects.id`                                               | n/a when `project` is `null` |
| `project.name`                | string            | `projects.name` (`NOT NULL`)                               | n/a |
| `project.goal`                | object \| null    | `resolveIssueProjectAndGoal(issue).goal`                  | `null` when no goal resolves (issue → project → default) |
| `project.goal.id`             | string (uuid)     | `goals.id`                                                  | n/a when `goal` is `null` |
| `project.goal.title`          | string            | `goals.title` (`NOT NULL`)                                 | n/a |
| `project.goal.description`    | string \| null    | `goals.description`                                         | `null` |
| `assignedAgent.id`            | string (uuid)     | `issues.assigneeAgentId`                                    | request rejected `409 task_unassigned` before payload build |
| `assignedAgent.name`          | string            | `agents.name` (`NOT NULL`)                                 | never null once resolved |

Rules:
- Nullable columns `MUST` be serialized as JSON `null`, never as `""` and never
  omitted, so the agent-side consumer can rely on a stable key set.
- `project.goal` uses the same fallback chain the task detail view already uses
  (`resolveIssueProjectAndGoal`): issue-level goal, else project goal, else the
  default company goal. If that whole chain yields nothing, `project.goal` is
  `null`.
- Never abort the request solely because `description`, `identifier`,
  `issueNumber`, `project`, or `goal` is missing. Only a missing `message`
  (`400`) or a missing assignee (`409`) blocks the request.

## 6. Error / Edge States

All error responses use the standard shape from `error-handler.ts`:
`{ "error": "<message>", "code": "<code>", "details"?: {...} }`.

| Condition | HTTP | `code` | Behavior |
|-----------|------|--------|----------|
| Missing/empty/whitespace `message` | `400` | `invalid_help_message` | Reject before any side effect. |
| `message` over 4000 chars | `400` | `invalid_help_message` | Reject. |
| Task not found OR company not accessible to caller | `404` | (none) | Return `{ "error": "Issue not found" }` via `getAccessibleResource` — do NOT leak existence across companies. |
| Unauthenticated | `401` | (none) | `assertAuthenticated`. |
| Caller is an agent, or lacks board write access to the company | `403` | (none) | `assertBoard` → `{ "error": "Board access required" }`; viewer role → `{ "error": "Viewer access is read-only" }`. Agents `MUST NOT` trigger this. |
| Task unassigned (`assigneeAgentId == null`) | `409` | `task_unassigned` | Block; no fallback, no auto-assign (§3). |
| Task in terminal/ineligible status (`done`, `cancelled`, `backlog`) | `409` | `task_status_ineligible` | `details: { status }`. |
| Assignee agent not invokable (paused/terminated/pending_approval/broken chain) | `409` | `agent_not_invokable` | `details` from `agentInvokability`. |
| Duplicate / rapid clicks | `202` | — | Idempotent: same `idempotencyKey` within the window returns the existing run (or a `{ "status": "skipped", "reason": "duplicate" }`) instead of creating a second run. See below. |
| Agent invocation/enqueue failed downstream (e.g. scheduling suppressed) | `202` | — | `{ "status": "skipped", "reason": "<reason>" }` when `heartbeat.wakeup` returns `null`. |
| Unexpected server error | `500` | (none) | Standard handler; do not create a run. |

### Duplicate / rapid-click handling (idempotency + debounce)

- Two layers, both `MUST` be implemented:
  1. **Client debounce**: the button enters a disabled/loading state on click
     until the response returns (§2).
  2. **Server idempotency**: the handler passes `idempotencyKey` through to
     `enqueueWakeup`, which persists it on `agent_wakeup_requests.idempotencyKey`.
     If `idempotencyKey` is omitted by the client, the server `MUST` synthesize a
     deterministic key of the form
     `agent_help:<issueId>:<floor(now / 10s)>` so that identical rapid clicks
     within a 10-second window collapse to one wake.
- A repeated request with a key that maps to an in-flight/queued help wake
  `MUST` return `202` referencing the existing run rather than creating a new run.

## 7. Permissions

- Authorization is enforced **on the endpoint**, server-side, and `MUST NOT`
  rely on the frontend hiding the button.
- Enforcement order in the handler:
  1. `assertBoard(req)` — only board (human) actors; agents are rejected `403`.
  2. `getAccessibleResource(req, res, issueLookup, "Issue not found")` — resolves
     the task and enforces company scoping; returns `404` if the caller's company
     cannot see it. For non-`local_implicit`/non-instance-admin board users this
     also enforces active company membership and rejects `viewer` role on this
     write (`assertCompanyAccess`, `authz.ts`).
- Net authorized set: board users who are instance admins, or active
  (non-viewer) members of the task's company. Agents and viewers `MUST NOT`
  trigger the action.
- Every accepted request `MUST` write an activity-log entry via `logActivity`
  (`action: "agent_help.requested"`, `entityType: "issue"`, `entityId: issue.id`,
  `details: { agentId, runId, idempotencyKey }`) mirroring the `active-run/stop`
  precedent.

## 8. Acceptance Checklist

- [x] Endpoint, method, and `:issueId` accepted forms specified.
- [x] Request body fields typed; frontend sends only `message` (+ optional key).
- [x] Button eligibility (shown/enabled) fully specified incl. `backlog` caveat.
- [x] Assigned-agent resolution + unassigned = block (no fallback) specified.
- [x] LLM boundary: frontend never calls model; backend enqueues wakeup; `202`.
- [x] Exact metadata payload with a concrete JSON example.
- [x] Every metadata field lists source + missing-value behavior.
- [x] Error/edge states with HTTP codes and error payload shape.
- [x] Duplicate-click idempotency/debounce specified.
- [x] Permissions + endpoint-level enforcement specified.
