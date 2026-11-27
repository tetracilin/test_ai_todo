import { and, asc, desc, eq, max, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  authUsers,
  scratchNotes,
  storyMapActivities,
  storyMapEpics,
  storyMapReleases,
  storyMapStories,
  storyMapTasks,
  storyMaps,
} from "@paperclipai/db";
import {
  PROMOTED_NOTES_ACTIVITY,
  PROMOTED_NOTES_TASK,
  type CreateScratchNote,
  CreateStoryMapActivity,
  CreateStoryMapEpic,
  CreateStoryMapRelease,
  CreateStoryMapStory,
  CreateStoryMapTask,
  MoveStoryMapStory,
  PromoteScratchNoteResult,
  ScratchNote,
  ScratchNoteView,
  StoryMap,
  StoryMapActivity,
  StoryMapEpic,
  StoryMapRelease,
  StoryMapStory,
  StoryMapTask,
  StoryMapTree,
  UpdateScratchNote,
  UpdateStoryMapActivity,
  UpdateStoryMapEpic,
  UpdateStoryMapRelease,
  UpdateStoryMapStory,
  UpdateStoryMapTask,
} from "@paperclipai/shared";
import { conflict, forbidden, notFound, unprocessable } from "../errors.js";

const DEFAULT_MAP_NAME = "Story map";

function pickDefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** A row can vanish between the existence check and the write; that is a 404, not a 500. */
function required<T>(row: T | undefined, message: string): T {
  if (!row) throw notFound(message);
  return row;
}

function blankToNull(value: string | null | undefined) {
  if (value === undefined) return undefined;
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export type MovableStoryMapKind = "activities" | "tasks" | "releases" | "epics" | "stories";

/**
 * Places `id` among `ids`: before `beforeId`, or at `endIndex` (default: the end) when no
 * target is given. Returns the new order. The target must be one of the siblings.
 */
export function planStoryMapOrder(ids: string[], id: string, beforeId: string | null | undefined, endIndex?: number) {
  const rest = ids.filter((other) => other !== id);
  if (beforeId) {
    const index = rest.indexOf(beforeId);
    if (index < 0) throw unprocessable("The target is not a sibling of the moved item");
    rest.splice(index, 0, id);
  } else {
    rest.splice(endIndex ?? rest.length, 0, id);
  }
  return rest;
}

export function storyMapService(db: Db) {
  async function findMap(companyId: string): Promise<StoryMap | null> {
    const [row] = await db.select().from(storyMaps).where(eq(storyMaps.companyId, companyId)).limit(1);
    return row ?? null;
  }

  /** One map per company. Created on the first write; concurrent callers converge on one row. */
  async function ensureMap(companyId: string): Promise<StoryMap> {
    const existing = await findMap(companyId);
    if (existing) return existing;
    await db
      .insert(storyMaps)
      .values({ companyId, name: DEFAULT_MAP_NAME })
      .onConflictDoNothing({ target: storyMaps.companyId });
    const created = await findMap(companyId);
    if (!created) throw unprocessable("Story map could not be created");
    return created;
  }

  async function requireActivity(companyId: string, activityId: string) {
    const [row] = await db
      .select()
      .from(storyMapActivities)
      .where(and(eq(storyMapActivities.companyId, companyId), eq(storyMapActivities.id, activityId)))
      .limit(1);
    if (!row) throw notFound("Activity not found");
    return row;
  }

  async function requireTask(companyId: string, taskId: string) {
    const [row] = await db
      .select()
      .from(storyMapTasks)
      .where(and(eq(storyMapTasks.companyId, companyId), eq(storyMapTasks.id, taskId)))
      .limit(1);
    if (!row) throw notFound("Task not found");
    return row;
  }

  async function requireRelease(companyId: string, releaseId: string) {
    const [row] = await db
      .select()
      .from(storyMapReleases)
      .where(and(eq(storyMapReleases.companyId, companyId), eq(storyMapReleases.id, releaseId)))
      .limit(1);
    if (!row) throw notFound("Release not found");
    return row;
  }

  async function requireEpicOfTask(companyId: string, epicId: string, taskId: string) {
    const [row] = await db
      .select()
      .from(storyMapEpics)
      .where(and(eq(storyMapEpics.companyId, companyId), eq(storyMapEpics.id, epicId)))
      .limit(1);
    if (!row) throw notFound("Epic not found");
    if (row.taskId !== taskId) throw unprocessable("Epic belongs to a different task");
    return row;
  }

  type Positioned =
    | typeof storyMapActivities
    | typeof storyMapTasks
    | typeof storyMapReleases
    | typeof storyMapEpics
    | typeof storyMapStories;

  /** Appends after the last sibling unless the caller gave an explicit position. */
  async function nextPosition(requested: number | null | undefined, from: Positioned, where: ReturnType<typeof eq>) {
    if (typeof requested === "number") return requested;
    const [row] = await db.select({ value: max(from.position) }).from(from).where(where);
    return row?.value == null ? 0 : row.value + 1;
  }

  async function requireOwnScratchNote(companyId: string, id: string, actorUserId: string) {
    const [note] = await db
      .select()
      .from(scratchNotes)
      .where(and(eq(scratchNotes.companyId, companyId), eq(scratchNotes.id, id)))
      .limit(1);
    if (!note) throw notFound("Note not found");
    if (note.authorUserId !== actorUserId) throw forbidden("Only the author can change this note");
    return note;
  }

  return {
    /** Used inside a transaction by promotion. Same as the private ensureMap. */
    ensureMapForWrite: (companyId: string) => ensureMap(companyId),

    async getTree(companyId: string): Promise<StoryMapTree> {
      const map = await findMap(companyId);
      if (!map) {
        return { map: null, activities: [], tasks: [], releases: [], epics: [], stories: [] };
      }
      const [activities, tasks, releases, epics, stories] = await Promise.all([
        db.select().from(storyMapActivities).where(eq(storyMapActivities.mapId, map.id))
          .orderBy(asc(storyMapActivities.position), asc(storyMapActivities.createdAt)),
        db.select().from(storyMapTasks).where(eq(storyMapTasks.mapId, map.id))
          .orderBy(asc(storyMapTasks.position), asc(storyMapTasks.createdAt)),
        db.select().from(storyMapReleases).where(eq(storyMapReleases.mapId, map.id))
          .orderBy(asc(storyMapReleases.position), asc(storyMapReleases.createdAt)),
        db.select().from(storyMapEpics).where(eq(storyMapEpics.mapId, map.id))
          .orderBy(asc(storyMapEpics.position), asc(storyMapEpics.createdAt)),
        db.select().from(storyMapStories).where(eq(storyMapStories.mapId, map.id))
          .orderBy(asc(storyMapStories.position), asc(storyMapStories.createdAt)),
      ]);
      return { map, activities, tasks, releases, epics, stories };
    },

    async createActivity(companyId: string, input: CreateStoryMapActivity): Promise<StoryMapActivity> {
      const map = await ensureMap(companyId);
      const position = await nextPosition(input.position, storyMapActivities, eq(storyMapActivities.mapId, map.id));
      const [row] = await db
        .insert(storyMapActivities)
        .values({ companyId, mapId: map.id, name: input.name, position })
        .returning();
      return required(row, "Item not found");
    },

    async updateActivity(companyId: string, id: string, input: UpdateStoryMapActivity): Promise<StoryMapActivity> {
      await requireActivity(companyId, id);
      const [row] = await db
        .update(storyMapActivities)
        .set({ ...pickDefined(input), updatedAt: new Date() })
        .where(and(eq(storyMapActivities.companyId, companyId), eq(storyMapActivities.id, id)))
        .returning();
      return required(row, "Item not found");
    },

    async deleteActivity(companyId: string, id: string): Promise<StoryMapActivity> {
      await requireActivity(companyId, id);
      const [row] = await db
        .delete(storyMapActivities)
        .where(and(eq(storyMapActivities.companyId, companyId), eq(storyMapActivities.id, id)))
        .returning();
      return required(row, "Item not found");
    },

    async createTask(companyId: string, input: CreateStoryMapTask): Promise<StoryMapTask> {
      const activity = await requireActivity(companyId, input.activityId);
      const position = await nextPosition(input.position, storyMapTasks, eq(storyMapTasks.activityId, activity.id));
      const [row] = await db
        .insert(storyMapTasks)
        .values({ companyId, mapId: activity.mapId, activityId: activity.id, name: input.name, position })
        .returning();
      return required(row, "Item not found");
    },

    async updateTask(companyId: string, id: string, input: UpdateStoryMapTask): Promise<StoryMapTask> {
      await requireTask(companyId, id);
      const [row] = await db
        .update(storyMapTasks)
        .set({ ...pickDefined(input), updatedAt: new Date() })
        .where(and(eq(storyMapTasks.companyId, companyId), eq(storyMapTasks.id, id)))
        .returning();
      return required(row, "Item not found");
    },

    async deleteTask(companyId: string, id: string): Promise<StoryMapTask> {
      await requireTask(companyId, id);
      const [row] = await db
        .delete(storyMapTasks)
        .where(and(eq(storyMapTasks.companyId, companyId), eq(storyMapTasks.id, id)))
        .returning();
      return required(row, "Item not found");
    },

    async createRelease(companyId: string, input: CreateStoryMapRelease): Promise<StoryMapRelease> {
      const map = await ensureMap(companyId);
      const position = await nextPosition(input.position, storyMapReleases, eq(storyMapReleases.mapId, map.id));
      const [row] = await db
        .insert(storyMapReleases)
        .values({ companyId, mapId: map.id, name: input.name, targetDate: input.targetDate ?? null, position })
        .returning();
      return required(row, "Item not found");
    },

    async updateRelease(companyId: string, id: string, input: UpdateStoryMapRelease): Promise<StoryMapRelease> {
      await requireRelease(companyId, id);
      const [row] = await db
        .update(storyMapReleases)
        .set({ ...pickDefined(input), updatedAt: new Date() })
        .where(and(eq(storyMapReleases.companyId, companyId), eq(storyMapReleases.id, id)))
        .returning();
      return required(row, "Item not found");
    },

    /** Stories of a deleted release return to "Unscheduled" (release_id set null by the database). */
    async deleteRelease(companyId: string, id: string): Promise<StoryMapRelease> {
      await requireRelease(companyId, id);
      const [row] = await db
        .delete(storyMapReleases)
        .where(and(eq(storyMapReleases.companyId, companyId), eq(storyMapReleases.id, id)))
        .returning();
      return required(row, "Item not found");
    },

    async createEpic(companyId: string, input: CreateStoryMapEpic): Promise<StoryMapEpic> {
      const task = await requireTask(companyId, input.taskId);
      const position = await nextPosition(input.position, storyMapEpics, eq(storyMapEpics.taskId, task.id));
      const [row] = await db
        .insert(storyMapEpics)
        .values({
          companyId,
          mapId: task.mapId,
          taskId: task.id,
          name: input.name,
          description: blankToNull(input.description) ?? null,
          position,
        })
        .returning();
      return required(row, "Item not found");
    },

    async updateEpic(companyId: string, id: string, input: UpdateStoryMapEpic): Promise<StoryMapEpic> {
      const [existing] = await db
        .select()
        .from(storyMapEpics)
        .where(and(eq(storyMapEpics.companyId, companyId), eq(storyMapEpics.id, id)))
        .limit(1);
      if (!existing) throw notFound("Epic not found");
      const patch = pickDefined({ ...input, description: blankToNull(input.description) });
      const [row] = await db
        .update(storyMapEpics)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(storyMapEpics.companyId, companyId), eq(storyMapEpics.id, id)))
        .returning();
      return required(row, "Item not found");
    },

    /** Stories of a deleted epic stay under their task (epic_id set null by the database). */
    async deleteEpic(companyId: string, id: string): Promise<StoryMapEpic> {
      const [row] = await db
        .delete(storyMapEpics)
        .where(and(eq(storyMapEpics.companyId, companyId), eq(storyMapEpics.id, id)))
        .returning();
      if (!row) throw notFound("Epic not found");
      return row;
    },

    async createStory(companyId: string, input: CreateStoryMapStory): Promise<StoryMapStory> {
      const task = await requireTask(companyId, input.taskId);
      if (input.epicId) await requireEpicOfTask(companyId, input.epicId, task.id);
      if (input.releaseId) await requireRelease(companyId, input.releaseId);
      const position = await nextPosition(input.position, storyMapStories, eq(storyMapStories.taskId, task.id));
      const [row] = await db
        .insert(storyMapStories)
        .values({
          companyId,
          mapId: task.mapId,
          taskId: task.id,
          epicId: input.epicId ?? null,
          releaseId: input.releaseId ?? null,
          title: input.title,
          description: blankToNull(input.description) ?? null,
          acceptanceCriteria: blankToNull(input.acceptanceCriteria) ?? null,
          size: blankToNull(input.size) ?? null,
          status: input.status ?? "planned",
          position,
        })
        .returning();
      return required(row, "Item not found");
    },

    async updateStory(companyId: string, id: string, input: UpdateStoryMapStory): Promise<StoryMapStory> {
      const [existing] = await db
        .select()
        .from(storyMapStories)
        .where(and(eq(storyMapStories.companyId, companyId), eq(storyMapStories.id, id)))
        .limit(1);
      if (!existing) throw notFound("Story not found");
      if (input.epicId) await requireEpicOfTask(companyId, input.epicId, existing.taskId);
      if (input.releaseId) await requireRelease(companyId, input.releaseId);
      const patch = pickDefined({
        ...input,
        description: blankToNull(input.description),
        acceptanceCriteria: blankToNull(input.acceptanceCriteria),
        size: blankToNull(input.size),
      });
      const [row] = await db
        .update(storyMapStories)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(storyMapStories.companyId, companyId), eq(storyMapStories.id, id)))
        .returning();
      return required(row, "Item not found");
    },

    async deleteStory(companyId: string, id: string): Promise<StoryMapStory> {
      const [row] = await db
        .delete(storyMapStories)
        .where(and(eq(storyMapStories.companyId, companyId), eq(storyMapStories.id, id)))
        .returning();
      if (!row) throw notFound("Story not found");
      return row;
    },

    /**
     * Moves an item among its siblings and renumbers them in one transaction, so the order
     * is saved as a whole. A story may also change release in the same step.
     */
    async moveItem(
      companyId: string,
      kind: MovableStoryMapKind,
      id: string,
      input: MoveStoryMapStory,
    ): Promise<StoryMapActivity | StoryMapTask | StoryMapRelease | StoryMapEpic | StoryMapStory> {
      if (input.beforeId === id) throw unprocessable("An item cannot be moved before itself");
      if (kind !== "stories" && input.releaseId !== undefined) {
        throw unprocessable("Only a story can change release");
      }
      if (input.releaseId) await requireRelease(companyId, input.releaseId);

      return db.transaction(async (tx) => {
        // The tables share id, company, position and timestamps, so one table type stands for all.
        const table = {
          activities: storyMapActivities,
          tasks: storyMapTasks,
          releases: storyMapReleases,
          epics: storyMapEpics,
          stories: storyMapStories,
        }[kind] as typeof storyMapActivities;

        const [item] = await tx
          .select()
          .from(table)
          .where(and(eq(table.companyId, companyId), eq(table.id, id)))
          .limit(1);
        if (!item) throw notFound("Item not found");

        const scope =
          kind === "activities" || kind === "releases"
            ? eq(table.mapId, item.mapId)
            : kind === "tasks"
              ? eq(storyMapTasks.activityId, (item as unknown as StoryMapTask).activityId)
              : eq(
                  (kind === "epics" ? storyMapEpics : storyMapStories).taskId,
                  (item as unknown as StoryMapEpic | StoryMapStory).taskId,
                );
        const siblings = (await tx
          .select()
          .from(table)
          .where(and(eq(table.companyId, companyId), scope))
          .orderBy(asc(table.position), asc(table.createdAt))
          // Lock the siblings so a second move waits and then reads the order the first one saved.
          .for("update")) as unknown as Array<{
          id: string;
          position: number;
          releaseId?: string | null;
        }>;

        const releaseChange = kind === "stories" && input.releaseId !== undefined;
        let endIndex: number | undefined;
        if (releaseChange && !input.beforeId) {
          // Dropped on a cell without a target: go after the last story already in that release.
          const rest = siblings.filter((other) => other.id !== id);
          const lastInRelease = rest.map((other) => (other.releaseId ?? null) === (input.releaseId ?? null)).lastIndexOf(true);
          endIndex = lastInRelease < 0 ? rest.length : lastInRelease + 1;
        }
        const order = planStoryMapOrder(siblings.map((s) => s.id), id, input.beforeId, endIndex);

        const positions = new Map(siblings.map((s) => [s.id, s.position]));
        const now = new Date();
        for (const [index, siblingId] of order.entries()) {
          const changesRelease = releaseChange && siblingId === id;
          if (positions.get(siblingId) === index && !changesRelease) continue;
          await tx
            .update(table)
            .set({
              position: index,
              updatedAt: now,
              ...(changesRelease ? ({ releaseId: input.releaseId ?? null } as Record<string, unknown>) : {}),
            })
            .where(and(eq(table.companyId, companyId), eq(table.id, siblingId)));
        }

        const [moved] = await tx
          .select()
          .from(table)
          .where(and(eq(table.companyId, companyId), eq(table.id, id)))
          .limit(1);
        return required(moved, "Item not found") as unknown as StoryMapStory;
      });
    },

    async listScratchNotes(companyId: string): Promise<ScratchNoteView[]> {
      const rows = await db
        .select({ note: scratchNotes, authorName: authUsers.name })
        .from(scratchNotes)
        .leftJoin(authUsers, eq(authUsers.id, scratchNotes.authorUserId))
        .where(eq(scratchNotes.companyId, companyId))
        .orderBy(desc(scratchNotes.createdAt));
      return rows.map((row) => ({ ...row.note, authorName: row.authorName ?? null }));
    },

    /**
     * Turns an active note into a story in the Unscheduled row. The story goes under a fixed
     * activity and task for promoted ideas, created on first use, so no task has to be chosen.
     */
    async promoteScratchNote(companyId: string, id: string): Promise<PromoteScratchNoteResult> {
      return db.transaction(async (tx) => {
        // Lock the note so a double click or a second admin waits, then sees it is no longer active.
        const [note] = await tx
          .select()
          .from(scratchNotes)
          .where(and(eq(scratchNotes.companyId, companyId), eq(scratchNotes.id, id)))
          .limit(1)
          .for("update");
        if (!note) throw notFound("Note not found");
        if (note.status !== "active") throw conflict("Only an active note can be promoted");

        // Serialize the first-use creation of the idea column for this company.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`story-map-promote:${companyId}`}))`);

        const inner = storyMapService(tx as unknown as Db);
        const map = await inner.ensureMapForWrite(companyId);
        const createdParents: PromoteScratchNoteResult["createdParents"] = { activity: null, task: null };

        let [activity] = await tx
          .select()
          .from(storyMapActivities)
          .where(and(eq(storyMapActivities.mapId, map.id), eq(storyMapActivities.name, PROMOTED_NOTES_ACTIVITY)))
          .limit(1);
        if (!activity) {
          activity = await inner.createActivity(companyId, { name: PROMOTED_NOTES_ACTIVITY });
          createdParents.activity = activity;
        }
        let [task] = await tx
          .select()
          .from(storyMapTasks)
          .where(and(eq(storyMapTasks.activityId, activity.id), eq(storyMapTasks.name, PROMOTED_NOTES_TASK)))
          .limit(1);
        if (!task) {
          task = await inner.createTask(companyId, { activityId: activity.id, name: PROMOTED_NOTES_TASK });
          createdParents.task = task;
        }

        const firstLine = note.body.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? note.body.trim();
        const title = firstLine.length > 200 ? `${firstLine.slice(0, 197)}...` : firstLine;
        const story = await inner.createStory(companyId, {
          taskId: task.id,
          title,
          description: note.body.trim() === title ? null : note.body.trim(),
        });
        const [updated] = await tx
          .update(scratchNotes)
          .set({ status: "promoted", promotedStoryId: story.id, updatedAt: new Date() })
          .where(and(eq(scratchNotes.id, note.id), eq(scratchNotes.status, "active")))
          .returning();
        return { note: required(updated, "Note not found"), story, createdParents };
      });
    },

    async archiveScratchNote(companyId: string, id: string): Promise<ScratchNote> {
      return db.transaction(async (tx) => {
        // Lock the note so a concurrent promote waits, then reads the status this archive saved.
        const [note] = await tx
          .select()
          .from(scratchNotes)
          .where(and(eq(scratchNotes.companyId, companyId), eq(scratchNotes.id, id)))
          .limit(1)
          .for("update");
        if (!note) throw notFound("Note not found");
        if (note.status === "archived") return note;
        if (note.status === "promoted") throw conflict("A promoted note cannot be archived");
        // The status condition keeps the write safe if the row ever becomes writable mid-step.
        const [updated] = await tx
          .update(scratchNotes)
          .set({ status: "archived", updatedAt: new Date() })
          .where(and(eq(scratchNotes.id, note.id), eq(scratchNotes.status, "active")))
          .returning();
        if (!updated) throw conflict("Only an active note can be archived");
        return updated;
      });
    },

    async createScratchNote(companyId: string, authorUserId: string, input: CreateScratchNote): Promise<ScratchNote> {
      const [row] = await db
        .insert(scratchNotes)
        .values({ companyId, authorUserId, body: input.body })
        .returning();
      return required(row, "Item not found");
    },

    /** Authors edit only their own notes (AD-106). */
    async updateScratchNote(
      companyId: string,
      id: string,
      actorUserId: string,
      input: UpdateScratchNote,
    ): Promise<ScratchNote> {
      const note = await requireOwnScratchNote(companyId, id, actorUserId);
      const [row] = await db
        .update(scratchNotes)
        .set({ body: input.body, updatedAt: new Date() })
        .where(eq(scratchNotes.id, note.id))
        .returning();
      return required(row, "Item not found");
    },

    /** Authors delete only their own notes (AD-106). */
    async deleteScratchNote(companyId: string, id: string, actorUserId: string): Promise<ScratchNote> {
      const note = await requireOwnScratchNote(companyId, id, actorUserId);
      const [row] = await db.delete(scratchNotes).where(eq(scratchNotes.id, note.id)).returning();
      return required(row, "Item not found");
    },
  };
}
