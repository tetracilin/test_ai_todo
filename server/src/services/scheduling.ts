import { and, asc, desc, eq, gt, gte, isNull, lte, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { companyMemberships, issueScheduling, issues, projects, schedulingRoutines } from "@paperclipai/db";
import type {
  CreateSchedulingRoutine,
  GenerateSchedulingRoutineIssues,
  UpdateSchedulingRoutine,
  UpsertIssueScheduling,
} from "@paperclipai/shared";
import type {
  GenerateSchedulingRoutineIssuesResult,
  IssueScheduling,
  ScheduledIssueListItem,
  SchedulingRecurrenceRule,
  SchedulingRoutine,
} from "@paperclipai/shared";
import { badRequest, notFound, unprocessable } from "../errors.js";
import { assertAssignableAgent } from "./agent-assignability.js";
import { issueService } from "./issues.js";

type IssueSchedulingRow = typeof issueScheduling.$inferSelect;
type SchedulingRoutineRow = typeof schedulingRoutines.$inferSelect;

const MAX_GENERATE_LOOKBACK_DAYS = 14;

type ScheduledIssuesCursor = { scheduledAt: string | null; issueId: string };

function decodeScheduledIssuesCursor(cursor: string | undefined): ScheduledIssuesCursor | null {
  if (!cursor) return null;
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<ScheduledIssuesCursor>;
    if (typeof decoded.issueId !== "string" || decoded.issueId.length === 0) throw new Error("invalid issue id");
    if (decoded.scheduledAt !== null && typeof decoded.scheduledAt !== "string") throw new Error("invalid date");
    if (decoded.scheduledAt && Number.isNaN(new Date(decoded.scheduledAt).getTime())) throw new Error("invalid date");
    return { scheduledAt: decoded.scheduledAt ?? null, issueId: decoded.issueId };
  } catch {
    throw badRequest("cursor is invalid");
  }
}

function encodeScheduledIssuesCursor(cursor: ScheduledIssuesCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function toIssueScheduling(row: IssueSchedulingRow): IssueScheduling {
  return {
    issueId: row.issueId,
    companyId: row.companyId,
    scheduledAt: row.scheduledAt ? row.scheduledAt.toISOString() : null,
    deferUntil: row.deferUntil ? row.deferUntil.toISOString() : null,
    scheduledDurationMinutes: row.scheduledDurationMinutes ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toSchedulingRoutine(row: SchedulingRoutineRow): SchedulingRoutine {
  return {
    id: row.id,
    companyId: row.companyId,
    projectId: row.projectId ?? null,
    title: row.title,
    description: row.description ?? null,
    assigneeAgentId: row.assigneeAgentId ?? null,
    assigneeUserId: row.assigneeUserId ?? null,
    priority: row.priority,
    status: row.status === "paused" ? "paused" : "active",
    recurrenceRule: row.recurrenceRule,
    timezone: row.timezone,
    scheduledTime: row.scheduledTime ?? null,
    estimateMinutes: row.estimateMinutes ?? null,
    lastGeneratedForDate: row.lastGeneratedForDate ?? null,
    createdByAgentId: row.createdByAgentId ?? null,
    createdByUserId: row.createdByUserId ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function localDateKey(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function localDateTimeToUtc(dateKey: string, time: string, timezone: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = desired;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = formatter.formatToParts(new Date(candidate));
    const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
    const observed = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"));
    candidate += desired - observed;
  }
  const result = new Date(candidate);
  const roundTripKey = localDateKey(result, timezone);
  const roundTripTime = formatter
    .formatToParts(result)
    .filter((part) => part.type === "hour" || part.type === "minute")
    .map((part) => part.value)
    .join(":");
  if (roundTripKey !== dateKey || roundTripTime !== time) {
    throw unprocessable(`Scheduled local time does not exist in timezone ${timezone}`);
  }
  return result;
}

function addDays(dateKey: string, days: number): string {
  const next = new Date(`${dateKey}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return toDateKey(next);
}

function matchesRecurrence(rule: SchedulingRecurrenceRule, dateKey: string): boolean {
  if (rule.kind === "daily") return true;
  const dayOfWeek = new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();
  return rule.daysOfWeek.includes(dayOfWeek);
}

function assertSingleAssignee(assigneeAgentId?: string | null, assigneeUserId?: string | null) {
  if (assigneeAgentId && assigneeUserId) {
    throw unprocessable("Scheduling routine can only have one assignee");
  }
}

export function schedulingService(db: Db) {
  async function assertRoutineReferences(
    companyId: string,
    references: {
      projectId?: string | null;
      assigneeAgentId?: string | null;
      assigneeUserId?: string | null;
    },
  ) {
    if (references.projectId) {
      const project = await db
        .select({ companyId: projects.companyId })
        .from(projects)
        .where(eq(projects.id, references.projectId))
        .then((rows) => rows[0] ?? null);
      if (!project) throw notFound("Project not found");
      if (project.companyId !== companyId) {
        throw unprocessable("Project must belong to same company");
      }
    }
    if (references.assigneeAgentId) {
      await assertAssignableAgent(db, companyId, references.assigneeAgentId, { kind: "routine" });
    }
    if (references.assigneeUserId) {
      const membership = await db
        .select({ id: companyMemberships.id })
        .from(companyMemberships)
        .where(
          and(
            eq(companyMemberships.companyId, companyId),
            eq(companyMemberships.principalType, "user"),
            eq(companyMemberships.principalId, references.assigneeUserId),
            eq(companyMemberships.status, "active"),
          ),
        )
        .then((rows) => rows[0] ?? null);
      if (!membership) throw notFound("Assignee user not found");
    }
  }

  async function getIssueRowInCompany(companyId: string, issueId: string) {
    const row = await db
      .select({ id: issues.id, companyId: issues.companyId })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0] ?? null);
    if (!row || row.companyId !== companyId) return null;
    return row;
  }

  async function getIssueScheduling(companyId: string, issueId: string): Promise<IssueScheduling | null> {
    if (!(await getIssueRowInCompany(companyId, issueId))) throw notFound("Issue not found");
    const row = await db
      .select()
      .from(issueScheduling)
      .where(and(eq(issueScheduling.companyId, companyId), eq(issueScheduling.issueId, issueId)))
      .then((rows) => rows[0] ?? null);
    return row ? toIssueScheduling(row) : null;
  }

  async function upsertIssueScheduling(
    companyId: string,
    issueId: string,
    patch: UpsertIssueScheduling,
  ): Promise<IssueScheduling> {
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
    return toIssueScheduling(row);
  }

  async function clearIssueScheduling(companyId: string, issueId: string): Promise<boolean> {
    if (!(await getIssueRowInCompany(companyId, issueId))) throw notFound("Issue not found");
    const deleted = await db
      .delete(issueScheduling)
      .where(and(eq(issueScheduling.companyId, companyId), eq(issueScheduling.issueId, issueId)))
      .returning({ issueId: issueScheduling.issueId });
    return deleted.length > 0;
  }

  async function listScheduledIssues(
    companyId: string,
    filters: { from?: Date; to?: Date; limit?: number; cursor?: string } = {},
  ): Promise<{ items: ScheduledIssueListItem[]; nextCursor: string | null }> {
    const limit = filters.limit ?? 50;
    const cursor = decodeScheduledIssuesCursor(filters.cursor);
    const conditions = [eq(issueScheduling.companyId, companyId), isNull(issues.hiddenAt)];
    if (filters.from) conditions.push(gte(issueScheduling.scheduledAt, filters.from));
    if (filters.to) conditions.push(lte(issueScheduling.scheduledAt, filters.to));
    if (cursor) {
      conditions.push(
        cursor.scheduledAt
          ? or(
              gt(issueScheduling.scheduledAt, new Date(cursor.scheduledAt)),
              and(eq(issueScheduling.scheduledAt, new Date(cursor.scheduledAt)), gt(issueScheduling.issueId, cursor.issueId)),
              isNull(issueScheduling.scheduledAt),
            )!
          : and(isNull(issueScheduling.scheduledAt), gt(issueScheduling.issueId, cursor.issueId))!,
      );
    }
    const rows = await db
      .select({
        issueId: issues.id,
        identifier: issues.identifier,
        title: issues.title,
        status: issues.status,
        priority: issues.priority,
        assigneeAgentId: issues.assigneeAgentId,
        assigneeUserId: issues.assigneeUserId,
        scheduledAt: issueScheduling.scheduledAt,
        deferUntil: issueScheduling.deferUntil,
        scheduledDurationMinutes: issueScheduling.scheduledDurationMinutes,
      })
      .from(issueScheduling)
      .innerJoin(issues, eq(issues.id, issueScheduling.issueId))
      .where(and(...conditions))
      .orderBy(asc(issueScheduling.scheduledAt), asc(issueScheduling.issueId))
      .limit(limit + 1);
    const hasNextPage = rows.length > limit;
    const items = rows.slice(0, limit).map((row) => ({
      ...row,
      scheduledAt: row.scheduledAt ? row.scheduledAt.toISOString() : null,
      deferUntil: row.deferUntil ? row.deferUntil.toISOString() : null,
    }));
    return {
      items,
      nextCursor: hasNextPage && items.length > 0
        ? encodeScheduledIssuesCursor({
            scheduledAt: items.at(-1)!.scheduledAt,
            issueId: items.at(-1)!.issueId,
          })
        : null,
    };
  }

  async function listRoutines(companyId: string): Promise<SchedulingRoutine[]> {
    const rows = await db
      .select()
      .from(schedulingRoutines)
      .where(eq(schedulingRoutines.companyId, companyId))
      .orderBy(desc(schedulingRoutines.createdAt));
    return rows.map(toSchedulingRoutine);
  }

  async function getRoutineRow(companyId: string, routineId: string): Promise<SchedulingRoutineRow | null> {
    return db
      .select()
      .from(schedulingRoutines)
      .where(and(eq(schedulingRoutines.companyId, companyId), eq(schedulingRoutines.id, routineId)))
      .then((rows) => rows[0] ?? null);
  }

  async function getRoutine(companyId: string, routineId: string): Promise<SchedulingRoutine> {
    const row = await getRoutineRow(companyId, routineId);
    if (!row) throw notFound("Scheduling routine not found");
    return toSchedulingRoutine(row);
  }

  async function createRoutine(
    companyId: string,
    input: CreateSchedulingRoutine,
    actor: { agentId?: string | null; userId?: string | null },
  ): Promise<SchedulingRoutine> {
    assertSingleAssignee(input.assigneeAgentId, input.assigneeUserId);
    await assertRoutineReferences(companyId, input);
    const row = await db
      .insert(schedulingRoutines)
      .values({
        companyId,
        projectId: input.projectId ?? null,
        title: input.title,
        description: input.description ?? null,
        assigneeAgentId: input.assigneeAgentId ?? null,
        assigneeUserId: input.assigneeUserId ?? null,
        priority: input.priority ?? "medium",
        recurrenceRule: input.recurrenceRule,
        timezone: input.timezone ?? "UTC",
        scheduledTime: input.scheduledTime ?? null,
        estimateMinutes: input.estimateMinutes ?? null,
        createdByAgentId: actor.agentId ?? null,
        createdByUserId: actor.userId ?? null,
      })
      .returning()
      .then((rows) => rows[0]!);
    return toSchedulingRoutine(row);
  }

  async function updateRoutine(
    companyId: string,
    routineId: string,
    patch: UpdateSchedulingRoutine,
  ): Promise<SchedulingRoutine> {
    const existing = await getRoutineRow(companyId, routineId);
    if (!existing) throw notFound("Scheduling routine not found");
    const nextAssigneeAgentId = patch.assigneeAgentId === undefined ? existing.assigneeAgentId : patch.assigneeAgentId;
    const nextAssigneeUserId = patch.assigneeUserId === undefined ? existing.assigneeUserId : patch.assigneeUserId;
    const nextProjectId = patch.projectId === undefined ? existing.projectId : patch.projectId;
    assertSingleAssignee(nextAssigneeAgentId, nextAssigneeUserId);
    await assertRoutineReferences(companyId, {
      projectId: nextProjectId,
      assigneeAgentId: nextAssigneeAgentId,
      assigneeUserId: nextAssigneeUserId,
    });
    const row = await db
      .update(schedulingRoutines)
      .set({
        projectId: nextProjectId,
        title: patch.title ?? existing.title,
        description: patch.description === undefined ? existing.description : patch.description,
        assigneeAgentId: nextAssigneeAgentId,
        assigneeUserId: nextAssigneeUserId,
        priority: patch.priority ?? existing.priority,
        status: patch.status ?? existing.status,
        recurrenceRule: patch.recurrenceRule ?? existing.recurrenceRule,
        timezone: patch.timezone ?? existing.timezone,
        scheduledTime: patch.scheduledTime === undefined ? existing.scheduledTime : patch.scheduledTime,
        estimateMinutes: patch.estimateMinutes === undefined ? existing.estimateMinutes : patch.estimateMinutes,
        updatedAt: new Date(),
      })
      .where(and(eq(schedulingRoutines.companyId, companyId), eq(schedulingRoutines.id, routineId)))
      .returning()
      .then((rows) => rows[0]!);
    return toSchedulingRoutine(row);
  }

  async function deleteRoutine(companyId: string, routineId: string): Promise<boolean> {
    const deleted = await db
      .delete(schedulingRoutines)
      .where(and(eq(schedulingRoutines.companyId, companyId), eq(schedulingRoutines.id, routineId)))
      .returning({ id: schedulingRoutines.id });
    return deleted.length > 0;
  }

  async function generateDueIssuesForRoutine(
    companyId: string,
    routineId: string,
    options: GenerateSchedulingRoutineIssues = {},
  ): Promise<GenerateSchedulingRoutineIssuesResult> {
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`scheduling-routine:${companyId}:${routineId}`}, 0))`,
      );
      const routine = await tx
        .select()
        .from(schedulingRoutines)
        .where(and(eq(schedulingRoutines.companyId, companyId), eq(schedulingRoutines.id, routineId)))
        .then((rows) => rows[0] ?? null);
      if (!routine) throw notFound("Scheduling routine not found");
      if (routine.status !== "active") {
        return { routineId, createdIssueIds: [], lastGeneratedForDate: routine.lastGeneratedForDate };
      }
      await assertRoutineReferences(companyId, routine);
      const asOf = options.asOf ?? new Date();
      const asOfKey = localDateKey(asOf, routine.timezone);
      const maxDays = Math.min(options.maxDays ?? MAX_GENERATE_LOOKBACK_DAYS, MAX_GENERATE_LOOKBACK_DAYS);
      const earliestKey = addDays(asOfKey, -(maxDays - 1));
      let startKey = routine.lastGeneratedForDate ? addDays(routine.lastGeneratedForDate, 1) : asOfKey;
      if (startKey < earliestKey) startKey = earliestKey;

      const createdIssueIds: string[] = [];
      let cursorKey = routine.lastGeneratedForDate;
      const transactionalIssues = issueService(tx as unknown as Db);
      for (let dateKey = startKey; dateKey <= asOfKey; dateKey = addDays(dateKey, 1)) {
        if (matchesRecurrence(routine.recurrenceRule, dateKey)) {
          const scheduledAt = localDateTimeToUtc(dateKey, routine.scheduledTime ?? "00:00", routine.timezone);
          let deduplicated = false;
          const created = await transactionalIssues.create(companyId, {
            title: routine.title,
            description: routine.description,
            projectId: routine.projectId,
            assigneeAgentId: routine.assigneeAgentId,
            assigneeUserId: routine.assigneeUserId,
            priority: routine.priority,
            status: "todo",
            originKind: "scheduling_routine_instance",
            originId: routine.id,
            originFingerprint: dateKey,
            idempotencyKey: `scheduling-routine:${routine.id}:${dateKey}`,
            onDeduplicated: () => {
              deduplicated = true;
            },
          });
          await tx
            .insert(issueScheduling)
            .values({
              issueId: created.id,
              companyId,
              scheduledAt,
              scheduledDurationMinutes: routine.estimateMinutes ?? null,
            })
            .onConflictDoUpdate({
              target: issueScheduling.issueId,
              set: { scheduledAt, scheduledDurationMinutes: routine.estimateMinutes ?? null, updatedAt: new Date() },
            });
          if (!deduplicated) createdIssueIds.push(created.id);
        }
        cursorKey = dateKey;
      }
      if (cursorKey && cursorKey !== routine.lastGeneratedForDate) {
        await tx
          .update(schedulingRoutines)
          .set({ lastGeneratedForDate: cursorKey, updatedAt: new Date() })
          .where(and(eq(schedulingRoutines.companyId, companyId), eq(schedulingRoutines.id, routineId)));
      }
      return { routineId, createdIssueIds, lastGeneratedForDate: cursorKey };
    });
  }

  async function generateDueIssues(
    companyId: string,
    options: GenerateSchedulingRoutineIssues = {},
  ): Promise<GenerateSchedulingRoutineIssuesResult[]> {
    const rows = await db
      .select({ id: schedulingRoutines.id })
      .from(schedulingRoutines)
      .where(and(eq(schedulingRoutines.companyId, companyId), eq(schedulingRoutines.status, "active")));
    const results: GenerateSchedulingRoutineIssuesResult[] = [];
    for (const row of rows) {
      results.push(await generateDueIssuesForRoutine(companyId, row.id, options));
    }
    return results;
  }

  return {
    getIssueScheduling,
    upsertIssueScheduling,
    clearIssueScheduling,
    listScheduledIssues,
    listRoutines,
    getRoutine,
    createRoutine,
    updateRoutine,
    deleteRoutine,
    generateDueIssuesForRoutine,
    generateDueIssues,
  };
}
