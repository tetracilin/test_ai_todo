import { and, asc, desc, eq, max } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  scratchNotes,
  storyMapActivities,
  storyMapEpics,
  storyMapReleases,
  storyMapStories,
  storyMapTasks,
  storyMaps,
} from "@paperclipai/db";
import type {
  CreateScratchNote,
  CreateStoryMapActivity,
  CreateStoryMapEpic,
  CreateStoryMapRelease,
  CreateStoryMapStory,
  CreateStoryMapTask,
  ScratchNote,
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
import { forbidden, notFound, unprocessable } from "../errors.js";

const DEFAULT_MAP_NAME = "Story map";

function pickDefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function blankToNull(value: string | null | undefined) {
  if (value === undefined) return undefined;
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
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
      return row!;
    },

    async updateActivity(companyId: string, id: string, input: UpdateStoryMapActivity): Promise<StoryMapActivity> {
      await requireActivity(companyId, id);
      const [row] = await db
        .update(storyMapActivities)
        .set({ ...pickDefined(input), updatedAt: new Date() })
        .where(and(eq(storyMapActivities.companyId, companyId), eq(storyMapActivities.id, id)))
        .returning();
      return row!;
    },

    async deleteActivity(companyId: string, id: string): Promise<StoryMapActivity> {
      await requireActivity(companyId, id);
      const [row] = await db
        .delete(storyMapActivities)
        .where(and(eq(storyMapActivities.companyId, companyId), eq(storyMapActivities.id, id)))
        .returning();
      return row!;
    },

    async createTask(companyId: string, input: CreateStoryMapTask): Promise<StoryMapTask> {
      const activity = await requireActivity(companyId, input.activityId);
      const position = await nextPosition(input.position, storyMapTasks, eq(storyMapTasks.activityId, activity.id));
      const [row] = await db
        .insert(storyMapTasks)
        .values({ companyId, mapId: activity.mapId, activityId: activity.id, name: input.name, position })
        .returning();
      return row!;
    },

    async updateTask(companyId: string, id: string, input: UpdateStoryMapTask): Promise<StoryMapTask> {
      await requireTask(companyId, id);
      const [row] = await db
        .update(storyMapTasks)
        .set({ ...pickDefined(input), updatedAt: new Date() })
        .where(and(eq(storyMapTasks.companyId, companyId), eq(storyMapTasks.id, id)))
        .returning();
      return row!;
    },

    async deleteTask(companyId: string, id: string): Promise<StoryMapTask> {
      await requireTask(companyId, id);
      const [row] = await db
        .delete(storyMapTasks)
        .where(and(eq(storyMapTasks.companyId, companyId), eq(storyMapTasks.id, id)))
        .returning();
      return row!;
    },

    async createRelease(companyId: string, input: CreateStoryMapRelease): Promise<StoryMapRelease> {
      const map = await ensureMap(companyId);
      const position = await nextPosition(input.position, storyMapReleases, eq(storyMapReleases.mapId, map.id));
      const [row] = await db
        .insert(storyMapReleases)
        .values({ companyId, mapId: map.id, name: input.name, targetDate: input.targetDate ?? null, position })
        .returning();
      return row!;
    },

    async updateRelease(companyId: string, id: string, input: UpdateStoryMapRelease): Promise<StoryMapRelease> {
      await requireRelease(companyId, id);
      const [row] = await db
        .update(storyMapReleases)
        .set({ ...pickDefined(input), updatedAt: new Date() })
        .where(and(eq(storyMapReleases.companyId, companyId), eq(storyMapReleases.id, id)))
        .returning();
      return row!;
    },

    /** Stories of a deleted release return to "Unscheduled" (release_id set null by the database). */
    async deleteRelease(companyId: string, id: string): Promise<StoryMapRelease> {
      await requireRelease(companyId, id);
      const [row] = await db
        .delete(storyMapReleases)
        .where(and(eq(storyMapReleases.companyId, companyId), eq(storyMapReleases.id, id)))
        .returning();
      return row!;
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
      return row!;
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
      return row!;
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
      return row!;
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
      return row!;
    },

    async deleteStory(companyId: string, id: string): Promise<StoryMapStory> {
      const [row] = await db
        .delete(storyMapStories)
        .where(and(eq(storyMapStories.companyId, companyId), eq(storyMapStories.id, id)))
        .returning();
      if (!row) throw notFound("Story not found");
      return row;
    },

    async listScratchNotes(companyId: string): Promise<ScratchNote[]> {
      return db
        .select()
        .from(scratchNotes)
        .where(eq(scratchNotes.companyId, companyId))
        .orderBy(desc(scratchNotes.createdAt));
    },

    async createScratchNote(companyId: string, authorUserId: string, input: CreateScratchNote): Promise<ScratchNote> {
      const [row] = await db
        .insert(scratchNotes)
        .values({ companyId, authorUserId, body: input.body })
        .returning();
      return row!;
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
      return row!;
    },

    /** Authors delete only their own notes (AD-106). */
    async deleteScratchNote(companyId: string, id: string, actorUserId: string): Promise<ScratchNote> {
      const note = await requireOwnScratchNote(companyId, id, actorUserId);
      const [row] = await db.delete(scratchNotes).where(eq(scratchNotes.id, note.id)).returning();
      return row!;
    },
  };
}
