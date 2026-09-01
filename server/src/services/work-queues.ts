import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { workQueueItems, workQueues } from "@paperclipai/db";
import type {
  CreateWorkQueue,
  CreateWorkQueueItem,
  PromoteWorkQueueItem,
  WorkQueue,
  WorkQueueItem,
  WorkQueueItemStatus,
} from "@paperclipai/shared";
import { conflict, notFound } from "../errors.js";
import { issueService } from "./issues.js";

/**
 * Minimal actor shape for stamping created-by/promoted-by/dismissed-by columns.
 * Mirrors the `{ agentId, userId }` actor pattern used elsewhere (e.g.
 * agents.ts, approvals.ts) rather than the full getActorInfo() shape, since
 * this service only ever needs the two attribution ids.
 */
export type WorkQueueActor = {
  agentId?: string | null;
  userId?: string | null;
};

/**
 * drizzle-orm's postgres.js driver wraps the raw driver error in a
 * `DrizzleQueryError`, with the actual `PostgresError` (and its `.code`)
 * nested under `.cause` rather than on the top-level error. Walk the cause
 * chain so this matches both that wrapped shape and a bare driver error
 * (e.g. as constructed directly in tests).
 */
function isPostgresError(error: unknown, code: string) {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current != null; depth += 1) {
    if (typeof current === "object" && "code" in current && (current as { code?: unknown }).code === code) {
      return true;
    }
    current = typeof current === "object" ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
}

/** Same normalization approach as folders' normalizeFolderSlug. */
export function normalizeWorkQueueSlug(value: string) {
  const combiningDiacriticals = new RegExp("[\\u0300-\\u036f]", "g");
  const slug = value
    .normalize("NFKD")
    .replace(combiningDiacriticals, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
  return slug || "queue";
}

export function workQueueService(db: Db) {
  async function listQueues(companyId: string): Promise<WorkQueue[]> {
    return db
      .select()
      .from(workQueues)
      .where(eq(workQueues.companyId, companyId))
      .orderBy(asc(workQueues.name), asc(workQueues.createdAt));
  }

  async function getQueue(companyId: string, queueId: string): Promise<WorkQueue | null> {
    return db
      .select()
      .from(workQueues)
      .where(and(eq(workQueues.companyId, companyId), eq(workQueues.id, queueId)))
      .then((rows) => rows[0] ?? null);
  }

  async function assertQueue(companyId: string, queueId: string): Promise<WorkQueue> {
    const queue = await getQueue(companyId, queueId);
    if (!queue) throw notFound("Work queue not found");
    return queue;
  }

  async function createQueue(companyId: string, input: CreateWorkQueue): Promise<WorkQueue> {
    const name = input.name.trim();
    const slug = normalizeWorkQueueSlug(name);
    try {
      return await db
        .insert(workQueues)
        .values({
          companyId,
          name,
          slug,
          description: input.description ?? null,
        })
        .returning()
        .then((rows) => rows[0]!);
    } catch (error) {
      if (isPostgresError(error, "23505")) throw conflict("A queue with this name already exists");
      throw error;
    }
  }

  async function listItems(
    companyId: string,
    queueId: string,
    opts?: { status?: WorkQueueItemStatus },
  ): Promise<WorkQueueItem[]> {
    await assertQueue(companyId, queueId);
    const conditions = [eq(workQueueItems.companyId, companyId), eq(workQueueItems.queueId, queueId)];
    if (opts?.status) conditions.push(eq(workQueueItems.status, opts.status));
    return db
      .select()
      .from(workQueueItems)
      .where(and(...conditions))
      .orderBy(asc(workQueueItems.createdAt));
  }

  async function addItem(
    companyId: string,
    queueId: string,
    input: CreateWorkQueueItem,
    actor: WorkQueueActor = {},
  ): Promise<WorkQueueItem> {
    await assertQueue(companyId, queueId);
    return db
      .insert(workQueueItems)
      .values({
        companyId,
        queueId,
        title: input.title.trim(),
        body: input.body ?? null,
        sourceLabel: input.sourceLabel ?? null,
        status: "open",
        createdByAgentId: actor.agentId ?? null,
        createdByUserId: actor.userId ?? null,
      })
      .returning()
      .then((rows) => rows[0]!);
  }

  async function getItem(companyId: string, itemId: string): Promise<WorkQueueItem | null> {
    return db
      .select()
      .from(workQueueItems)
      .where(and(eq(workQueueItems.companyId, companyId), eq(workQueueItems.id, itemId)))
      .then((rows) => rows[0] ?? null);
  }

  async function assertOpenItem(companyId: string, itemId: string): Promise<WorkQueueItem> {
    const item = await getItem(companyId, itemId);
    if (!item) throw notFound("Work queue item not found");
    if (item.status !== "open") throw conflict("Item already promoted or dismissed");
    return item;
  }

  async function promoteItem(
    companyId: string,
    itemId: string,
    input: PromoteWorkQueueItem,
    actor: WorkQueueActor = {},
  ): Promise<{ item: WorkQueueItem; issue: Awaited<ReturnType<ReturnType<typeof issueService>["create"]>> }> {
    const item = await assertOpenItem(companyId, itemId);
    return db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as Db;
      // Reuses the same internal issue-creation entrypoint routines.ts and
      // onboarding-seed.ts already call, so promote gets all of issues.ts's
      // existing create-time invariants (identifier assignment, activity
      // wiring, etc.) for free rather than re-implementing issue creation.
      const issue = await issueService(tx).create(companyId, {
        title: input.title ?? item.title,
        description: input.description ?? item.body,
        projectId: input.projectId ?? null,
        status: "todo",
        originKind: "work_queue_item",
        originId: item.id,
        createdByAgentId: actor.agentId ?? null,
        createdByUserId: actor.userId ?? null,
      });
      const updated = await tx
        .update(workQueueItems)
        .set({
          status: "promoted",
          promotedIssueId: issue.id,
          promotedAt: new Date(),
          promotedByAgentId: actor.agentId ?? null,
          promotedByUserId: actor.userId ?? null,
          updatedAt: new Date(),
        })
        .where(and(eq(workQueueItems.companyId, companyId), eq(workQueueItems.id, itemId)))
        .returning()
        .then((rows) => rows[0]!);
      return { item: updated, issue };
    });
  }

  async function dismissItem(
    companyId: string,
    itemId: string,
    input: { reason?: string | null },
    actor: WorkQueueActor = {},
  ): Promise<WorkQueueItem> {
    await assertOpenItem(companyId, itemId);
    return db
      .update(workQueueItems)
      .set({
        status: "dismissed",
        dismissedAt: new Date(),
        dismissedByAgentId: actor.agentId ?? null,
        dismissedByUserId: actor.userId ?? null,
        dismissReason: input.reason ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(workQueueItems.companyId, companyId), eq(workQueueItems.id, itemId)))
      .returning()
      .then((rows) => rows[0]!);
  }

  return {
    listQueues,
    getQueue,
    createQueue,
    listItems,
    addItem,
    getItem,
    promoteItem,
    dismissItem,
  };
}
