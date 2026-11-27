import type {
  StoryMapActivity,
  StoryMapEpic,
  StoryMapRelease,
  StoryMapStory,
  StoryMapTask,
  StoryMapTree,
} from "@paperclipai/shared";

/** Row key of the stories that sit in no release. */
export const UNSCHEDULED_ROW = "unscheduled";

export interface StoryMapColumn {
  task: StoryMapTask;
  epics: StoryMapEpic[];
}

export interface StoryMapActivityGroup {
  activity: StoryMapActivity;
  columns: StoryMapColumn[];
}

export interface StoryMapRow {
  /** A release id, or UNSCHEDULED_ROW. */
  key: string;
  release: StoryMapRelease | null;
}

export interface StoryMapLayout {
  groups: StoryMapActivityGroup[];
  /** Every task column, left to right, across all activities. */
  columns: StoryMapColumn[];
  /** Release rows in order, then the Unscheduled row. */
  rows: StoryMapRow[];
  /** Stories of one task in one row, top to bottom by priority. */
  storiesAt: (taskId: string, rowKey: string) => StoryMapStory[];
  epicById: (epicId: string | null) => StoryMapEpic | null;
}

function byPosition<T extends { position: number; createdAt: Date | string }>(a: T, b: T) {
  if (a.position !== b.position) return a.position - b.position;
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

/**
 * Turns the flat tree from the API into the grid the page draws: activities
 * and their tasks left to right, release rows top to bottom, and an
 * "Unscheduled" row last. Items whose parent is missing are left out.
 */
export function buildStoryMapLayout(tree: StoryMapTree): StoryMapLayout {
  const tasksByActivity = new Map<string, StoryMapTask[]>();
  for (const task of [...tree.tasks].sort(byPosition)) {
    const list = tasksByActivity.get(task.activityId) ?? [];
    list.push(task);
    tasksByActivity.set(task.activityId, list);
  }
  const epicsByTask = new Map<string, StoryMapEpic[]>();
  for (const epic of [...tree.epics].sort(byPosition)) {
    const list = epicsByTask.get(epic.taskId) ?? [];
    list.push(epic);
    epicsByTask.set(epic.taskId, list);
  }

  const groups: StoryMapActivityGroup[] = [...tree.activities].sort(byPosition).map((activity) => ({
    activity,
    columns: (tasksByActivity.get(activity.id) ?? []).map((task) => ({
      task,
      epics: epicsByTask.get(task.id) ?? [],
    })),
  }));

  const releases = [...tree.releases].sort(byPosition);
  const rows: StoryMapRow[] = [
    ...releases.map((release) => ({ key: release.id, release })),
    { key: UNSCHEDULED_ROW, release: null },
  ];
  const knownReleaseIds = new Set(releases.map((release) => release.id));

  const stories = new Map<string, StoryMapStory[]>();
  for (const story of [...tree.stories].sort(byPosition)) {
    const rowKey = story.releaseId && knownReleaseIds.has(story.releaseId) ? story.releaseId : UNSCHEDULED_ROW;
    const key = `${story.taskId}|${rowKey}`;
    const list = stories.get(key) ?? [];
    list.push(story);
    stories.set(key, list);
  }

  const epics = new Map(tree.epics.map((epic) => [epic.id, epic]));

  return {
    groups,
    columns: groups.flatMap((group) => group.columns),
    rows,
    storiesAt: (taskId, rowKey) => stories.get(`${taskId}|${rowKey}`) ?? [],
    epicById: (epicId) => (epicId ? (epics.get(epicId) ?? null) : null),
  };
}

/** "31 Dec 2026" from a YYYY-MM-DD calendar date, without time zone shifts. */
export function formatReleaseDate(targetDate: string | null): string | null {
  if (!targetDate) return null;
  const [year, month, day] = targetDate.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

// ---------------------------------------------------------------------------
// Moving items: pure helpers for drag and drop and for the Move menu.
// ---------------------------------------------------------------------------

export type MovableKind = "activities" | "tasks" | "epics" | "stories";

export interface MovePlan {
  kind: MovableKind;
  id: string;
  body: { beforeId?: string | null; releaseId?: string | null };
}

/** Keys used as drag and drop ids, for example "story:abc" or "cell:<taskId>|<rowKey>". */
export const dragKey = {
  activity: (id: string) => `activity:${id}`,
  task: (id: string) => `task:${id}`,
  epic: (id: string) => `epic:${id}`,
  story: (id: string) => `story:${id}`,
  cell: (taskId: string, rowKey: string) => `cell:${taskId}|${rowKey}`,
};

/**
 * The sibling to insert before so that `movingId` lands where `targetId` is.
 * Moving forward passes the target (insert after it); moving back inserts before it.
 */
export function beforeIdForDrop(orderedIds: string[], movingId: string, targetId: string): string | null {
  const from = orderedIds.indexOf(movingId);
  const to = orderedIds.indexOf(targetId);
  if (to < 0) return null;
  if (from >= 0 && from < to) return orderedIds[to + 1] ?? null;
  return targetId;
}

/**
 * For the Move menu: the sibling to insert before to step one place earlier or later.
 * Returns undefined when the item is already at that end, so the menu can disable it.
 */
export function beforeIdForStep(
  orderedIds: string[],
  movingId: string,
  direction: "earlier" | "later",
): string | null | undefined {
  const index = orderedIds.indexOf(movingId);
  if (index < 0) return undefined;
  if (direction === "earlier") return index === 0 ? undefined : orderedIds[index - 1];
  if (index === orderedIds.length - 1) return undefined;
  return orderedIds[index + 2] ?? null;
}

function parseKey(key: string): { type: string; id: string } | null {
  const at = key.indexOf(":");
  return at < 0 ? null : { type: key.slice(0, at), id: key.slice(at + 1) };
}

function sortedIds<T extends { id: string; position: number; createdAt: Date | string }>(items: T[]) {
  return [...items].sort(byPosition).map((item) => item.id);
}

/** Sibling ids, in order, of an item that can be moved. Stories are ordered across the whole task. */
export function siblingIds(tree: StoryMapTree, kind: MovableKind, id: string): string[] {
  if (kind === "activities") return sortedIds(tree.activities);
  if (kind === "tasks") {
    const task = tree.tasks.find((t) => t.id === id);
    return task ? sortedIds(tree.tasks.filter((t) => t.activityId === task.activityId)) : [];
  }
  if (kind === "epics") {
    const epic = tree.epics.find((e) => e.id === id);
    return epic ? sortedIds(tree.epics.filter((e) => e.taskId === epic.taskId)) : [];
  }
  const story = tree.stories.find((s) => s.id === id);
  return story ? sortedIds(tree.stories.filter((s) => s.taskId === story.taskId)) : [];
}

/**
 * Turns "dragged X over Y" into the move to save, or null when the drop means nothing
 * (different kinds, different parents, or dropped on itself).
 */
export function resolveDrop(activeKey: string, overKey: string | null, tree: StoryMapTree): MovePlan | null {
  if (!overKey || activeKey === overKey) return null;
  const active = parseKey(activeKey);
  const over = parseKey(overKey);
  if (!active || !over) return null;

  if (active.type === "activity" && over.type === "activity") {
    return { kind: "activities", id: active.id, body: { beforeId: beforeIdForDrop(siblingIds(tree, "activities", active.id), active.id, over.id) } };
  }
  if (active.type === "task" && over.type === "task") {
    const ids = siblingIds(tree, "tasks", active.id);
    if (!ids.includes(over.id)) return null;
    return { kind: "tasks", id: active.id, body: { beforeId: beforeIdForDrop(ids, active.id, over.id) } };
  }
  if (active.type === "epic" && over.type === "epic") {
    const ids = siblingIds(tree, "epics", active.id);
    if (!ids.includes(over.id)) return null;
    return { kind: "epics", id: active.id, body: { beforeId: beforeIdForDrop(ids, active.id, over.id) } };
  }
  if (active.type === "story") {
    const story = tree.stories.find((s) => s.id === active.id);
    if (!story) return null;
    if (over.type === "story") {
      const target = tree.stories.find((s) => s.id === over.id);
      if (!target || target.taskId !== story.taskId) return null;
      const ids = siblingIds(tree, "stories", story.id);
      return {
        kind: "stories",
        id: story.id,
        body: { beforeId: beforeIdForDrop(ids, story.id, target.id), releaseId: target.releaseId ?? null },
      };
    }
    if (over.type === "cell") {
      const [taskId, rowKey] = over.id.split("|");
      if (taskId !== story.taskId) return null;
      return { kind: "stories", id: story.id, body: { releaseId: rowKey === UNSCHEDULED_ROW ? null : rowKey } };
    }
  }
  return null;
}
