import { and, asc, eq, gt, gte, isNull, lte, or, sql } from "drizzle-orm";
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

/**
 * Keeps the calendar event in step with an issue_scheduling row, so that
 * "has scheduledAt" and "has an event" mean the same thing for every writer.
 * Call it with the same Db or transaction that wrote the scheduling row.
 */
export async function syncCalendarEventForScheduling(
  db: Db,
  row: { companyId: string; issueId: string; scheduledAt: Date | null; scheduledDurationMinutes: number | null },
): Promise<void> {
  if (!row.scheduledAt) {
    await db
      .delete(calendarEvents)
      .where(and(eq(calendarEvents.companyId, row.companyId), eq(calendarEvents.issueId, row.issueId)));
    return;
  }
  const issue = await db
    .select({ title: issues.title })
    .from(issues)
    .where(and(eq(issues.companyId, row.companyId), eq(issues.id, row.issueId)))
    .then((rows) => rows[0] ?? null);
  if (!issue) return;
  const startsAt = row.scheduledAt;
  const endsAt = new Date(startsAt.getTime() + (row.scheduledDurationMinutes ?? DEFAULT_EVENT_MINUTES) * 60_000);
  await db
    .insert(calendarEvents)
    .values({ companyId: row.companyId, issueId: row.issueId, title: issue.title, startsAt, endsAt })
    .onConflictDoUpdate({
      target: calendarEvents.issueId,
      targetWhere: sql`${calendarEvents.issueId} is not null`,
      set: { startsAt, endsAt, title: issue.title, updatedAt: new Date() },
    });
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
      .select({ event: calendarEvents })
      .from(calendarEvents)
      .leftJoin(issues, eq(issues.id, calendarEvents.issueId))
      .where(and(...conditions, isNull(issues.hiddenAt)))
      .orderBy(asc(calendarEvents.startsAt), asc(calendarEvents.id))
      .limit(limit + 1)
      .then((result) => result.map((entry) => entry.event));
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
