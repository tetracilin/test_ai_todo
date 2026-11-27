import type {
  StoryMapActivity,
  StoryMapEpic,
  StoryMapStory,
  StoryMapStoryStatus,
  StoryMapTask,
  StoryMapTree,
} from "@paperclipai/shared";

/** Filter value for stories that are in no release. */
export const FILTER_UNSCHEDULED = "unscheduled";

export interface BacklogFilters {
  /** A release id, FILTER_UNSCHEDULED, or null for every release. */
  release: string | null;
  /** A status, or null for every status. */
  status: StoryMapStoryStatus | null;
}

export interface BacklogEpicNode {
  epic: StoryMapEpic;
  stories: StoryMapStory[];
}

export interface BacklogTaskNode {
  task: StoryMapTask;
  epics: BacklogEpicNode[];
  /** Stories of the task that are in no epic. */
  stories: StoryMapStory[];
  storyCount: number;
}

export interface BacklogActivityNode {
  activity: StoryMapActivity;
  tasks: BacklogTaskNode[];
  storyCount: number;
}

export interface BacklogTree {
  activities: BacklogActivityNode[];
  storyCount: number;
}

function byPosition<T extends { position: number; createdAt: Date | string }>(a: T, b: T) {
  if (a.position !== b.position) return a.position - b.position;
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

export function storyMatches(story: StoryMapStory, filters: BacklogFilters, knownReleaseIds: Set<string>) {
  if (filters.status && story.status !== filters.status) return false;
  if (filters.release === null) return true;
  const inKnownRelease = story.releaseId !== null && knownReleaseIds.has(story.releaseId);
  if (filters.release === FILTER_UNSCHEDULED) return !inKnownRelease;
  return story.releaseId === filters.release;
}

/**
 * Builds the backlog tree: activity > task > epic > story, each level in map order.
 * With a filter on, branches that hold no matching story are left out. With no filter,
 * empty branches stay so a new map can be read as a whole.
 */
export function buildBacklogTree(tree: StoryMapTree, filters: BacklogFilters): BacklogTree {
  const filtering = filters.release !== null || filters.status !== null;
  const releaseIds = new Set(tree.releases.map((release) => release.id));
  const stories = [...tree.stories].sort(byPosition).filter((story) => storyMatches(story, filters, releaseIds));

  const activities = [...tree.activities].sort(byPosition).map((activity): BacklogActivityNode => {
    const tasks = [...tree.tasks]
      .filter((task) => task.activityId === activity.id)
      .sort(byPosition)
      .map((task): BacklogTaskNode => {
        const taskStories = stories.filter((story) => story.taskId === task.id);
        const epicNodes = [...tree.epics]
          .filter((epic) => epic.taskId === task.id)
          .sort(byPosition)
          .map((epic): BacklogEpicNode => ({
            epic,
            stories: taskStories.filter((story) => story.epicId === epic.id),
          }))
          .filter((node) => !filtering || node.stories.length > 0);
        const epicIds = new Set(tree.epics.filter((epic) => epic.taskId === task.id).map((epic) => epic.id));
        const loose = taskStories.filter((story) => !story.epicId || !epicIds.has(story.epicId));
        return { task, epics: epicNodes, stories: loose, storyCount: taskStories.length };
      })
      .filter((node) => !filtering || node.storyCount > 0);
    return { activity, tasks, storyCount: tasks.reduce((sum, node) => sum + node.storyCount, 0) };
  });

  const kept = filtering ? activities.filter((node) => node.storyCount > 0) : activities;
  return { activities: kept, storyCount: kept.reduce((sum, node) => sum + node.storyCount, 0) };
}

export const STORY_STATUS_LABELS: Record<StoryMapStoryStatus, string> = {
  planned: "Planned",
  in_progress: "In progress",
  done: "Done",
};
