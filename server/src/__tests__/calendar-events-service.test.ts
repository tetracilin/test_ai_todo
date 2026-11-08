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

  it("does not list events for hidden issues", async () => {
    const { companyId, issueId, svc } = await seedIssue("Hidden soon");
    await svc.pinIssue(companyId, issueId, { startsAt: new Date("2026-10-14T03:00:00.000Z"), durationMinutes: 30 }, actor);
    expect((await svc.listEvents(companyId)).items).toHaveLength(1);
    await db.update(issues).set({ hiddenAt: new Date() }).where(eq(issues.id, issueId));
    expect((await svc.listEvents(companyId)).items).toHaveLength(0);
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
