# Issue Scheduling: Events, Quick Add and Pin Implementation Plan

**Goal:** Add a quick-add composer, a projected time block with an explicit **Pin** action, and a separate calendar-event entity to Paperclip's existing issue scheduling, and fix the defects found in the current scheduling path.

**Architecture:** Scheduling already exists as a one-to-one side table (`issue_scheduling`). This plan keeps that table working, adds a `calendar_events` table for pinned blocks, and dual-writes both for one release so the previous release keeps working. Phase A hardens the existing path. Phase B adds the event entity. Phase C adds the UI. Phase D (the external API for the timesheet tool) is gated and not planned here.

**Tech Stack:** TypeScript, Express, Drizzle ORM (Postgres), Zod, React + Vite, TanStack Query, Vitest (embedded Postgres for service tests, supertest with mocked services for route tests, jsdom for UI tests).

**Spec:** `technical-spec/specs/2026-10-13-sunsama-quick-add-pin-to-schedule-design.md` (sections 4, 5, 7a to 7d). Read it first. It records what was observed in Sunsama and what already exists in this repo.

## Assumptions to confirm before starting

These are choices the owner has not yet confirmed. Each one changes the tasks named next to it.

- **A1 (decided by owner, 2026-10-13):** a pinned block is its own entity (`calendar_events`). Tasks 4 and 5.
- **A2 (assumed):** the issue's planned estimate is `issue_scheduling.scheduled_duration_minutes`. No new estimate column is added. Tasks 3, 6 and 7. If the owner wants separate "estimate" and "block length", add a column in Task 4 and change Task 3.
- **A3 (assumed):** pinning into an occupied slot is allowed. Overlap is not rejected. Task 5.
- **A4 (assumed):** the existing permission `tasks:assign` also guards the new routes, because the existing scheduling routes use it. Tasks 3 and 5.
- **A5 (decided by owner):** no Google or Microsoft calendar sync in this plan. It is on the roadmap as "someday".
- **A6 (open, spec 7c):** the timesheet tool's contract is unknown. Phase D is blocked until the owner answers.

## Global Constraints

- Base path `/api`. Every route applies `assertCompanyAccess` and a permission check, and every mutation writes an activity log entry. (`AGENTS.md` section 8)
- HTTP errors use `400/401/403/404/409/422/500`. (`AGENTS.md` section 8)
- Everything is company-scoped. An agent key must not access another company.
- Timestamps cross the API as ISO-8601 strings with `Z` or an offset. Storage is `timestamptz`.
- Paging keeps the existing rule: `limit` is an integer from 1 to 100, default 50.
- Migrations are forward-only and backward-compatible with the previous release for one cycle. They run automatically on container start. (`CLAUDE.md`)
- Data-model workflow: edit `packages/db/src/schema/*.ts`, export from `packages/db/src/schema/index.ts`, run `pnpm db:generate`, then `pnpm -r typecheck`. (`CLAUDE.md`)
- A change to a contract touches `packages/db`, `packages/shared`, `server` and `ui` together. (`AGENTS.md` section 5.2)
- UI code in `ui/src/components/**` and `ui/src/pages/**` uses only tokens from `ui/src/index.css`: no hex, raw px, arbitrary Tailwind bracket values or raw font sizes. Run `pnpm check:token-gates` before committing UI changes. (`CLAUDE.md`)
- `t3-ci` does not run server tests. Before opening a PR that touches `server/`, run `pnpm --filter @paperclipai/plugin-sdk ensure-build-deps`, then `npx vitest run server/src/__tests__/<file>.test.ts` for each server test file you touched. (`CLAUDE.md`)
- Documents live under `technical-spec/`. Do not create `doc/` or `docs/`. (`CLAUDE.md`)
- Branch from current `develop` with a `feature/*` name. Squash-merge. Fill `.github/PULL_REQUEST_TEMPLATE.md` in full. Do not touch `.github/workflows/`, `deploy/compose.yaml` or `deploy/scripts/` in the same PR as application code. (`CLAUDE.md`)

## Review Focus

Cases the spec implies that the tasks' main tests do not cover, most likely first. Each has a pinning test in the task named.

1. **Day boundary.** An event at 00:30 local time on the next day, stored as the previous UTC day, must appear in the local day's range. Pinned in Task 5 (`lists events on the exact range boundaries`).
2. **Double submit.** Pressing Enter twice, or a retried request, must create one issue. Pinned in Task 3 (`returns the same issue for a repeated clientRequestId`) and Task 6 (`ignores a second submit while pending`).
3. **Overlap.** Pinning into an occupied slot returns 200 and both events exist. Pinned in Task 5 (`allows overlapping events`).
4. **No estimate.** Pinning an issue with no estimate and no duration uses 30 minutes, the same default the grid already uses. Pinned in Task 5 (`uses 30 minutes when no duration is known`).
5. **Delete a pinned issue.** The event must be removed with the issue. Pinned in Task 4 (`removes the event when its issue is deleted`).

Not covered by any task and left to the owner: whether completing an issue should unpin or dim its event.

## Delivery Order

Each phase is its own PR from its own `feature/*` branch off `develop`. Phase B changes the database, so it ships alone.

| PR | Tasks | Branch |
|---|---|---|
| 1 | 1, 2, 3 | `feature/scheduling-hardening` |
| 2 | 4, 5 | `feature/calendar-events` |
| 3 | 6, 7 | `feature/today-quick-add-and-pin` |

---

## Phase A: Harden the existing scheduling path

### Task 1: Write scheduling and its activity entry in one transaction, with previous values

**Why:** The scheduling routes call the service, then `logActivity`, as two separate steps. A crash between them loses the log entry. The log entry also holds only the new values. (Spec 7b gaps 3 and 4.)

**Files:**
- Modify: `server/src/services/scheduling.ts:206-233` (upsert), `server/src/services/scheduling.ts:235-242` (clear), `server/src/services/scheduling.ts:513-516` (returned methods)
- Modify: `server/src/routes/scheduling.ts:86-135`
- Test: `server/src/__tests__/scheduling-routes.test.ts`
- Test: `server/src/__tests__/scheduling-service.test.ts`

**Interfaces:**
- Consumes: `logActivity(db, input, postCommitPublications?)` and `publishActivity(publication)` from `server/src/services/activity-log.ts`; `ActivityPublication` from the same file.
- Produces: `schedulingService(db).upsertIssueSchedulingWithPrevious(companyId, issueId, patch): Promise<{ scheduling: IssueScheduling; previous: IssueScheduling | null }>`. The existing `upsertIssueScheduling` stays and returns only `scheduling`.

- [ ] **Step 1: Write the failing service test**

Add to `server/src/__tests__/scheduling-service.test.ts`, inside the `describeEmbeddedPostgres` block, after the first test:

```ts
  it("returns the previous scheduling row from upsertIssueSchedulingWithPrevious", async () => {
    const { companyId, issueSvc, svc } = await seedFixture();
    const issue = await issueSvc.create(companyId, { title: "Prev", status: "todo", priority: "medium" });

    const first = await svc.upsertIssueSchedulingWithPrevious(companyId, issue.id, {
      scheduledAt: new Date("2026-10-14T03:00:00.000Z"),
      scheduledDurationMinutes: 30,
    });
    expect(first.previous).toBeNull();
    expect(first.scheduling.scheduledDurationMinutes).toBe(30);

    const second = await svc.upsertIssueSchedulingWithPrevious(companyId, issue.id, {
      scheduledDurationMinutes: 45,
    });
    expect(second.previous?.scheduledDurationMinutes).toBe(30);
    expect(second.previous?.scheduledAt).toBe("2026-10-14T03:00:00.000Z");
    expect(second.scheduling.scheduledDurationMinutes).toBe(45);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @paperclipai/plugin-sdk ensure-build-deps && npx vitest run server/src/__tests__/scheduling-service.test.ts -t "previous scheduling row"`
Expected: FAIL with `svc.upsertIssueSchedulingWithPrevious is not a function`.

- [ ] **Step 3: Implement the service method**

In `server/src/services/scheduling.ts`, replace the body of `upsertIssueScheduling` (lines 206 to 233) with these two functions:

```ts
  async function upsertIssueSchedulingWithPrevious(
    companyId: string,
    issueId: string,
    patch: UpsertIssueScheduling,
  ): Promise<{ scheduling: IssueScheduling; previous: IssueScheduling | null }> {
    if (!(await getIssueRowInCompany(companyId, issueId))) throw notFound("Issue not found");
    const existing = await db
      .select()
      .from(issueScheduling)
      .where(eq(issueScheduling.issueId, issueId))
      .then((rows) => rows[0] ?? null);
    const values = {
      scheduledAt: patch.scheduledAt === undefined ? existing?.scheduledAt ?? null : patch.scheduledAt,
      deferUntil: patch.deferUntil === undefined ? existing?.deferUntil ?? null : patch.deferUntil,
      scheduledDurationMinutes:
        patch.scheduledDurationMinutes === undefined
          ? existing?.scheduledDurationMinutes ?? null
          : patch.scheduledDurationMinutes,
      updatedAt: new Date(),
    };
    const row = await db
      .insert(issueScheduling)
      .values({ issueId, companyId, ...values })
      .onConflictDoUpdate({ target: issueScheduling.issueId, set: values })
      .returning()
      .then((rows) => rows[0]!);
    return {
      scheduling: toIssueScheduling(row),
      previous: existing ? toIssueScheduling(existing) : null,
    };
  }

  async function upsertIssueScheduling(
    companyId: string,
    issueId: string,
    patch: UpsertIssueScheduling,
  ): Promise<IssueScheduling> {
    return (await upsertIssueSchedulingWithPrevious(companyId, issueId, patch)).scheduling;
  }
```

In the object returned at the end of `schedulingService` (around line 513), add `upsertIssueSchedulingWithPrevious,` after `upsertIssueScheduling,`.

- [ ] **Step 4: Run the service test to verify it passes**

Run: `npx vitest run server/src/__tests__/scheduling-service.test.ts`
Expected: PASS, including the existing tests.

- [ ] **Step 5: Write the failing route tests**

In `server/src/__tests__/scheduling-routes.test.ts`:

1. Add `upsertIssueSchedulingWithPrevious: vi.fn(),` to `mockSchedulingService`.
2. Add `const mockPublishActivity = vi.hoisted(() => vi.fn());` and add `publishActivity: mockPublishActivity,` to the `vi.mock("../services/index.js", ...)` factory.
3. Change `app.use("/api", schedulingRoutes({} as any));` to:

```ts
  const fakeDb = { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}) };
  app.use("/api", schedulingRoutes(fakeDb as any));
```

4. Add these tests inside `describe("scheduling routes", ...)`:

```ts
  it("logs previous values with the write and publishes after commit", async () => {
    const issueId = "22222222-2222-4222-8222-222222222222";
    const row = (scheduledAt: string, minutes: number) => ({
      issueId, companyId, scheduledAt, deferUntil: null, scheduledDurationMinutes: minutes,
      createdAt: "2026-10-14T00:00:00.000Z", updatedAt: "2026-10-14T00:00:00.000Z",
    });
    mockSchedulingService.upsertIssueSchedulingWithPrevious.mockResolvedValue({
      scheduling: row("2026-10-14T03:00:00.000Z", 30),
      previous: row("2026-10-14T02:00:00.000Z", 15),
    });
    mockLogActivity.mockImplementation(async (_db: unknown, _input: unknown, pubs?: unknown[]) => {
      pubs?.push({ companyId, payload: {}, pluginEvent: null });
      return { id: "activity-1" };
    });

    const res = await request(await createApp(editorActor()))
      .put(`/api/companies/${companyId}/issues/${issueId}/scheduling`)
      .send({ scheduledAt: "2026-10-14T03:00:00.000Z" });

    expect(res.status).toBe(200);
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "issue.scheduling_updated",
        details: expect.objectContaining({
          scheduledDurationMinutes: 30,
          _previous: expect.objectContaining({
            scheduledAt: "2026-10-14T02:00:00.000Z",
            scheduledDurationMinutes: 15,
          }),
        }),
      }),
      expect.any(Array),
    );
    expect(mockPublishActivity).toHaveBeenCalledTimes(1);
  });

  it("does not publish and returns 500 when the activity write fails", async () => {
    const issueId = "22222222-2222-4222-8222-222222222222";
    mockSchedulingService.upsertIssueSchedulingWithPrevious.mockResolvedValue({
      scheduling: {
        issueId, companyId, scheduledAt: "2026-10-14T03:00:00.000Z", deferUntil: null,
        scheduledDurationMinutes: 30, createdAt: "2026-10-14T00:00:00.000Z", updatedAt: "2026-10-14T00:00:00.000Z",
      },
      previous: null,
    });
    mockLogActivity.mockRejectedValue(new Error("activity insert failed"));

    const res = await request(await createApp(editorActor()))
      .put(`/api/companies/${companyId}/issues/${issueId}/scheduling`)
      .send({ scheduledAt: "2026-10-14T03:00:00.000Z" });

    expect(res.status).toBe(500);
    expect(mockPublishActivity).not.toHaveBeenCalled();
  });
```

The second test checks that the error propagates out of the transaction callback, which is what makes the database roll back. The rollback itself is the database's behavior and is not simulated here.

- [ ] **Step 6: Run the route tests to verify they fail**

Run: `npx vitest run server/src/__tests__/scheduling-routes.test.ts`
Expected: FAIL. The new tests fail because the route still calls `upsertIssueScheduling` and passes no third argument.

- [ ] **Step 7: Implement the route changes**

In `server/src/routes/scheduling.ts`:

1. Change the import `import { accessService, logActivity, schedulingService } from "../services/index.js";` to:

```ts
import { accessService, logActivity, publishActivity, schedulingService } from "../services/index.js";
import type { ActivityPublication } from "../services/activity-log.js";
```

2. Replace the `PUT .../scheduling` handler body (after `await assertCanGenerate(req, companyId);`) with:

```ts
      const actor = getActorInfo(req);
      const publications: ActivityPublication[] = [];
      const scheduling = await db.transaction(async (tx) => {
        const txSvc = schedulingService(tx);
        const { scheduling: next, previous } = await txSvc.upsertIssueSchedulingWithPrevious(
          companyId,
          issueId,
          req.body,
        );
        await logActivity(
          tx,
          {
            companyId,
            actorType: actor.actorType,
            actorId: actor.actorId,
            agentId: actor.agentId,
            runId: actor.runId,
            agentApiKeyId: actor.agentApiKeyId,
            action: "issue.scheduling_updated",
            entityType: "issue",
            entityId: issueId,
            details: {
              scheduledAt: next.scheduledAt,
              deferUntil: next.deferUntil,
              scheduledDurationMinutes: next.scheduledDurationMinutes,
              _previous: previous
                ? {
                    scheduledAt: previous.scheduledAt,
                    deferUntil: previous.deferUntil,
                    scheduledDurationMinutes: previous.scheduledDurationMinutes,
                  }
                : null,
            },
          },
          publications,
        );
        return next;
      });
      for (const publication of publications) publishActivity(publication);
      res.json({ scheduling });
```

3. Replace the `DELETE .../scheduling` handler body (after `await assertCanGenerate(req, companyId);`) with:

```ts
    const actor = getActorInfo(req);
    const publications: ActivityPublication[] = [];
    const deleted = await db.transaction(async (tx) => {
      const removed = await schedulingService(tx).clearIssueScheduling(companyId, issueId);
      if (removed) {
        await logActivity(
          tx,
          {
            companyId,
            actorType: actor.actorType,
            actorId: actor.actorId,
            agentId: actor.agentId,
            runId: actor.runId,
            agentApiKeyId: actor.agentApiKeyId,
            action: "issue.scheduling_cleared",
            entityType: "issue",
            entityId: issueId,
          },
          publications,
        );
      }
      return removed;
    });
    for (const publication of publications) publishActivity(publication);
    res.json({ deleted });
```

If `tsc` reports that `tx` is not assignable to `Db`, check how `server/src/routes/issues.ts:8672` passes `tx` to `logActivity` and follow the same type, and do not add a cast.

- [ ] **Step 8: Run all scheduling tests, then typecheck**

Run: `npx vitest run server/src/__tests__/scheduling-routes.test.ts server/src/__tests__/scheduling-service.test.ts`
Expected: PASS.
Run: `pnpm --filter @paperclipai/server typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add server/src/services/scheduling.ts server/src/routes/scheduling.ts server/src/__tests__/scheduling-routes.test.ts server/src/__tests__/scheduling-service.test.ts
git commit -m "fix(scheduling): write schedule and activity atomically, log previous values"
```

---

### Task 2: Send the resize request once, when the mouse is released

**Why:** `handleResizeMove` calls `onResizeItem` on every `mousemove`. Each call becomes a `PUT` and an activity row. (Spec 7d finding 1.)

**Files:**
- Modify: `ui/src/components/ScheduleAgendaGrid.tsx:52`, `:88-125`, `:154-160`
- Test: `ui/src/components/ScheduleAgendaGrid.test.tsx` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `ScheduleAgendaGrid` keeps its props. `onResizeItem(issueId, minutes)` is now called at most once per drag, on release.

- [ ] **Step 1: Write the failing test**

Create `ui/src/components/ScheduleAgendaGrid.test.tsx`:

```tsx
// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScheduleAgendaGrid } from "./ScheduleAgendaGrid";

describe("ScheduleAgendaGrid resize", () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  afterEach(() => {
    flushSync(() => root?.unmount());
    container?.remove();
    container = null;
    root = null;
  });

  it("calls onResizeItem once, on mouse release, with the final duration", () => {
    const onResizeItem = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const date = new Date(2026, 9, 14);
    const scheduledAt = new Date(2026, 9, 14, 9, 0, 0).toISOString();

    flushSync(() => {
      root!.render(
        <ScheduleAgendaGrid
          date={date}
          startHour={7}
          endHour={20}
          pixelsPerHour={60}
          items={[
            { issueId: "issue-1", identifier: "T-1", title: "Write", status: "todo", scheduledAt, scheduledDurationMinutes: 30 },
          ]}
          onSelectItem={() => {}}
          onResizeItem={onResizeItem}
        />,
      );
    });

    const handle = container.querySelector('[aria-label="Resize duration"]') as HTMLElement;
    expect(handle).not.toBeNull();

    handle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientY: 100 }));
    window.dispatchEvent(new MouseEvent("mousemove", { clientY: 110 }));
    window.dispatchEvent(new MouseEvent("mousemove", { clientY: 120 }));
    window.dispatchEvent(new MouseEvent("mousemove", { clientY: 130 }));
    expect(onResizeItem).not.toHaveBeenCalled();

    window.dispatchEvent(new MouseEvent("mouseup", {}));
    expect(onResizeItem).toHaveBeenCalledTimes(1);
    expect(onResizeItem).toHaveBeenCalledWith("issue-1", 60);
  });

  it("does not call onResizeItem when the mouse is released without moving", () => {
    const onResizeItem = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const scheduledAt = new Date(2026, 9, 14, 9, 0, 0).toISOString();

    flushSync(() => {
      root!.render(
        <ScheduleAgendaGrid
          date={new Date(2026, 9, 14)}
          startHour={7}
          endHour={20}
          items={[
            { issueId: "issue-1", identifier: null, title: "Write", status: "todo", scheduledAt, scheduledDurationMinutes: 30 },
          ]}
          onSelectItem={() => {}}
          onResizeItem={onResizeItem}
        />,
      );
    });

    const handle = container.querySelector('[aria-label="Resize duration"]') as HTMLElement;
    handle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientY: 100 }));
    window.dispatchEvent(new MouseEvent("mouseup", {}));
    expect(onResizeItem).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run ui/src/components/ScheduleAgendaGrid.test.tsx`
Expected: FAIL. The first test fails at `expect(onResizeItem).not.toHaveBeenCalled()` after the moves, because the current code calls it on each move.

- [ ] **Step 3: Implement**

In `ui/src/components/ScheduleAgendaGrid.tsx`:

1. Add `useState` to the React import: `import { useCallback, useEffect, useRef, useState } from "react";`
2. Replace line 52 with:

```tsx
  const resizeState = useRef<{
    issueId: string;
    initialY: number;
    initialMinutes: number;
    latestMinutes: number;
  } | null>(null);
  const [liveResize, setLiveResize] = useState<{ issueId: string; minutes: number } | null>(null);
```

3. Replace `handleResizeMove` and `finishResize` (lines 88 to 107) with:

```tsx
  const handleResizeMove = useCallback(
    (e: MouseEvent | TouchEvent) => {
      const state = resizeState.current;
      if (!state) return;
      const clientY = "touches" in e ? e.touches[0]?.clientY ?? state.initialY : e.clientY;
      const deltaMinutes = ((clientY - state.initialY) / pixelsPerHour) * 60;
      let minutes = Math.round(state.initialMinutes + deltaMinutes);
      minutes = Math.max(15, Math.round(minutes / 15) * 15);
      state.latestMinutes = minutes;
      setLiveResize({ issueId: state.issueId, minutes });
    },
    [pixelsPerHour],
  );

  const finishResize = useCallback(() => {
    const state = resizeState.current;
    resizeState.current = null;
    window.removeEventListener("mousemove", handleResizeMove);
    window.removeEventListener("mouseup", finishResize);
    window.removeEventListener("touchmove", handleResizeMove);
    window.removeEventListener("touchend", finishResize);
    setLiveResize(null);
    if (state && state.latestMinutes !== state.initialMinutes) {
      onResizeItem?.(state.issueId, state.latestMinutes);
    }
  }, [handleResizeMove, onResizeItem]);
```

4. In `startResize`, change the `resizeState.current = {...}` assignment to include `latestMinutes`:

```tsx
    const initialMinutes = item.scheduledDurationMinutes ?? 30;
    resizeState.current = {
      issueId: item.issueId,
      initialY: clientY,
      initialMinutes,
      latestMinutes: initialMinutes,
    };
```

5. In the item render (line 158), replace `const duration = item.scheduledDurationMinutes ?? 30;` with:

```tsx
          const duration =
            liveResize?.issueId === item.issueId ? liveResize.minutes : item.scheduledDurationMinutes ?? 30;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run ui/src/components/ScheduleAgendaGrid.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the token gate and UI typecheck**

Run: `pnpm check:token-gates && pnpm --filter @paperclipai/ui typecheck`
Expected: both pass. No new colors or sizes were added.

- [ ] **Step 6: Commit**

```bash
git add ui/src/components/ScheduleAgendaGrid.tsx ui/src/components/ScheduleAgendaGrid.test.tsx
git commit -m "fix(ui): send the resize request once on release, not on every mouse move"
```

---

### Task 3: Create an issue with an estimate in one atomic request

**Why:** `Schedule.tsx` creates an issue, then schedules it, in two requests. A failure between them leaves a stray "New task". Quick add (Task 6) needs a single request that also protects against a double submit. (Spec 7d finding 2.)

**Files:**
- Modify: `packages/shared/src/validators/scheduling.ts` (add schema after line 63)
- Modify: `packages/shared/src/types/scheduling.ts` (add types)
- Modify: `packages/shared/src/index.ts:2484` (export the schema and type next to `upsertIssueSchedulingSchema`)
- Modify: `server/src/services/scheduling.ts` (add `createScheduledIssue`, add to returned object)
- Modify: `server/src/routes/scheduling.ts` (add `POST /companies/:companyId/scheduled-issues`)
- Test: `packages/shared/src/validators/scheduling.test.ts`
- Test: `server/src/__tests__/scheduling-service.test.ts`
- Test: `server/src/__tests__/scheduling-routes.test.ts`

**Interfaces:**
- Consumes: Task 1's `logActivity(tx, input, publications)` and `publishActivity` pattern. `issueService(tx).create(companyId, input)` with `idempotencyKey` and `onDeduplicated` (`server/src/services/issues.ts:7113`, verified to return the existing issue on a repeated key).
- Produces:
  - `createScheduledIssueSchema` and type `CreateScheduledIssue = { title: string; estimateMinutes?: number | null; scheduledAt?: Date | null; projectId?: string | null; clientRequestId?: string }`.
  - Type `CreateScheduledIssueResult = { issueId: string; identifier: string | null; title: string; scheduling: IssueScheduling }`.
  - `schedulingService(db).createScheduledIssue(companyId, input, actor, afterWrite?) : Promise<CreateScheduledIssueResult & { deduplicated: boolean }>`, where `actor = { agentId: string | null; userId: string | null }` and `afterWrite = (tx, result) => Promise<void>`.
  - HTTP `POST /api/companies/:companyId/scheduled-issues` returns 201 with `CreateScheduledIssueResult`, or 200 with the same body when the `clientRequestId` was already used.

- [ ] **Step 1: Write the failing validator test**

Add to `packages/shared/src/validators/scheduling.test.ts`, importing `createScheduledIssueSchema` alongside the existing imports:

```ts
describe("createScheduledIssueSchema", () => {
  it("accepts a title with an estimate and trims the title", () => {
    const parsed = createScheduledIssueSchema.parse({ title: "  Write report  ", estimateMinutes: 30 });
    expect(parsed.title).toBe("Write report");
    expect(parsed.estimateMinutes).toBe(30);
  });

  it("rejects an empty or whitespace-only title", () => {
    expect(createScheduledIssueSchema.safeParse({ title: "" }).success).toBe(false);
    expect(createScheduledIssueSchema.safeParse({ title: "   " }).success).toBe(false);
  });

  it("rejects an estimate outside 1 to 1440 minutes and a non-uuid clientRequestId", () => {
    expect(createScheduledIssueSchema.safeParse({ title: "x", estimateMinutes: 0 }).success).toBe(false);
    expect(createScheduledIssueSchema.safeParse({ title: "x", estimateMinutes: 1441 }).success).toBe(false);
    expect(createScheduledIssueSchema.safeParse({ title: "x", clientRequestId: "abc" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/shared/src/validators/scheduling.test.ts`
Expected: FAIL with `createScheduledIssueSchema is not defined` (or an import error).

- [ ] **Step 3: Add the schema, types and export**

In `packages/shared/src/validators/scheduling.ts`, after `upsertIssueSchedulingSchema` (line 63):

```ts
export const createScheduledIssueSchema = z.object({
  title: z.string().trim().min(1).max(200),
  estimateMinutes: z.number().int().min(1).max(24 * 60).nullable().optional(),
  scheduledAt: schedulingDateSchema.nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  clientRequestId: z.string().uuid().optional(),
});
```

and at the bottom with the other types:

```ts
export type CreateScheduledIssue = z.infer<typeof createScheduledIssueSchema>;
```

In `packages/shared/src/types/scheduling.ts`, append:

```ts
export interface CreateScheduledIssueRequest {
  title: string;
  estimateMinutes?: number | null;
  scheduledAt?: string | null;
  projectId?: string | null;
  clientRequestId?: string;
}

export interface CreateScheduledIssueResult {
  issueId: string;
  identifier: string | null;
  title: string;
  scheduling: IssueScheduling;
}
```

In `packages/shared/src/index.ts`, find the export list that contains `upsertIssueSchedulingSchema` (line 2484) and add `createScheduledIssueSchema,` next to it. In the same file, add `type CreateScheduledIssue,` to the type export list that contains `UpsertIssueScheduling`, and `type CreateScheduledIssueRequest, type CreateScheduledIssueResult,` to the list that contains `UpsertIssueSchedulingRequest`.

- [ ] **Step 4: Run the validator test**

Run: `npx vitest run packages/shared/src/validators/scheduling.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing service test**

Add to `server/src/__tests__/scheduling-service.test.ts`:

```ts
  it("creates an issue with an estimate and no time, atomically", async () => {
    const { companyId, svc } = await seedFixture();
    const result = await svc.createScheduledIssue(
      companyId,
      { title: "Quick task", estimateMinutes: 45 },
      { agentId: null, userId: "user-1" },
    );
    expect(result.deduplicated).toBe(false);
    expect(result.title).toBe("Quick task");
    expect(result.scheduling.scheduledAt).toBeNull();
    expect(result.scheduling.scheduledDurationMinutes).toBe(45);
    const rows = await db.select().from(issueScheduling).where(eq(issueScheduling.issueId, result.issueId));
    expect(rows).toHaveLength(1);
  });

  it("returns the same issue for a repeated clientRequestId", async () => {
    const { companyId, svc } = await seedFixture();
    const clientRequestId = randomUUID();
    const first = await svc.createScheduledIssue(
      companyId,
      { title: "Once", estimateMinutes: 30, clientRequestId },
      { agentId: null, userId: "user-1" },
    );
    const second = await svc.createScheduledIssue(
      companyId,
      { title: "Once", estimateMinutes: 30, clientRequestId },
      { agentId: null, userId: "user-1" },
    );
    expect(second.issueId).toBe(first.issueId);
    expect(second.deduplicated).toBe(true);
    const rows = await db.select().from(issueScheduling).where(eq(issueScheduling.companyId, companyId));
    expect(rows).toHaveLength(1);
  });

  it("rolls back the issue when the after-write hook fails", async () => {
    const { companyId, svc } = await seedFixture();
    await expect(
      svc.createScheduledIssue(
        companyId,
        { title: "Rolled back", estimateMinutes: 30 },
        { agentId: null, userId: "user-1" },
        async () => {
          throw new Error("activity failed");
        },
      ),
    ).rejects.toThrow("activity failed");
    const rows = await db.select().from(issues).where(eq(issues.companyId, companyId));
    expect(rows).toHaveLength(0);
  });
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run server/src/__tests__/scheduling-service.test.ts -t "estimate and no time|repeated clientRequestId|after-write hook"`
Expected: FAIL with `svc.createScheduledIssue is not a function`.

- [ ] **Step 7: Implement the service method**

In `server/src/services/scheduling.ts`, add `CreateScheduledIssue` and `CreateScheduledIssueResult` to the existing `@paperclipai/shared` type imports. Then add this function inside `schedulingService`, before the returned object:

```ts
  async function createScheduledIssue(
    companyId: string,
    input: CreateScheduledIssue,
    actor: { agentId: string | null; userId: string | null },
    afterWrite?: (
      tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
      result: CreateScheduledIssueResult & { deduplicated: boolean },
    ) => Promise<void>,
  ): Promise<CreateScheduledIssueResult & { deduplicated: boolean }> {
    return db.transaction(async (tx) => {
      let deduplicated = false;
      const issue = await issueService(tx).create(companyId, {
        title: input.title,
        status: "todo",
        projectId: input.projectId ?? null,
        createdByAgentId: actor.agentId,
        createdByUserId: actor.userId,
        idempotencyKey: input.clientRequestId ?? null,
        onDeduplicated: () => {
          deduplicated = true;
        },
      });
      const [inserted] = await tx
        .insert(issueScheduling)
        .values({
          issueId: issue.id,
          companyId,
          scheduledAt: input.scheduledAt ?? null,
          scheduledDurationMinutes: input.estimateMinutes ?? null,
        })
        .onConflictDoNothing()
        .returning();
      const row =
        inserted ??
        (await tx
          .select()
          .from(issueScheduling)
          .where(eq(issueScheduling.issueId, issue.id))
          .then((rows) => rows[0]!));
      const result = {
        issueId: issue.id,
        identifier: issue.identifier ?? null,
        title: issue.title,
        scheduling: toIssueScheduling(row),
        deduplicated,
      };
      if (afterWrite) await afterWrite(tx, result);
      return result;
    });
  }
```

Add `createScheduledIssue,` to the returned object.

- [ ] **Step 8: Run the service tests**

Run: `npx vitest run server/src/__tests__/scheduling-service.test.ts`
Expected: PASS. If `issueService(tx)` fails typechecking, follow the same typing that `server/src/routes/issues.ts` uses when it passes `tx` to services, and do not cast.

- [ ] **Step 9: Write the failing route tests**

In `server/src/__tests__/scheduling-routes.test.ts`, add `createScheduledIssue: vi.fn(),` to `mockSchedulingService`, then add:

```ts
  it("creates a scheduled issue and logs issue.created and issue.scheduling_updated", async () => {
    const created = {
      issueId: "33333333-3333-4333-8333-333333333333",
      identifier: "T-9",
      title: "Quick task",
      deduplicated: false,
      scheduling: {
        issueId: "33333333-3333-4333-8333-333333333333", companyId, scheduledAt: null, deferUntil: null,
        scheduledDurationMinutes: 45, createdAt: "2026-10-14T00:00:00.000Z", updatedAt: "2026-10-14T00:00:00.000Z",
      },
    };
    mockSchedulingService.createScheduledIssue.mockImplementation(
      async (_c: string, _i: unknown, _a: unknown, afterWrite?: (tx: unknown, r: unknown) => Promise<void>) => {
        await afterWrite?.({}, created);
        return created;
      },
    );
    mockLogActivity.mockImplementation(async (_db: unknown, _input: unknown, pubs?: unknown[]) => {
      pubs?.push({ companyId, payload: {}, pluginEvent: null });
      return { id: "activity-1" };
    });

    const res = await request(await createApp(editorActor()))
      .post(`/api/companies/${companyId}/scheduled-issues`)
      .send({ title: "Quick task", estimateMinutes: 45 });

    expect(res.status).toBe(201);
    expect(res.body.issueId).toBe(created.issueId);
    const actions = mockLogActivity.mock.calls.map((call) => (call[1] as { action: string }).action);
    expect(actions).toEqual(["issue.created", "issue.scheduling_updated"]);
    expect(mockPublishActivity).toHaveBeenCalledTimes(2);
  });

  it("returns 200 and logs nothing when the request was already handled", async () => {
    const created = {
      issueId: "33333333-3333-4333-8333-333333333333", identifier: "T-9", title: "Quick task", deduplicated: true,
      scheduling: {
        issueId: "33333333-3333-4333-8333-333333333333", companyId, scheduledAt: null, deferUntil: null,
        scheduledDurationMinutes: 45, createdAt: "2026-10-14T00:00:00.000Z", updatedAt: "2026-10-14T00:00:00.000Z",
      },
    };
    mockSchedulingService.createScheduledIssue.mockImplementation(
      async (_c: string, _i: unknown, _a: unknown, afterWrite?: (tx: unknown, r: unknown) => Promise<void>) => {
        await afterWrite?.({}, created);
        return created;
      },
    );

    const res = await request(await createApp(editorActor()))
      .post(`/api/companies/${companyId}/scheduled-issues`)
      .send({ title: "Quick task", estimateMinutes: 45, clientRequestId: "44444444-4444-4444-8444-444444444444" });

    expect(res.status).toBe(200);
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("rejects an empty title with 400 before calling the service", async () => {
    const res = await request(await createApp(editorActor()))
      .post(`/api/companies/${companyId}/scheduled-issues`)
      .send({ title: "   " });
    expect(res.status).toBe(400);
    expect(mockSchedulingService.createScheduledIssue).not.toHaveBeenCalled();
  });
```

- [ ] **Step 10: Run them to verify they fail**

Run: `npx vitest run server/src/__tests__/scheduling-routes.test.ts -t "scheduled issue|already handled|empty title"`
Expected: FAIL. The POST route does not exist, so the first two get 404.

- [ ] **Step 11: Implement the route**

In `server/src/routes/scheduling.ts`, add `createScheduledIssueSchema` to the `@paperclipai/shared` import list, and add this route right after the `GET .../scheduled-issues` handler:

```ts
  router.post(
    "/companies/:companyId/scheduled-issues",
    validate(createScheduledIssueSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      await assertCanGenerate(req, companyId);
      const actor = getActorInfo(req);
      const publications: ActivityPublication[] = [];
      const result = await svc.createScheduledIssue(companyId, req.body, actorIds(req), async (tx, created) => {
        if (created.deduplicated) return;
        const base = {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          agentApiKeyId: actor.agentApiKeyId,
          entityType: "issue",
          entityId: created.issueId,
        };
        await logActivity(
          tx,
          { ...base, action: "issue.created", details: { title: created.title, identifier: created.identifier } },
          publications,
        );
        await logActivity(
          tx,
          {
            ...base,
            action: "issue.scheduling_updated",
            details: {
              scheduledAt: created.scheduling.scheduledAt,
              deferUntil: created.scheduling.deferUntil,
              scheduledDurationMinutes: created.scheduling.scheduledDurationMinutes,
              _previous: null,
            },
          },
          publications,
        );
      });
      for (const publication of publications) publishActivity(publication);
      res.status(result.deduplicated ? 200 : 201).json({
        issueId: result.issueId,
        identifier: result.identifier,
        title: result.title,
        scheduling: result.scheduling,
      });
    },
  );
```

This route logs a smaller `issue.created` entry than the main issue-create route in `server/src/routes/issues.ts`. That is intentional for this plan. If the owner wants parity, compare the two and extend the details.

- [ ] **Step 12: Run all affected tests and typecheck**

Run: `npx vitest run server/src/__tests__/scheduling-routes.test.ts server/src/__tests__/scheduling-service.test.ts packages/shared/src/validators/scheduling.test.ts`
Expected: PASS.
Run: `pnpm -r typecheck`
Expected: no errors.

- [ ] **Step 13: Commit**

```bash
git add packages/shared server/src
git commit -m "feat(scheduling): create an issue with an estimate in one atomic, idempotent request"
```

---

## Phase B: Calendar event entity

### Task 4: Add the `calendar_events` table, with a backfill

**Why:** The owner decided a pinned block is its own entity. This task adds the table and copies existing scheduled issues into it. Nothing reads the table yet, so the previous release keeps working.

**Files:**
- Create: `packages/db/src/schema/calendar_events.ts`
- Modify: `packages/db/src/schema/index.ts:52` (export)
- Create (generated): `packages/db/src/migrations/0235_<generated-name>.sql` and its journal entry
- Test: `server/src/__tests__/calendar-events-schema.test.ts` (create)

**Interfaces:**
- Consumes: the `issues`, `companies` and `agents` tables.
- Produces: `calendarEvents` table export from `@paperclipai/db` with columns `id`, `companyId`, `issueId` (nullable), `title`, `startsAt`, `endsAt`, `createdByUserId`, `createdByAgentId`, `createdAt`, `updatedAt`. One event per issue (partial unique index). `ends_at > starts_at` is enforced.

- [ ] **Step 1: Write the schema file**

Create `packages/db/src/schema/calendar_events.ts`:

```ts
import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";
import { issues } from "./issues.js";

export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id"),
    title: text("title").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    createdByUserId: text("created_by_user_id"),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStartsAtIdx: index("calendar_events_company_starts_at_idx").on(table.companyId, table.startsAt),
    issueUniqueIdx: uniqueIndex("calendar_events_issue_unique_idx")
      .on(table.issueId)
      .where(sql`${table.issueId} is not null`),
    issueCompanyFk: foreignKey({
      name: "calendar_events_company_issue_fk",
      columns: [table.companyId, table.issueId],
      foreignColumns: [issues.companyId, issues.id],
    }).onDelete("cascade"),
    validRange: check("calendar_events_valid_range_check", sql`${table.endsAt} > ${table.startsAt}`),
  }),
);
```

In `packages/db/src/schema/index.ts`, after line 52 (`export { issueScheduling } ...`) add:

```ts
export { calendarEvents } from "./calendar_events.js";
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm db:generate`
Expected: a new file `packages/db/src/migrations/0235_*.sql` that creates `calendar_events`, its indexes, the foreign keys and the check, and a new entry in `packages/db/src/migrations/meta/_journal.json`.

Open the generated file and confirm it contains `CREATE TABLE "calendar_events"`, `CREATE UNIQUE INDEX "calendar_events_issue_unique_idx"` with a `WHERE "issue_id" is not null` clause, and the check constraint. If the partial `WHERE` is missing, stop and fix the schema before continuing.

- [ ] **Step 3: Append the backfill to the generated migration**

At the end of the generated `0235_*.sql` file add, on new lines:

```sql
--> statement-breakpoint
-- backfill: one pinned event per already-scheduled issue (30 minutes when no duration was set)
INSERT INTO "calendar_events" ("company_id", "issue_id", "title", "starts_at", "ends_at")
SELECT s."company_id", s."issue_id", i."title", s."scheduled_at",
       s."scheduled_at" + (COALESCE(s."scheduled_duration_minutes", 30) * interval '1 minute')
FROM "issue_scheduling" s
JOIN "issues" i ON i."id" = s."issue_id" AND i."company_id" = s."company_id"
WHERE s."scheduled_at" IS NOT NULL
ON CONFLICT DO NOTHING;
```

The change is additive. No existing table or column is altered, so the previous release keeps working.

- [ ] **Step 4: Write the failing test**

Create `server/src/__tests__/calendar-events-schema.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { calendarEvents, companies, createDb, issueScheduling, issues } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("calendar_events schema", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-calendar-events-schema-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedIssue() {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Events Co",
      issuePrefix: `E${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    const [issue] = await db
      .insert(issues)
      .values({ companyId, title: "Pinned issue", status: "todo", priority: "medium" })
      .returning();
    return { companyId, issueId: issue!.id };
  }

  it("rejects a second event for the same issue", async () => {
    const { companyId, issueId } = await seedIssue();
    const startsAt = new Date("2026-10-14T03:00:00.000Z");
    const endsAt = new Date("2026-10-14T03:30:00.000Z");
    await db.insert(calendarEvents).values({ companyId, issueId, title: "A", startsAt, endsAt });
    await expect(
      db.insert(calendarEvents).values({ companyId, issueId, title: "B", startsAt, endsAt }),
    ).rejects.toThrow();
  });

  it("rejects an event whose end is not after its start", async () => {
    const { companyId, issueId } = await seedIssue();
    const at = new Date("2026-10-14T03:00:00.000Z");
    await expect(
      db.insert(calendarEvents).values({ companyId, issueId, title: "Zero", startsAt: at, endsAt: at }),
    ).rejects.toThrow();
  });

  it("removes the event when its issue is deleted", async () => {
    const { companyId, issueId } = await seedIssue();
    await db.insert(calendarEvents).values({
      companyId, issueId, title: "Gone",
      startsAt: new Date("2026-10-14T03:00:00.000Z"), endsAt: new Date("2026-10-14T03:30:00.000Z"),
    });
    await db.delete(issues).where(eq(issues.id, issueId));
    const rows = await db.select().from(calendarEvents).where(eq(calendarEvents.issueId, issueId));
    expect(rows).toHaveLength(0);
  });

  it("backfills scheduled issues with the migration's own SQL", async () => {
    const { companyId, issueId } = await seedIssue();
    await db.insert(issueScheduling).values({
      issueId, companyId, scheduledAt: new Date("2026-10-14T05:00:00.000Z"), scheduledDurationMinutes: 45,
    });
    const { companyId: otherCompany, issueId: noDurationIssue } = await seedIssue();
    await db.insert(issueScheduling).values({
      issueId: noDurationIssue, companyId: otherCompany, scheduledAt: new Date("2026-10-14T06:00:00.000Z"),
    });
    const { companyId: unscheduledCompany, issueId: unscheduledIssue } = await seedIssue();
    await db.insert(issueScheduling).values({
      issueId: unscheduledIssue, companyId: unscheduledCompany, scheduledDurationMinutes: 20,
    });

    const migrationsDir = path.resolve(__dirname, "../../../packages/db/src/migrations");
    const file = readdirSync(migrationsDir).find((name) => /^0235_.*\.sql$/.test(name));
    expect(file).toBeDefined();
    const statements = readFileSync(path.join(migrationsDir, file!), "utf8").split("--> statement-breakpoint");
    const backfill = statements.find((statement) => statement.includes("-- backfill"));
    expect(backfill).toBeDefined();
    await db.execute(sql.raw(backfill!));

    const [pinned] = await db.select().from(calendarEvents).where(eq(calendarEvents.issueId, issueId));
    expect(pinned?.title).toBe("Pinned issue");
    expect(pinned?.endsAt.toISOString()).toBe("2026-10-14T05:45:00.000Z");
    const [defaulted] = await db.select().from(calendarEvents).where(eq(calendarEvents.issueId, noDurationIssue));
    expect(defaulted?.endsAt.toISOString()).toBe("2026-10-14T06:30:00.000Z");
    const none = await db.select().from(calendarEvents).where(eq(calendarEvents.issueId, unscheduledIssue));
    expect(none).toHaveLength(0);

    await db.execute(sql.raw(backfill!));
    const again = await db.select().from(calendarEvents).where(eq(calendarEvents.issueId, issueId));
    expect(again).toHaveLength(1);
  });
});
```

If the numeric prefix is not `0235` after generation, change the regex to the actual generated number.

- [ ] **Step 5: Run it**

Run: `pnpm --filter @paperclipai/plugin-sdk ensure-build-deps && npx vitest run server/src/__tests__/calendar-events-schema.test.ts`
Expected: PASS (4 tests). They fail before Steps 1 to 3 because `calendarEvents` does not exist. If the delete test fails, check the `onDelete("cascade")` on the composite foreign key. The existing `issue_scheduling` table uses the same pattern.

- [ ] **Step 6: Typecheck**

Run: `pnpm -r typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/db server/src/__tests__/calendar-events-schema.test.ts
git commit -m "feat(db): add calendar_events table with backfill from issue_scheduling"
```

---

### Task 5: Pin, move and unpin an issue as an event, with a list endpoint

**Why:** This is the pin behavior from the spec (section 5): pinning creates one event, moving changes only the times, unpinning removes it. It dual-writes `issue_scheduling` so the existing UI keeps working.

**Files:**
- Modify: `packages/shared/src/validators/scheduling.ts` (add `pinIssueEventSchema`)
- Modify: `packages/shared/src/types/scheduling.ts` (add `CalendarEvent`, `PinIssueEventRequest`)
- Modify: `packages/shared/src/index.ts` (exports)
- Create: `server/src/services/calendar-events.ts`
- Modify: `server/src/services/index.ts` (export `calendarEventsService`)
- Create: `server/src/routes/calendar-events.ts`
- Modify: `server/src/app.ts:595` (mount next to `schedulingRoutes`)
- Test: `server/src/__tests__/calendar-events-service.test.ts` (create)
- Test: `server/src/__tests__/calendar-events-routes.test.ts` (create)

**Interfaces:**
- Consumes: `calendarEvents` and `issueScheduling` tables; the Task 1 pattern (`db.transaction`, `logActivity(tx, input, publications)`, `publishActivity`).
- Produces:
  - `pinIssueEventSchema = { startsAt: Date; endsAt?: Date; durationMinutes?: number }` (not both `endsAt` and `durationMinutes`).
  - Type `CalendarEvent = { id; companyId; issueId: string | null; title; startsAt: string; endsAt: string; createdAt: string; updatedAt: string }`.
  - `calendarEventsService(db)`:
    - `pinIssue(companyId, issueId, input, actor): Promise<{ event: CalendarEvent; previous: CalendarEvent | null }>`
    - `unpinIssue(companyId, issueId): Promise<{ deleted: boolean; previous: CalendarEvent | null }>`
    - `listEvents(companyId, { from?, to?, limit?, cursor? }): Promise<{ items: CalendarEvent[]; nextCursor: string | null }>`
  - HTTP: `PUT /api/companies/:companyId/issues/:issueId/event`, `DELETE` the same path, `GET /api/companies/:companyId/calendar-events?from&to&limit&cursor`.
  - Activity actions on `entityType: "issue"`: `issue.event_pinned`, `issue.event_moved`, `issue.event_unpinned`.

- [ ] **Step 1: Add the schema, types and exports**

In `packages/shared/src/validators/scheduling.ts`, after `createScheduledIssueSchema`:

```ts
export const pinIssueEventSchema = z
  .object({
    startsAt: schedulingDateSchema,
    endsAt: schedulingDateSchema.optional(),
    durationMinutes: z.number().int().min(1).max(24 * 60).optional(),
  })
  .refine((value) => !(value.endsAt && value.durationMinutes), {
    message: "Provide endsAt or durationMinutes, not both",
  })
  .refine((value) => !value.endsAt || value.endsAt.getTime() > value.startsAt.getTime(), {
    message: "endsAt must be after startsAt",
  });

export type PinIssueEvent = z.infer<typeof pinIssueEventSchema>;
```

In `packages/shared/src/types/scheduling.ts`:

```ts
export interface CalendarEvent {
  id: string;
  companyId: string;
  issueId: string | null;
  title: string;
  startsAt: string;
  endsAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface PinIssueEventRequest {
  startsAt: string;
  endsAt?: string;
  durationMinutes?: number;
}
```

Export `pinIssueEventSchema`, `type PinIssueEvent`, `type CalendarEvent` and `type PinIssueEventRequest` from `packages/shared/src/index.ts` next to the Task 3 exports.

- [ ] **Step 2: Write the failing service tests**

Create `server/src/__tests__/calendar-events-service.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { activityLog, calendarEvents, companies, createDb, issueScheduling, issues } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { calendarEventsService } from "../services/calendar-events.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("calendar events service", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const actor = { agentId: null, userId: "user-1" };

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-calendar-events-service-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(calendarEvents);
    await db.delete(issueScheduling);
    await db.delete(issues);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedIssue(title = "Task") {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Events Co",
      issuePrefix: `E${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    const [issue] = await db.insert(issues).values({ companyId, title, status: "todo", priority: "medium" }).returning();
    return { companyId, issueId: issue!.id, svc: calendarEventsService(db) };
  }

  it("pins an issue: one event, and issue_scheduling is dual-written", async () => {
    const { companyId, issueId, svc } = await seedIssue("Write");
    const { event, previous } = await svc.pinIssue(
      companyId, issueId, { startsAt: new Date("2026-10-14T03:00:00.000Z"), durationMinutes: 30 }, actor,
    );
    expect(previous).toBeNull();
    expect(event.title).toBe("Write");
    expect(event.endsAt).toBe("2026-10-14T03:30:00.000Z");
    const [sched] = await db.select().from(issueScheduling).where(eq(issueScheduling.issueId, issueId));
    expect(sched?.scheduledAt?.toISOString()).toBe("2026-10-14T03:00:00.000Z");
    expect(sched?.scheduledDurationMinutes).toBe(30);
  });

  it("moves instead of duplicating when pinned again, and keeps the duration", async () => {
    const { companyId, issueId, svc } = await seedIssue();
    await svc.pinIssue(companyId, issueId, { startsAt: new Date("2026-10-14T03:00:00.000Z"), durationMinutes: 30 }, actor);
    const moved = await svc.pinIssue(companyId, issueId, { startsAt: new Date("2026-10-14T09:50:00.000Z") }, actor);
    expect(moved.previous?.startsAt).toBe("2026-10-14T03:00:00.000Z");
    expect(moved.event.startsAt).toBe("2026-10-14T09:50:00.000Z");
    expect(moved.event.endsAt).toBe("2026-10-14T10:20:00.000Z");
    const rows = await db.select().from(calendarEvents).where(eq(calendarEvents.issueId, issueId));
    expect(rows).toHaveLength(1);
  });

  it("uses 30 minutes when no duration is known", async () => {
    const { companyId, issueId, svc } = await seedIssue();
    const { event } = await svc.pinIssue(companyId, issueId, { startsAt: new Date("2026-10-14T03:00:00.000Z") }, actor);
    expect(event.endsAt).toBe("2026-10-14T03:30:00.000Z");
  });

  it("uses the issue estimate when pinning without a duration", async () => {
    const { companyId, issueId, svc } = await seedIssue();
    await db.insert(issueScheduling).values({ issueId, companyId, scheduledDurationMinutes: 50 });
    const { event } = await svc.pinIssue(companyId, issueId, { startsAt: new Date("2026-10-14T03:00:00.000Z") }, actor);
    expect(event.endsAt).toBe("2026-10-14T03:50:00.000Z");
  });

  it("allows overlapping events", async () => {
    const first = await seedIssue("One");
    const [second] = await db
      .insert(issues)
      .values({ companyId: first.companyId, title: "Two", status: "todo", priority: "medium" })
      .returning();
    await first.svc.pinIssue(first.companyId, first.issueId, { startsAt: new Date("2026-10-14T03:00:00.000Z"), durationMinutes: 60 }, actor);
    await first.svc.pinIssue(first.companyId, second!.id, { startsAt: new Date("2026-10-14T03:15:00.000Z"), durationMinutes: 30 }, actor);
    const rows = await db.select().from(calendarEvents).where(eq(calendarEvents.companyId, first.companyId));
    expect(rows).toHaveLength(2);
  });

  it("unpins: removes the event, clears the time, keeps the estimate", async () => {
    const { companyId, issueId, svc } = await seedIssue();
    await svc.pinIssue(companyId, issueId, { startsAt: new Date("2026-10-14T03:00:00.000Z"), durationMinutes: 45 }, actor);
    const result = await svc.unpinIssue(companyId, issueId);
    expect(result.deleted).toBe(true);
    expect(result.previous?.endsAt).toBe("2026-10-14T03:45:00.000Z");
    const [sched] = await db.select().from(issueScheduling).where(eq(issueScheduling.issueId, issueId));
    expect(sched?.scheduledAt).toBeNull();
    expect(sched?.scheduledDurationMinutes).toBe(45);
    expect((await svc.unpinIssue(companyId, issueId)).deleted).toBe(false);
  });

  it("does not pin an issue from another company", async () => {
    const a = await seedIssue();
    const b = await seedIssue();
    await expect(
      a.svc.pinIssue(a.companyId, b.issueId, { startsAt: new Date("2026-10-14T03:00:00.000Z") }, actor),
    ).rejects.toThrow(/not found/i);
  });

  it("lists events on the exact range boundaries", async () => {
    const { companyId, issueId, svc } = await seedIssue();
    // 00:30 on 2026-10-14 in UTC+7 is 17:30 on 2026-10-13 UTC.
    await svc.pinIssue(companyId, issueId, { startsAt: new Date("2026-10-13T17:30:00.000Z"), durationMinutes: 30 }, actor);
    const localDay = {
      from: new Date("2026-10-13T17:00:00.000Z"),
      to: new Date("2026-10-14T16:59:59.999Z"),
    };
    expect((await svc.listEvents(companyId, localDay)).items).toHaveLength(1);
    const exactStart = await svc.listEvents(companyId, {
      from: new Date("2026-10-13T17:30:00.000Z"), to: new Date("2026-10-13T17:30:00.000Z"),
    });
    expect(exactStart.items).toHaveLength(1);
    const utcDay = await svc.listEvents(companyId, {
      from: new Date("2026-10-14T00:00:00.000Z"), to: new Date("2026-10-14T23:59:59.999Z"),
    });
    expect(utcDay.items).toHaveLength(0);
  });

  it("pages with a cursor", async () => {
    const { companyId, issueId, svc } = await seedIssue("A");
    const rows = await db.insert(issues).values([
      { companyId, title: "B", status: "todo", priority: "medium" },
      { companyId, title: "C", status: "todo", priority: "medium" },
    ]).returning();
    await svc.pinIssue(companyId, issueId, { startsAt: new Date("2026-10-14T03:00:00.000Z"), durationMinutes: 15 }, actor);
    await svc.pinIssue(companyId, rows[0]!.id, { startsAt: new Date("2026-10-14T04:00:00.000Z"), durationMinutes: 15 }, actor);
    await svc.pinIssue(companyId, rows[1]!.id, { startsAt: new Date("2026-10-14T05:00:00.000Z"), durationMinutes: 15 }, actor);
    const page1 = await svc.listEvents(companyId, { limit: 2 });
    expect(page1.items.map((item) => item.title)).toEqual(["A", "B"]);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await svc.listEvents(companyId, { limit: 2, cursor: page1.nextCursor! });
    expect(page2.items.map((item) => item.title)).toEqual(["C"]);
    expect(page2.nextCursor).toBeNull();
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run server/src/__tests__/calendar-events-service.test.ts`
Expected: FAIL with `Cannot find module '../services/calendar-events.js'`.

- [ ] **Step 4: Implement the service**

Create `server/src/services/calendar-events.ts`:

```ts
import { and, asc, eq, gt, gte, lte, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { calendarEvents, issueScheduling, issues } from "@paperclipai/db";
import type { CalendarEvent, PinIssueEvent } from "@paperclipai/shared";
import { badRequest, notFound } from "../errors.js";

const DEFAULT_EVENT_MINUTES = 30;
const DEFAULT_LIMIT = 50;

type CalendarEventRow = typeof calendarEvents.$inferSelect;
type EventsCursor = { startsAt: string; id: string };

function toCalendarEvent(row: CalendarEventRow): CalendarEvent {
  return {
    id: row.id,
    companyId: row.companyId,
    issueId: row.issueId ?? null,
    title: row.title,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function decodeCursor(cursor: string | undefined): EventsCursor | null {
  if (!cursor) return null;
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<EventsCursor>;
    if (typeof decoded.id !== "string" || typeof decoded.startsAt !== "string") throw new Error("shape");
    if (Number.isNaN(new Date(decoded.startsAt).getTime())) throw new Error("date");
    return { startsAt: decoded.startsAt, id: decoded.id };
  } catch {
    throw badRequest("cursor is invalid");
  }
}

function encodeCursor(cursor: EventsCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function calendarEventsService(db: Db) {
  async function pinIssue(
    companyId: string,
    issueId: string,
    input: PinIssueEvent,
    actor: { agentId: string | null; userId: string | null },
  ): Promise<{ event: CalendarEvent; previous: CalendarEvent | null }> {
    const issue = await db
      .select({ id: issues.id, title: issues.title })
      .from(issues)
      .where(and(eq(issues.companyId, companyId), eq(issues.id, issueId)))
      .then((rows) => rows[0] ?? null);
    if (!issue) throw notFound("Issue not found");

    const existingEvent = await db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.issueId, issueId))
      .then((rows) => rows[0] ?? null);
    const existingScheduling = await db
      .select()
      .from(issueScheduling)
      .where(eq(issueScheduling.issueId, issueId))
      .then((rows) => rows[0] ?? null);

    let durationMinutes: number;
    if (input.endsAt) {
      durationMinutes = Math.round((input.endsAt.getTime() - input.startsAt.getTime()) / 60_000);
    } else if (input.durationMinutes) {
      durationMinutes = input.durationMinutes;
    } else if (existingEvent) {
      durationMinutes = Math.round((existingEvent.endsAt.getTime() - existingEvent.startsAt.getTime()) / 60_000);
    } else {
      durationMinutes = existingScheduling?.scheduledDurationMinutes ?? DEFAULT_EVENT_MINUTES;
    }
    if (durationMinutes < 1) throw badRequest("endsAt must be after startsAt");
    const endsAt = new Date(input.startsAt.getTime() + durationMinutes * 60_000);
    const now = new Date();

    const [row] = await db
      .insert(calendarEvents)
      .values({
        companyId,
        issueId,
        title: issue.title,
        startsAt: input.startsAt,
        endsAt,
        createdByAgentId: actor.agentId,
        createdByUserId: actor.userId,
      })
      .onConflictDoUpdate({
        target: calendarEvents.issueId,
        targetWhere: sql`${calendarEvents.issueId} is not null`,
        set: { startsAt: input.startsAt, endsAt, title: issue.title, updatedAt: now },
      })
      .returning();

    const schedulingValues = {
      scheduledAt: input.startsAt,
      scheduledDurationMinutes: durationMinutes,
      updatedAt: now,
    };
    await db
      .insert(issueScheduling)
      .values({ issueId, companyId, ...schedulingValues })
      .onConflictDoUpdate({ target: issueScheduling.issueId, set: schedulingValues });

    return { event: toCalendarEvent(row!), previous: existingEvent ? toCalendarEvent(existingEvent) : null };
  }

  async function unpinIssue(
    companyId: string,
    issueId: string,
  ): Promise<{ deleted: boolean; previous: CalendarEvent | null }> {
    const [removed] = await db
      .delete(calendarEvents)
      .where(and(eq(calendarEvents.companyId, companyId), eq(calendarEvents.issueId, issueId)))
      .returning();
    if (!removed) return { deleted: false, previous: null };
    await db
      .update(issueScheduling)
      .set({ scheduledAt: null, updatedAt: new Date() })
      .where(and(eq(issueScheduling.companyId, companyId), eq(issueScheduling.issueId, issueId)));
    return { deleted: true, previous: toCalendarEvent(removed) };
  }

  async function listEvents(
    companyId: string,
    filters: { from?: Date; to?: Date; limit?: number; cursor?: string } = {},
  ): Promise<{ items: CalendarEvent[]; nextCursor: string | null }> {
    const limit = filters.limit ?? DEFAULT_LIMIT;
    const cursor = decodeCursor(filters.cursor);
    const conditions = [eq(calendarEvents.companyId, companyId)];
    if (filters.from) conditions.push(gte(calendarEvents.startsAt, filters.from));
    if (filters.to) conditions.push(lte(calendarEvents.startsAt, filters.to));
    if (cursor) {
      conditions.push(
        or(
          gt(calendarEvents.startsAt, new Date(cursor.startsAt)),
          and(eq(calendarEvents.startsAt, new Date(cursor.startsAt)), gt(calendarEvents.id, cursor.id)),
        )!,
      );
    }
    const rows = await db
      .select()
      .from(calendarEvents)
      .where(and(...conditions))
      .orderBy(asc(calendarEvents.startsAt), asc(calendarEvents.id))
      .limit(limit + 1);
    const items = rows.slice(0, limit).map(toCalendarEvent);
    return {
      items,
      nextCursor:
        rows.length > limit && items.length > 0
          ? encodeCursor({ startsAt: items.at(-1)!.startsAt, id: items.at(-1)!.id })
          : null,
    };
  }

  return { pinIssue, unpinIssue, listEvents };
}
```

The `targetWhere` predicate must match the partial unique index's `WHERE` clause. Postgres needs it in the conflict target to infer a partial unique index.

In `server/src/services/index.ts`, add `export { calendarEventsService } from "./calendar-events.js";` next to the other service exports.

- [ ] **Step 5: Run the service tests**

Run: `npx vitest run server/src/__tests__/calendar-events-service.test.ts`
Expected: PASS (9 tests). If the `onConflictDoUpdate` tests fail with "there is no unique or exclusion constraint matching the ON CONFLICT specification", the `targetWhere` predicate does not match the index. Make it identical to the index's `WHERE` clause.

The pin runs several statements without a transaction here. Wrap it with the route (next steps), which opens the transaction and passes `tx` into `calendarEventsService(tx)`.

- [ ] **Step 6: Write the failing route tests**

Create `server/src/__tests__/calendar-events-routes.test.ts`:

```ts
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const companyId = "11111111-1111-4111-8111-111111111111";
const issueId = "22222222-2222-4222-8222-222222222222";

const mockCalendarEventsService = vi.hoisted(() => ({
  pinIssue: vi.fn(),
  unpinIssue: vi.fn(),
  listEvents: vi.fn(),
}));
const mockAccessService = vi.hoisted(() => ({ decide: vi.fn() }));
const mockLogActivity = vi.hoisted(() => vi.fn());
const mockPublishActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  accessService: () => mockAccessService,
  calendarEventsService: () => mockCalendarEventsService,
  logActivity: mockLogActivity,
  publishActivity: mockPublishActivity,
}));

async function createApp(actor: Record<string, unknown>) {
  const [{ errorHandler }, { calendarEventsRoutes }] = await Promise.all([
    import("../middleware/index.js"),
    import("../routes/calendar-events.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  const fakeDb = { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}) };
  app.use("/api", calendarEventsRoutes(fakeDb as any));
  app.use(errorHandler);
  return app;
}

function editorActor() {
  return {
    type: "board" as const,
    userId: "editor-user",
    source: "session" as const,
    isInstanceAdmin: false,
    companyIds: [companyId],
    memberships: [{ companyId, status: "active", membershipRole: "editor" }],
  };
}

const event = (startsAt: string, endsAt: string) => ({
  id: "55555555-5555-4555-8555-555555555555", companyId, issueId, title: "Task",
  startsAt, endsAt, createdAt: "2026-10-14T00:00:00.000Z", updatedAt: "2026-10-14T00:00:00.000Z",
});

describe("calendar event routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccessService.decide.mockResolvedValue({ allowed: true, explanation: "allowed" });
    mockLogActivity.mockImplementation(async (_db: unknown, _input: unknown, pubs?: unknown[]) => {
      pubs?.push({ companyId, payload: {}, pluginEvent: null });
      return { id: "activity-1" };
    });
  });

  it("logs issue.event_pinned for a first pin, with no previous value", async () => {
    mockCalendarEventsService.pinIssue.mockResolvedValue({
      event: event("2026-10-14T03:00:00.000Z", "2026-10-14T03:30:00.000Z"), previous: null,
    });
    const res = await request(await createApp(editorActor()))
      .put(`/api/companies/${companyId}/issues/${issueId}/event`)
      .send({ startsAt: "2026-10-14T03:00:00.000Z", durationMinutes: 30 });
    expect(res.status).toBe(200);
    expect(res.body.event.endsAt).toBe("2026-10-14T03:30:00.000Z");
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "issue.event_pinned",
        entityType: "issue",
        entityId: issueId,
        details: expect.objectContaining({ _previous: null }),
      }),
      expect.any(Array),
    );
    expect(mockPublishActivity).toHaveBeenCalledTimes(1);
  });

  it("logs issue.event_moved with the previous times on a second pin", async () => {
    mockCalendarEventsService.pinIssue.mockResolvedValue({
      event: event("2026-10-14T09:50:00.000Z", "2026-10-14T10:20:00.000Z"),
      previous: event("2026-10-14T03:00:00.000Z", "2026-10-14T03:30:00.000Z"),
    });
    const res = await request(await createApp(editorActor()))
      .put(`/api/companies/${companyId}/issues/${issueId}/event`)
      .send({ startsAt: "2026-10-14T09:50:00.000Z" });
    expect(res.status).toBe(200);
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "issue.event_moved",
        details: expect.objectContaining({
          _previous: { startsAt: "2026-10-14T03:00:00.000Z", endsAt: "2026-10-14T03:30:00.000Z" },
        }),
      }),
      expect.any(Array),
    );
  });

  it("rejects both endsAt and durationMinutes with 400", async () => {
    const res = await request(await createApp(editorActor()))
      .put(`/api/companies/${companyId}/issues/${issueId}/event`)
      .send({ startsAt: "2026-10-14T03:00:00.000Z", endsAt: "2026-10-14T04:00:00.000Z", durationMinutes: 30 });
    expect(res.status).toBe(400);
    expect(mockCalendarEventsService.pinIssue).not.toHaveBeenCalled();
  });

  it("returns 403 when the permission check denies the actor", async () => {
    mockAccessService.decide.mockResolvedValue({ allowed: false, explanation: "denied" });
    const res = await request(await createApp(editorActor()))
      .put(`/api/companies/${companyId}/issues/${issueId}/event`)
      .send({ startsAt: "2026-10-14T03:00:00.000Z" });
    expect(res.status).toBe(403);
    expect(mockCalendarEventsService.pinIssue).not.toHaveBeenCalled();
  });

  it("unpins and logs issue.event_unpinned only when something was removed", async () => {
    mockCalendarEventsService.unpinIssue.mockResolvedValueOnce({
      deleted: true, previous: event("2026-10-14T03:00:00.000Z", "2026-10-14T03:30:00.000Z"),
    });
    const first = await request(await createApp(editorActor()))
      .delete(`/api/companies/${companyId}/issues/${issueId}/event`);
    expect(first.status).toBe(200);
    expect(first.body.deleted).toBe(true);
    expect(mockLogActivity).toHaveBeenCalledTimes(1);

    mockCalendarEventsService.unpinIssue.mockResolvedValueOnce({ deleted: false, previous: null });
    const second = await request(await createApp(editorActor()))
      .delete(`/api/companies/${companyId}/issues/${issueId}/event`);
    expect(second.body.deleted).toBe(false);
    expect(mockLogActivity).toHaveBeenCalledTimes(1);
  });

  it("validates range and limit on the list endpoint", async () => {
    mockCalendarEventsService.listEvents.mockResolvedValue({ items: [], nextCursor: null });
    const app = await createApp(editorActor());
    expect((await request(app).get(`/api/companies/${companyId}/calendar-events?limit=0`)).status).toBe(400);
    expect((await request(app).get(`/api/companies/${companyId}/calendar-events?limit=101`)).status).toBe(400);
    expect(
      (await request(app).get(`/api/companies/${companyId}/calendar-events?from=2026-10-15&to=2026-10-14`)).status,
    ).toBe(400);
    expect((await request(app).get(`/api/companies/${companyId}/calendar-events?limit=10`)).status).toBe(200);
  });
});
```

- [ ] **Step 7: Run them to verify they fail**

Run: `npx vitest run server/src/__tests__/calendar-events-routes.test.ts`
Expected: FAIL with `Cannot find module '../routes/calendar-events.js'`.

- [ ] **Step 8: Implement the routes**

Create `server/src/routes/calendar-events.ts`:

```ts
import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { pinIssueEventSchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { badRequest, forbidden } from "../errors.js";
import { accessService, calendarEventsService, logActivity, publishActivity } from "../services/index.js";
import type { ActivityPublication } from "../services/activity-log.js";
import { authorizationDeniedDetails } from "../services/authorization.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

function parseDateQuery(value: unknown, name: string): Date | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") throw badRequest(`${name} must be a date string`);
  const parsed = new Date(value.trim());
  if (Number.isNaN(parsed.getTime())) throw badRequest(`${name} is not a valid date`);
  return parsed;
}

function parseLimit(value: unknown): number {
  if (value === undefined) return 50;
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw badRequest("limit must be an integer");
  const limit = Number(value);
  if (limit < 1 || limit > 100) throw badRequest("limit must be between 1 and 100");
  return limit;
}

export function calendarEventsRoutes(db: Db) {
  const router = Router();
  const access = accessService(db);

  async function assertCanChange(req: import("express").Request, companyId: string) {
    assertCompanyAccess(req, companyId);
    const decision = await access.decide({
      actor: req.actor,
      action: "tasks:assign",
      resource: { type: "issue", companyId, issueId: null, projectId: null },
    });
    if (!decision.allowed) throw forbidden(decision.explanation, authorizationDeniedDetails(decision));
  }

  function actorIds(req: import("express").Request) {
    return {
      agentId: req.actor.type === "agent" ? req.actor.agentId : null,
      userId: req.actor.type === "board" ? req.actor.userId ?? null : null,
    };
  }

  router.get("/companies/:companyId/calendar-events", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const from = parseDateQuery(req.query.from, "from");
    const to = parseDateQuery(req.query.to, "to");
    if (from && to && from > to) throw badRequest("from must be before or equal to to");
    const limit = parseLimit(req.query.limit);
    const cursor = typeof req.query.cursor === "string" && req.query.cursor ? req.query.cursor : undefined;
    res.json(await calendarEventsService(db).listEvents(companyId, { from, to, limit, cursor }));
  });

  router.put(
    "/companies/:companyId/issues/:issueId/event",
    validate(pinIssueEventSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const issueId = req.params.issueId as string;
      await assertCanChange(req, companyId);
      const actor = getActorInfo(req);
      const publications: ActivityPublication[] = [];
      const { event, previous } = await db.transaction(async (tx) => {
        const result = await calendarEventsService(tx).pinIssue(companyId, issueId, req.body, actorIds(req));
        await logActivity(
          tx,
          {
            companyId,
            actorType: actor.actorType,
            actorId: actor.actorId,
            agentId: actor.agentId,
            runId: actor.runId,
            agentApiKeyId: actor.agentApiKeyId,
            action: result.previous ? "issue.event_moved" : "issue.event_pinned",
            entityType: "issue",
            entityId: issueId,
            details: {
              eventId: result.event.id,
              startsAt: result.event.startsAt,
              endsAt: result.event.endsAt,
              _previous: result.previous
                ? { startsAt: result.previous.startsAt, endsAt: result.previous.endsAt }
                : null,
            },
          },
          publications,
        );
        return result;
      });
      for (const publication of publications) publishActivity(publication);
      res.json({ event, moved: previous !== null });
    },
  );

  router.delete("/companies/:companyId/issues/:issueId/event", async (req, res) => {
    const companyId = req.params.companyId as string;
    const issueId = req.params.issueId as string;
    await assertCanChange(req, companyId);
    const actor = getActorInfo(req);
    const publications: ActivityPublication[] = [];
    const deleted = await db.transaction(async (tx) => {
      const result = await calendarEventsService(tx).unpinIssue(companyId, issueId);
      if (result.deleted) {
        await logActivity(
          tx,
          {
            companyId,
            actorType: actor.actorType,
            actorId: actor.actorId,
            agentId: actor.agentId,
            runId: actor.runId,
            agentApiKeyId: actor.agentApiKeyId,
            action: "issue.event_unpinned",
            entityType: "issue",
            entityId: issueId,
            details: {
              _previous: result.previous
                ? { startsAt: result.previous.startsAt, endsAt: result.previous.endsAt }
                : null,
            },
          },
          publications,
        );
      }
      return result.deleted;
    });
    for (const publication of publications) publishActivity(publication);
    res.json({ deleted });
  });

  return router;
}
```

In `server/src/app.ts`, add `import { calendarEventsRoutes } from "./routes/calendar-events.js";` next to the `schedulingRoutes` import (line 48) and add `api.use(calendarEventsRoutes(db));` on the line after `api.use(schedulingRoutes(db));` (line 595).

- [ ] **Step 9: Run all the Task 5 tests and typecheck**

Run: `npx vitest run server/src/__tests__/calendar-events-routes.test.ts server/src/__tests__/calendar-events-service.test.ts server/src/__tests__/calendar-events-schema.test.ts`
Expected: PASS.
Run: `pnpm -r typecheck`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add packages/shared server/src
git commit -m "feat(scheduling): pin, move and unpin issues as calendar events"
```

---

## Phase C: UI

### Task 6: Quick-add composer on the Today page

**Why:** Spec section 4: one gesture creates a task with an estimate, and a double submit creates one task. The composer uses Task 3's endpoint.

**Files:**
- Create: `ui/src/components/TodayQuickAdd.tsx`
- Create: `ui/src/components/TodayQuickAdd.test.tsx`
- Modify: `ui/src/api/scheduling.ts` (add `createScheduledIssue`)
- Modify: `ui/src/pages/Today.tsx:82` and the JSX near line 113 (mount the composer)

**Interfaces:**
- Consumes: `POST /api/companies/:companyId/scheduled-issues` (Task 3); `CreateScheduledIssueRequest` and `CreateScheduledIssueResult` from `@paperclipai/shared`.
- Produces:
  - `schedulingApi.createScheduledIssue(companyId, data: CreateScheduledIssueRequest): Promise<CreateScheduledIssueResult>`.
  - `TodayQuickAdd` props: `{ onCreate: (input: { title: string; estimateMinutes: number | null; clientRequestId: string }) => Promise<void>; pending: boolean }`.

- [ ] **Step 1: Write the failing component tests**

Create `ui/src/components/TodayQuickAdd.test.tsx`:

```tsx
// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TodayQuickAdd } from "./TodayQuickAdd";

function mount(props: Parameters<typeof TodayQuickAdd>[0]) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => root.render(<TodayQuickAdd {...props} />));
  return { container, unmount: () => { flushSync(() => root.unmount()); container.remove(); } };
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function pressEnter(input: HTMLInputElement) {
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
}

describe("TodayQuickAdd", () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => cleanup?.());

  it("creates a task on Enter with a trimmed title and a client request id", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const { container, unmount } = mount({ onCreate, pending: false });
    cleanup = unmount;
    const title = container.querySelector('input[aria-label="Task title"]') as HTMLInputElement;
    type(title, "  Write report  ");
    pressEnter(title);
    await Promise.resolve();
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate.mock.calls[0]![0]).toMatchObject({ title: "Write report", estimateMinutes: null });
    expect(onCreate.mock.calls[0]![0].clientRequestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("sends the estimate when one is entered", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const { container, unmount } = mount({ onCreate, pending: false });
    cleanup = unmount;
    type(container.querySelector('input[aria-label="Task title"]') as HTMLInputElement, "Plan");
    type(container.querySelector('input[aria-label="Estimate in minutes"]') as HTMLInputElement, "45");
    pressEnter(container.querySelector('input[aria-label="Task title"]') as HTMLInputElement);
    await Promise.resolve();
    expect(onCreate.mock.calls[0]![0]).toMatchObject({ title: "Plan", estimateMinutes: 45 });
  });

  it("ignores Enter on an empty or whitespace-only title", () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const { container, unmount } = mount({ onCreate, pending: false });
    cleanup = unmount;
    const title = container.querySelector('input[aria-label="Task title"]') as HTMLInputElement;
    pressEnter(title);
    type(title, "   ");
    pressEnter(title);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("ignores a second submit while pending", () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const { container, unmount } = mount({ onCreate, pending: true });
    cleanup = unmount;
    const title = container.querySelector('input[aria-label="Task title"]') as HTMLInputElement;
    type(title, "Once");
    pressEnter(title);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("keeps the text and reuses the same client request id after a failed create", async () => {
    const onCreate = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValue(undefined);
    const { container, unmount } = mount({ onCreate, pending: false });
    cleanup = unmount;
    const title = container.querySelector('input[aria-label="Task title"]') as HTMLInputElement;
    type(title, "Retry me");
    pressEnter(title);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(title.value).toBe("Retry me");
    pressEnter(title);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onCreate).toHaveBeenCalledTimes(2);
    expect(onCreate.mock.calls[1]![0].clientRequestId).toBe(onCreate.mock.calls[0]![0].clientRequestId);
  });

  it("clears the title and uses a new client request id after a successful create", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const { container, unmount } = mount({ onCreate, pending: false });
    cleanup = unmount;
    const title = container.querySelector('input[aria-label="Task title"]') as HTMLInputElement;
    type(title, "First");
    pressEnter(title);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(title.value).toBe("");
    type(title, "Second");
    pressEnter(title);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onCreate.mock.calls[1]![0].clientRequestId).not.toBe(onCreate.mock.calls[0]![0].clientRequestId);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run ui/src/components/TodayQuickAdd.test.tsx`
Expected: FAIL with `Cannot find module './TodayQuickAdd'`.

- [ ] **Step 3: Implement the component**

Create `ui/src/components/TodayQuickAdd.tsx`:

```tsx
import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Input } from "@/components/ui/input";

interface TodayQuickAddProps {
  onCreate: (input: { title: string; estimateMinutes: number | null; clientRequestId: string }) => Promise<void>;
  pending: boolean;
}

export function TodayQuickAdd({ onCreate, pending }: TodayQuickAddProps) {
  const [title, setTitle] = useState("");
  const [estimate, setEstimate] = useState("");
  const requestId = useRef<string>(crypto.randomUUID());
  const inFlight = useRef(false);

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || pending || inFlight.current) return;
    const parsedEstimate = estimate.trim() === "" ? null : Number(estimate);
    const estimateMinutes =
      parsedEstimate !== null && Number.isInteger(parsedEstimate) && parsedEstimate >= 1 && parsedEstimate <= 1440
        ? parsedEstimate
        : null;
    inFlight.current = true;
    try {
      await onCreate({ title: trimmed, estimateMinutes, clientRequestId: requestId.current });
      setTitle("");
      setEstimate("");
      requestId.current = crypto.randomUUID();
    } catch {
      // Keep the text and the same request id so a retry cannot create a second task.
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
      <Plus className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <Input
        aria-label="Task title"
        placeholder="Add task"
        value={title}
        disabled={pending}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void submit();
          }
        }}
        className="border-0 shadow-none focus-visible:ring-0"
      />
      <Input
        aria-label="Estimate in minutes"
        type="number"
        min={1}
        max={1440}
        placeholder="min"
        value={estimate}
        disabled={pending}
        onChange={(event) => setEstimate(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void submit();
          }
        }}
        className="w-20"
      />
    </div>
  );
}
```

- [ ] **Step 4: Run the component tests**

Run: `npx vitest run ui/src/components/TodayQuickAdd.test.tsx`
Expected: PASS (6 tests). In the first test the `onCreate` call happens synchronously inside the key handler, so `await Promise.resolve()` is enough there. If the "keeps the text" test fails because `title.value` is not updated, check that React re-rendered: wrap the awaited `setTimeout` in `flushSync` or use `act` from `react`.

- [ ] **Step 5: Add the API client method**

In `ui/src/api/scheduling.ts`, add `CreateScheduledIssueRequest` and `CreateScheduledIssueResult` to the type import from `@paperclipai/shared`, and add inside `schedulingApi`, after `listScheduledIssues`:

```ts
  createScheduledIssue: (companyId: string, data: CreateScheduledIssueRequest) =>
    api.post<CreateScheduledIssueResult>(`/companies/${companyId}/scheduled-issues`, data),
```

- [ ] **Step 6: Mount the composer in `Today.tsx`**

In `ui/src/pages/Today.tsx`:

1. Add `import { TodayQuickAdd } from "../components/TodayQuickAdd";` with the other component imports.
2. After `resizeMutation` (line 94) add:

```tsx
  const createMutation = useMutation({
    mutationFn: (input: { title: string; estimateMinutes: number | null; clientRequestId: string }) =>
      schedulingApi.createScheduledIssue(selectedCompanyId!, input),
    onSuccess: invalidate,
    onError: (err: Error) => pushToast({ title: "Couldn't add task", body: err.message, tone: "error" }),
  });
```

3. In the JSX, directly above the `<div className="rounded-lg border border-border bg-card p-4">` that wraps the grid, add:

```tsx
      <TodayQuickAdd
        pending={createMutation.isPending}
        onCreate={async (input) => {
          await createMutation.mutateAsync(input);
        }}
      />
```

- [ ] **Step 7: Run the UI checks**

Run: `npx vitest run ui/src/components/TodayQuickAdd.test.tsx ui/src/components/ScheduleAgendaGrid.test.tsx`
Expected: PASS.
Run: `pnpm check:token-gates && pnpm --filter @paperclipai/ui typecheck`
Expected: both pass. The composer uses only existing classes (`border-border`, `bg-card`, `text-muted-foreground`) and the shared `Input`.

- [ ] **Step 8: Commit**

```bash
git add ui/src
git commit -m "feat(ui): quick-add composer on the Today page"
```

---

### Task 7: Projected block and Pin on the Today grid

**Why:** Spec section 5: a task with an estimate and no time shows a tentative block that is not saved. The **Pin** action saves it as an event.

**Files:**
- Create: `ui/src/lib/projectDay.ts`
- Create: `ui/src/lib/projectDay.test.ts`
- Modify: `ui/src/api/scheduling.ts` (add `pinIssueEvent`, `unpinIssueEvent`)
- Modify: `ui/src/components/ScheduleAgendaGrid.tsx` (props and render)
- Modify: `ui/src/components/ScheduleAgendaGrid.test.tsx` (add tests)
- Modify: `ui/src/pages/Today.tsx` (query the unscheduled estimates, wire pin)

**Interfaces:**
- Consumes: `PUT /api/companies/:companyId/issues/:issueId/event` (Task 5); `GET .../scheduled-issues` without a range, which returns rows with a null `scheduledAt` too (verified in `listScheduledIssues`); `ScheduleAgendaGrid` from Task 2.
- Produces:
  - `projectDay(items, now, startHour, endHour): ProjectedItem[]` where `items: { issueId: string; title: string; minutes: number }[]` and `ProjectedItem = { issueId: string; title: string; start: Date; minutes: number }`. Blocks are placed one after another, starting at the next 5-minute mark at or after `now`, and never before `startHour` or past `endHour`.
  - `ScheduleAgendaGrid` new optional props `projectedItems?: ProjectedItem[]` and `onPinProjected?: (issueId: string, start: Date, minutes: number) => void`.
  - `schedulingApi.pinIssueEvent(companyId, issueId, data: PinIssueEventRequest): Promise<{ event: CalendarEvent; moved: boolean }>`.

- [ ] **Step 1: Write the failing projection tests**

Create `ui/src/lib/projectDay.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { projectDay } from "./projectDay";

const day = (h: number, m = 0) => new Date(2026, 9, 14, h, m, 0, 0);

describe("projectDay", () => {
  it("starts at the next 5-minute mark at or after now", () => {
    const [first] = projectDay([{ issueId: "a", title: "A", minutes: 30 }], day(17, 47), 7, 20);
    expect(first!.start.getTime()).toBe(day(17, 50).getTime());
  });

  it("keeps an exact 5-minute mark", () => {
    const [first] = projectDay([{ issueId: "a", title: "A", minutes: 30 }], day(17, 50), 7, 20);
    expect(first!.start.getTime()).toBe(day(17, 50).getTime());
  });

  it("chains blocks back to back", () => {
    const result = projectDay(
      [{ issueId: "a", title: "A", minutes: 30 }, { issueId: "b", title: "B", minutes: 45 }],
      day(9, 0), 7, 20,
    );
    expect(result[0]!.start.getTime()).toBe(day(9, 0).getTime());
    expect(result[1]!.start.getTime()).toBe(day(9, 30).getTime());
  });

  it("starts at the day start when now is earlier", () => {
    const [first] = projectDay([{ issueId: "a", title: "A", minutes: 30 }], day(5, 12), 7, 20);
    expect(first!.start.getTime()).toBe(day(7, 0).getTime());
  });

  it("drops blocks that would end after the day end", () => {
    const result = projectDay(
      [{ issueId: "a", title: "A", minutes: 60 }, { issueId: "b", title: "B", minutes: 60 }],
      day(18, 30), 7, 20,
    );
    expect(result.map((item) => item.issueId)).toEqual(["a"]);
  });

  it("returns nothing for a task with no estimate", () => {
    expect(projectDay([{ issueId: "a", title: "A", minutes: 0 }], day(9, 0), 7, 20)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run ui/src/lib/projectDay.test.ts`
Expected: FAIL with `Cannot find module './projectDay'`.

- [ ] **Step 3: Implement the projection**

Create `ui/src/lib/projectDay.ts`:

```ts
export interface ProjectionInput {
  issueId: string;
  title: string;
  minutes: number;
}

export interface ProjectedItem {
  issueId: string;
  title: string;
  start: Date;
  minutes: number;
}

const STEP_MINUTES = 5;

export function projectDay(
  items: ProjectionInput[],
  now: Date,
  startHour: number,
  endHour: number,
): ProjectedItem[] {
  const dayStart = new Date(now);
  dayStart.setHours(startHour, 0, 0, 0);
  const dayEnd = new Date(now);
  dayEnd.setHours(endHour, 0, 0, 0);

  const stepMs = STEP_MINUTES * 60_000;
  const rounded = new Date(Math.ceil(now.getTime() / stepMs) * stepMs);
  let cursor = rounded.getTime() < dayStart.getTime() ? dayStart : rounded;

  const result: ProjectedItem[] = [];
  for (const item of items) {
    if (!Number.isInteger(item.minutes) || item.minutes < 1) continue;
    const end = new Date(cursor.getTime() + item.minutes * 60_000);
    if (end.getTime() > dayEnd.getTime()) break;
    result.push({ issueId: item.issueId, title: item.title, start: cursor, minutes: item.minutes });
    cursor = end;
  }
  return result;
}
```

- [ ] **Step 4: Run the projection tests**

Run: `npx vitest run ui/src/lib/projectDay.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Write the failing grid tests**

Add to `ui/src/components/ScheduleAgendaGrid.test.tsx`, inside the `describe`:

```tsx
  it("draws a projected block and pins it with its start and minutes", () => {
    const onPinProjected = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const start = new Date(2026, 9, 14, 17, 50, 0);

    flushSync(() => {
      root!.render(
        <ScheduleAgendaGrid
          date={new Date(2026, 9, 14)}
          startHour={7}
          endHour={20}
          items={[]}
          projectedItems={[{ issueId: "issue-9", title: "Projected task", start, minutes: 30 }]}
          onPinProjected={onPinProjected}
          onSelectItem={() => {}}
        />,
      );
    });

    expect(container.textContent).toContain("Projected task");
    const pin = container.querySelector('button[aria-label="Pin to calendar"]') as HTMLButtonElement;
    expect(pin).not.toBeNull();
    pin.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onPinProjected).toHaveBeenCalledTimes(1);
    expect(onPinProjected).toHaveBeenCalledWith("issue-9", start, 30);
  });

  it("marks projected blocks as tentative for assistive tech", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    flushSync(() => {
      root!.render(
        <ScheduleAgendaGrid
          date={new Date(2026, 9, 14)}
          startHour={7}
          endHour={20}
          items={[]}
          projectedItems={[{ issueId: "issue-9", title: "Projected task", start: new Date(2026, 9, 14, 9, 0, 0), minutes: 30 }]}
          onSelectItem={() => {}}
        />,
      );
    });
    expect(container.querySelector('[data-projected="true"]')?.getAttribute("aria-label")).toContain("Projected");
  });
```

- [ ] **Step 6: Run them to verify they fail**

Run: `npx vitest run ui/src/components/ScheduleAgendaGrid.test.tsx`
Expected: FAIL. The new tests fail because the grid has no `projectedItems` prop.

- [ ] **Step 7: Add the projected block to the grid**

In `ui/src/components/ScheduleAgendaGrid.tsx`:

1. Add `import type { ProjectedItem } from "../lib/projectDay";` with the imports.
2. Add to `ScheduleAgendaGridProps`:

```tsx
  /** Tentative blocks: not saved. Each one has a Pin action. */
  projectedItems?: ProjectedItem[];
  onPinProjected?: (issueId: string, start: Date, minutes: number) => void;
```

3. Add `projectedItems` and `onPinProjected` to the destructured props.
4. In the render, directly after the `{items.map(...)}` block and before the `items.length === 0` message, add:

```tsx
        {(projectedItems ?? []).map((projected) => {
          const minutesFromStart = (projected.start.getHours() - startHour) * 60 + projected.start.getMinutes();
          const top = (minutesFromStart / 60) * pixelsPerHour;
          const height = Math.max(22, (projected.minutes / 60) * pixelsPerHour - 2);
          return (
            <div
              key={`projected-${projected.issueId}`}
              data-projected="true"
              aria-label={`Projected time for ${projected.title}`}
              className="absolute w-full pr-1"
              style={{ top: `${top}px`, height: `${height}px` }}
            >
              <div className="flex h-full w-full items-start justify-between gap-1 overflow-hidden rounded-md border border-dashed border-primary/40 bg-primary/5 p-1.5 text-xs">
                <p className="min-w-0 truncate text-muted-foreground">{projected.title}</p>
                {onPinProjected && (
                  <button
                    type="button"
                    aria-label="Pin to calendar"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPinProjected(projected.issueId, projected.start, projected.minutes);
                    }}
                    className="shrink-0 rounded border border-border bg-background px-1.5 py-0.5 text-(length:--text-nano) text-foreground hover:bg-accent"
                  >
                    Pin
                  </button>
                )}
              </div>
            </div>
          );
        })}
```

5. Change the empty-state condition from `items.length === 0` to `items.length === 0 && (projectedItems ?? []).length === 0`.

- [ ] **Step 8: Run the grid tests**

Run: `npx vitest run ui/src/components/ScheduleAgendaGrid.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 9: Add the API client methods**

In `ui/src/api/scheduling.ts`, add `CalendarEvent` and `PinIssueEventRequest` to the type import, and add inside `schedulingApi`:

```ts
  pinIssueEvent: (companyId: string, issueId: string, data: PinIssueEventRequest) =>
    api.put<{ event: CalendarEvent; moved: boolean }>(
      `/companies/${companyId}/issues/${issueId}/event`,
      data,
    ),
  unpinIssueEvent: (companyId: string, issueId: string) =>
    api.delete<{ deleted: boolean }>(`/companies/${companyId}/issues/${issueId}/event`),
```

- [ ] **Step 10: Wire projection and pin into `Today.tsx`**

In `ui/src/pages/Today.tsx`:

1. Add `import { projectDay } from "../lib/projectDay";`.
2. After the existing `useQuery`, add a second query for tasks with an estimate and no time (the broad list, first page):

```tsx
  const unscheduledQuery = useQuery({
    queryKey: queryKeys.scheduling.scheduledIssues(selectedCompanyId!, undefined, undefined),
    queryFn: () => schedulingApi.listScheduledIssues(selectedCompanyId!, { limit: 100 }),
    enabled: !!selectedCompanyId,
  });
```

3. After `items`, add:

```tsx
  const projectedItems = useMemo(() => {
    const candidates = (unscheduledQuery.data?.items ?? [])
      .filter((item) => !item.scheduledAt && item.scheduledDurationMinutes && !["done", "cancelled"].includes(item.status))
      .map((item) => ({
        issueId: item.issueId,
        title: item.title,
        minutes: item.scheduledDurationMinutes as number,
      }));
    return projectDay(candidates, new Date(), config.startHour, config.endHour);
  }, [unscheduledQuery.data, config.startHour, config.endHour]);

  const pinMutation = useMutation({
    mutationFn: ({ issueId, start, minutes }: { issueId: string; start: Date; minutes: number }) =>
      schedulingApi.pinIssueEvent(selectedCompanyId!, issueId, {
        startsAt: start.toISOString(),
        durationMinutes: minutes,
      }),
    onSuccess: invalidate,
    onError: (err: Error) => pushToast({ title: "Couldn't pin task", body: err.message, tone: "error" }),
  });
```

4. Pass the new props to `ScheduleAgendaGrid`:

```tsx
          projectedItems={projectedItems}
          onPinProjected={(issueId, start, minutes) => pinMutation.mutate({ issueId, start, minutes })}
```

`projectedItems` uses `new Date()` at calculation time. The block moves forward only when the query data or the config changes. Re-render on a timer is out of scope for this plan. The spec observed Sunsama sliding the block with the clock; a one-minute `setInterval` that bumps a `now` state would add that, and it is not part of the acceptance criteria.

- [ ] **Step 11: Run the full UI checks**

Run: `npx vitest run ui/src/lib/projectDay.test.ts ui/src/components/ScheduleAgendaGrid.test.tsx ui/src/components/TodayQuickAdd.test.tsx`
Expected: PASS.
Run: `pnpm check:token-gates && pnpm --filter @paperclipai/ui typecheck`
Expected: both pass. The new classes (`border-dashed`, `border-primary/40`, `bg-primary/5`, `hover:bg-accent`, `text-(length:--text-nano)`) are the same families the grid already uses. If the token gate rejects one, replace it with a token from `ui/src/index.css`.

- [ ] **Step 12: Run the whole branch's checks before the PR**

Run: `pnpm -r typecheck && pnpm test:run && pnpm build`
Expected: all pass. Then run each server test file listed in Tasks 1, 3, 4 and 5 once more, because `t3-ci` does not run them.

- [ ] **Step 13: Commit**

```bash
git add ui/src
git commit -m "feat(ui): projected time block with Pin on the Today page"
```

---

## Phase D: External API for the timesheet tool (gated, not planned here)

Do not write tasks for this phase until the owner answers spec section 7c, questions 1 to 3. The questions are: pull or push, who owns actual time, and whether a scheduling change is payable.

Verified starting points for whoever plans it (from spec 7b and 7d):

- The activity list (`GET /companies/:companyId/activity`, `server/src/routes/activity.ts:222`) filters only on `agentId`, `entityType`, `entityId` and `limit`. A pull consumer needs at least a `since` filter and a cursor.
- `issue.scheduling_updated`, `issue.scheduling_cleared` and the three `issue.event_*` actions from Task 5 are not in `ACTIVITY_ACTION_TO_PLUGIN_EVENT` (`server/src/services/activity-log.ts:26`) or the Discord mapping, so a push consumer cannot subscribe to them. Adding a plugin event type changes the plugin SDK contract in `packages/plugin-sdk`.
- `integration_event_outbox` with an `idempotency_key` already exists for Discord and is the likely pattern for a push integration.
- The scheduling and event routes are not in `server/src/routes/openapi.ts`, so `GET /api/openapi.json` does not describe them.
- There is no actual-time field anywhere in the schema.

## Self-Review

**Spec coverage.**
- Quick add (spec 4.3, criteria 1 to 6): Task 6 covers 1, 2, 3 and 6. Criterion 4 (defaults) is met by the composer's optional estimate and the server's null scheduling, and the default channel is left to the existing issue defaults. Criterion 5 (a failed create is visible and leaves no phantom) is covered by Task 3's rollback test and Task 6's toast and kept text.
- Pin (spec 5.4, criteria 1 to 6): criterion 1 is Task 7. Criteria 2 and 3 are Task 5 (one event per issue, move keeps duration). Criterion 4 (pinned counts as busy, projected does not) has no code in this plan, because there is no conflict detection; it is visual only (solid versus dashed) and the plan states overlap is allowed (A3). Criterion 5 (no notifications) holds because nothing here sends any. Criterion 6 (delete removes the block) is Task 4.
- Review Focus items 1 to 5: each has a named test in Tasks 3 to 5 and 6.
- Spec 7b gaps 3 and 4 (atomic log, previous values): Task 1. Gaps 1, 2, 6 and 7 are left to Phase D on purpose.
- Spec 7d findings 1 to 3: Tasks 2, 3 and 7. Finding 4 (OpenAPI) is Phase D. Finding 5 (no tentative state) is Task 7.

**Placeholder scan.** No "TBD", no "similar to Task N", and no expression left for the reader to replace.

**Type consistency.** `createScheduledIssue(companyId, input, actor, afterWrite?)`, `pinIssue(companyId, issueId, input, actor)` and `unpinIssue(companyId, issueId)` keep the same names and argument order in the tests, the services, the routes and the UI client. `CalendarEvent`, `PinIssueEventRequest` and `CreateScheduledIssueResult` are defined once in `packages/shared` and imported everywhere else.

**What this plan has not verified.** None of the code in this plan has been compiled or run. Specifically unverified: that `tx` is assignable to `Db` in `schedulingService(tx)` and `issueService(tx)` (the repo does this for `logActivity`), that Drizzle's `targetWhere` generates the partial-index conflict target, that the `ui` test pattern with `flushSync` and native events behaves as written, and the exact migration number (`0235`). Each of these has a failing-then-passing test or a typecheck step that will show the result.
