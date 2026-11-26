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
