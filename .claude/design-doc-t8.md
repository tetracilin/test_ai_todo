# Design Document: Human–Agent Collaborative Project Management

**Status:** Draft for approval
**Issue:** T-8
**Author:** Chief of staff (CEO agent)
**Date:** 2026-08-18

## 1. Context

T3's mission is to build a project management tool, forked from the existing codebase in this
repo, that lets a human and one or more AI agents collaborate on the same body of work in a way
that feels natural for project management — not a chat window bolted onto a task list.

The repo currently contains a working single-user app ("Gemini Task Manager"): a React 19 + Vite +
TypeScript client backed by Firebase, with no server of its own. It already models a fair amount
of PM domain:

- **Tasks** and **WorkPackages** (a "GTD + PM" style hierarchy: inbox tasks, subtasks, sequential /
  parallel / single-action-list work packages)
- **Persons** with `assigneeId` / `collaboratorIds` on tasks, and a RACI matrix
  (responsible/accountable/consulted/informed) on work packages
- **Projects**, **Phases**, **Milestones**, **Decisions** (with knowledge gaps), **Routines**
  (recurring task generation), a **Log** of actions, and an **Inbox feed**
- One AI touchpoint: `services/geminiService.ts` calls Gemini directly from the client to turn a
  work package title into a flat list of sub-task strings (`generateSubTasks`). This is a one-shot
  content-generation call, not an agent with identity, task ownership, or the ability to act on
  the board over time.
- Persistence is Firebase (`services/firebase.ts`) with client-side reads/writes; there is no
  backend API an external process could call.

So today: humans can assign work to other humans (`Person`), and can ask an LLM to draft subtasks.
There is no notion of an **agent as a participant** — something with an identity that can be
assigned a task, read its context, post progress, change its status, and be visible in the same
UI a human uses. That gap is exactly what T3's mission asks us to close, and it's the natural next
step given the domain model already in `types.ts`.

## 2. Product vision

A task board where **agents are first-class collaborators, not integrations**:

- A human creates or assigns a Task/WorkPackage to an agent the same way they assign it to a
  Person today.
- The agent has an identity, shows up in Team/RACI views, and can read the tasks it owns through a
  small API.
- The agent works the task and reports back through the *same* surfaces a human teammate would
  use: comments/log entries, status transitions, blockers, attachments — not a side channel.
- The human never has to leave the task view to know what the agent did, why, or what's blocked.

The differentiator vs. a generic "connect an LLM to my tasks" integration is that agent activity is
modeled with the same primitives as human activity (`Person`-like identity, `LogEntry`, task
status, `BlockageDetails`), so the UI doesn't need a parallel "agent activity" view — it's the same
view.

## 3. Key design decisions

### 3.1 Agent as a participant type
Introduce an `Agent` entity that is structurally close to `Person` (name, avatar, id) but
distinguishable in the UI (badge/icon) and carrying agent-specific fields: an API key/secret
reference, a status (`active`/`paused`), and an optional short "role" description shown on hover.
`assigneeId` / `collaboratorIds` fields on `Task` become "participant ids" that can resolve to
either a `Person` or an `Agent`. This reuses the existing RACI and assignment plumbing instead of
forking it.

**Alternative considered:** bolt agents on as a special flag on `Person`. Rejected — agents need
fields (API credentials, run status) that don't belong on a human record, and treating them as a
distinct type keeps permissions and future governance (budgets, pause/resume) clean.

### 3.2 A real API surface
Today nothing external can read or write this board — it's a client talking straight to Firebase.
Agents need a minimal HTTP API to: list tasks assigned to them, read a task's full context (note,
requirements, comments), post a comment/log entry, and change status (including
`isBlocked`/`BlockageDetails`). This is the smallest possible slice of what Paperclip's own
issue API does (checkout, comment, status update) — we are deliberately not rebuilding Paperclip's
governance layer, just the read/write path an agent needs to act on a task.

**Alternative considered:** give agents direct Firebase credentials and let them write straight to
Firestore like the client does. Rejected — no place to enforce "agent can only touch tasks
assigned to it," no audit trail distinct from client writes, and it couples every future agent
integration to Firebase's SDK instead of a stable HTTP contract.

### 3.3 Activity is a `LogEntry`, not a new concept
`LogAction` already has `CREATE`/`UPDATE`/`GENERATE`/`CLARIFY`/`BLOCK`. Agent actions post through
the same `LogEntry` model with `userId` pointing at the agent's id, so `LogView` and
`InboxFeed` need no new rendering path beyond an avatar/badge treatment for non-human actors.

### 3.4 Status model stays human-legible
Agents operate within the existing `ItemStatus` enum (Active/Completed/Dropped/On-going/Blocked)
rather than introducing agent-specific states. When an agent can't proceed, it uses the existing
`isBlocked` + `BlockageDetails` mechanism already built for humans — this is the one place the
domain model already anticipated "someone is stuck and needs another person," which maps directly
onto an agent needing human input.

## 4. Architecture options considered

| Option | Description | Verdict |
|---|---|---|
| A. Firestore Cloud Functions as the agent API | Add Firebase Cloud Functions exposing the read/write endpoints in 3.2, auth'd via a per-agent key checked against a `agents` collection | **Chosen for MVP** — no new infra, reuses existing Firebase project, smallest change |
| B. Standalone backend service | New Node/Express (or similar) service in front of Firestore or its own DB | Deferred — right long-term shape if the API surface grows (webhooks, streaming updates), but unjustified infra cost for MVP |
| C. Agents write directly to Firestore with scoped security rules | Use Firestore security rules to scope an agent's writes | Rejected — security rules can't express "only comment/status endpoints, not arbitrary field writes" as cleanly as an API layer, and there's no place to run validation (e.g. required blocker reason) |

## 5. First MVP

**Goal:** prove that a human and one agent can collaborate on a single task end-to-end using only
primitives that already exist in the UI, with the smallest possible surface.

**In scope:**
1. `Agent` type added to `types.ts`, stored alongside `Person` in `AppData`; minimal creation UI
   (reuse `PersonManagementView` patterns) to register an agent with a name and generated API key.
2. `assigneeId` on `Task` may reference an `Agent`; existing task list / detail views render an
   agent badge instead of a person avatar when resolved.
3. Three Cloud Function endpoints, authenticated by the agent's API key:
   - `GET /agent/tasks` — tasks currently assigned to the calling agent
   - `GET /agent/tasks/:id` — full task detail (note, requirements, existing comments/log)
   - `PATCH /agent/tasks/:id` — update status, post a log entry/comment, or set
     `isBlocked`/`BlockageDetails`
4. Agent-authored `LogEntry` rows render in `LogView` and `InboxFeed` with a distinct badge.
5. One worked example: manually register a test agent, assign it a task, drive it through the API
   with curl/a script, and confirm the human sees the update in the existing UI without a refreshed
   build.

**Explicitly out of scope for MVP** (future phases, not forgotten — just sequenced later):
- Multi-agent orchestration, delegation, or agent-to-agent handoff
- Budgets, spend tracking, or approval gates on agent actions
- Agent-initiated task *creation* (MVP is human-assigns, agent-executes only)
- Structured interactions (confirmations, checkbox approvals, suggested tasks) — MVP uses the plain
  comment/status/blocker primitives that already exist
- Routines/scheduling for agents, or a heartbeat/wake model
- Real-time push to the client (MVP can rely on normal Firestore listeners already in use)

**Why this scope:** it is the smallest change that makes the core value prop real and testable —
"a human assigns a task to an agent and watches it get worked" — using almost entirely existing UI
and data model, with the one genuinely new piece (the API surface) kept as small as it can be.

## 6. Success criteria

- A human can assign a `Task` to a registered `Agent` from the existing UI.
- An external process, authenticated only with the agent's API key, can fetch that task, post a
  progress comment, and mark it done — all visible in the unmodified `ItemDetail`/`LogView` UI.
- No changes required to `Person`, `WorkPackage`, `Project`, `Decision`, or `Routine` data models.

## 7. Open questions for the approver

1. Does the first agent integration target this repo's own agents (dogfooding T3 on itself) or an
   external test agent/script? Affects how "done" is demonstrated.
2. Is Firebase Cloud Functions an acceptable backend choice long-term, or should we plan the
   migration to Option B (standalone service) sooner rather than later?
3. Any must-have field on `Agent` beyond name/avatar/API key/status for MVP (e.g., a "role"
   description shown in RACI views)?
