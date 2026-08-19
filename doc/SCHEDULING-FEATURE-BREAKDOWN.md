# Scheduling Feature Breakdown — porting `test_ai_todo` into the T3/Paperclip fork

Source: `test_ai_todo` (React 18 + Vite SPA, `gemini-task-manager`), inspected directly
(`types.ts`, `hooks/useTaskStore.ts`, `App.tsx`, and the components listed below) as of
2026-08-19. Target: this fork (`t3-project-management`), an Express 5 + Drizzle/Postgres
server (`server/`) and a React Router UI (`ui/`) forked from Paperclip. Paperclip's `issues`
table (`packages/db/src/schema/issues.ts`) has **no personal-scheduling fields today**
(no `dueDate`/`scheduledTime`/`deferDate`) — only agent-automation fields
(`monitorNextCheckAt`, `executionPolicy`, etc.). Paperclip does have an existing `routines`
concept (`packages/db/src/schema/routines.ts`), but it means "cron-triggered agent
execution issue," not "recurring personal task template." The two are structurally similar
(a recurrence rule that generates task instances) but serve different purposes and must not
be conflated — see the naming note under Routines below.

## Source data model (test_ai_todo `types.ts`)

- `Task` — adds `dueDate`, `deferDate`, `scheduledTime`, `estimate` (minutes), `timerStartedAt`,
  `accumulatedTime`, `routineId` on top of a base item.
- `Routine` — `recurrenceRule` (`Daily` | `Weekly` + `daysOfWeek`), `estimate`, `assigneeId`,
  `lastGeneratedForDate`; a client-side generator (`useTaskStore.ts`) materializes `Task`
  instances from routines up to the current date.
- `TodayViewConfig` — `startHour`/`endHour`/`slotDuration`, drives the agenda grid.
- `LeaveBlock` — ad hoc blocked-out calendar time (title/date/startTime/endTime).
- `InboxFeedFilter` / `dismissedFeedItemIds` — per-user feed preferences for the inbox.

## Feature list (in priority order for porting)

1. **Today View** (`components/TodayView.tsx`, `TodayViewSettingsModal.tsx`) — a per-day
   time-blocked agenda (drag-to-schedule, resize-to-set-duration, live timer) filtered by tag,
   configurable start/end hour and slot size.
2. **Schedule View** (`components/ScheduleView.tsx`) — multi-day agenda/calendar combining
   scheduled and unscheduled tasks, drag-and-drop rescheduling across days.
3. **Calendar** (`components/Calendar.tsx`) — month/date-picker navigation shared by
   Today/Schedule views.
4. **Routines** (`components/RoutineManagementView.tsx`, `RoutineModal.tsx`) — CRUD for
   recurring task templates (daily/weekly + day-of-week) with an assignee and estimate;
   generates concrete task instances going forward.
5. **Inbox** (`components/InboxView.tsx`, `InboxFeed.tsx`, `InboxTasksSheet.tsx`) — unscheduled
   items awaiting triage, plus an activity feed (assignments/collaborations/subtask events)
   with per-user dismiss/filter state.

## Adaptation plan (data model, auth, storage)

- **Data model**: add scheduling columns to Paperclip's `issues` table (or a sibling
  `issue_scheduling` 1:1 table, to avoid widening the already-large `issues` row) —
  `scheduledAt`, `deferUntil`, `scheduledDurationMinutes`. Reuse existing `assigneeAgentId`
  /`assigneeUserId` instead of `Task.assigneeId`; reuse existing `status`/`priority` instead of
  redefining `ItemStatus`. Do **not** import `types.ts` verbatim — it duplicates concepts
  Paperclip's `issues` schema already owns (status, assignee, tags→labels, comments→
  issue_comments).
- **Routines**: name the new personal-recurrence entity distinctly (e.g. `scheduling_routines`
  or extend `routines` with a `kind` discriminator: `agent_execution` vs `recurring_task`) so it
  does not collide with Paperclip's existing agent-routine execution system that the platform
  itself depends on.
- **Auth/storage**: drop Firebase auth/Firestore and `services/firebase.ts` entirely — the fork
  already has its own auth (`server/src/auth`) and Postgres storage. Drop `services/geminiService.ts`
  (AI subtask generation) as out of scope for this port — Paperclip has its own agent/LLM
  integration surface if that capability is wanted later. Drop `services/cryptoService.ts` and
  `services/csvService.ts` — tied to the old client-only storage model; superseded by normal
  server-side persistence and (if needed later) the platform's own export/import.
- **UI**: build new pages under `ui/src/pages/` (e.g. `Today.tsx`, `Schedule.tsx`,
  `Routines.tsx`) and route them alongside the existing `Issues`/board pages rather than
  porting `App.tsx`'s `Perspective` switcher — the fork already owns top-level app shell/routing.

## Discard list (old code not carried forward)

| test_ai_todo file/module | Disposition | Why |
| --- | --- | --- |
| `services/firebase.ts` | Discard | Fork has its own auth/Postgres storage. |
| `services/geminiService.ts` | Discard (out of scope) | AI task generation is a separate concern from scheduling; Paperclip has its own agent/LLM surface. |
| `services/cryptoService.ts` | Discard | Client-side encryption scheme tied to Firestore storage model, not needed server-side. |
| `services/csvService.ts` | Discard | Tied to the old client-only `AppData` blob; not part of scheduling. |
| `hooks/useTaskStore.ts`, `context/TaskContext.tsx` | Discard (logic reference only) | Client-side single-blob state store; fork uses server-backed REST/Drizzle. Recurrence-generation *logic* is worth reusing as a reference when implementing the server-side routine generator, but not the file itself. |
| `types.ts` `AppData`, `ItemStatus`, `ItemType`, `WorkPackageType`, `PhaseType`, `KnowledgeGap`, `Decision*`, `ApprovalRequest`, `Milestone`, `Phase`, `Project` (todo-app version) | Discard | Paperclip already has its own issues/projects/approvals/decisions concepts; the todo-app's parallel versions are superseded, not merged. |
| `types.ts` `Task` scheduling fields, `Routine`, `RecurrenceRule`, `TodayViewConfig`, `LeaveBlock`, `InboxFeedFilter` | Port (adapted) | These are the actual net-new scheduling concepts Paperclip lacks; see adaptation plan above. |

Also removed from the fork itself (not from test_ai_todo): a fabricated top-level
`config/controllers/models/routes/src` Express+Mongoose scaffold that pre-existed at
`/paperclip/t3-project` before this fork was properly copied from `/app`. It was not derived
from the real Paperclip source and did not match this repo's actual architecture — see the
"Fork Paperclip baseline into t3-project" commit for detail.

## Status

- Fork baseline: done (this repo, committed, builds — see commit history).
- This breakdown: done.
- Data-model + backend port (scheduling columns/routes + routine generator): tracked as a
  child issue.
- UI port (Today/Schedule/Calendar/Routines/Inbox pages): tracked as a child issue.
