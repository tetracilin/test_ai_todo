import { describe, expect, it } from "vitest";
import type { StoryMapStoryStatus, StoryMapTree } from "@paperclipai/shared";
import { FILTER_UNSCHEDULED, buildBacklogTree } from "./storyMapBacklog";

const NOW = new Date("2026-11-26T00:00:00Z");
const base = { companyId: "c", mapId: "m", createdAt: NOW, updatedAt: NOW };
const story = (
  id: string,
  taskId: string,
  epicId: string | null,
  releaseId: string | null,
  status: StoryMapStoryStatus,
  position: number,
) => ({
  ...base,
  id,
  taskId,
  epicId,
  releaseId,
  title: id,
  description: null,
  acceptanceCriteria: null,
  size: null,
  status,
  position,
});

const tree: StoryMapTree = {
  map: null,
  activities: [
    { ...base, id: "a1", name: "Plan work", position: 0 },
    { ...base, id: "a2", name: "Empty activity", position: 1 },
  ],
  tasks: [
    { ...base, id: "t1", activityId: "a1", name: "Create project", position: 0 },
    { ...base, id: "t2", activityId: "a1", name: "Invite team", position: 1 },
  ],
  releases: [{ ...base, id: "r1", name: "Release 1", targetDate: null, position: 0 }],
  epics: [{ ...base, id: "e1", taskId: "t1", name: "Project templates", description: null, position: 0 }],
  stories: [
    story("pick", "t1", "e1", "r1", "planned", 0),
    story("save", "t1", "e1", null, "done", 1),
    story("rename", "t1", null, null, "planned", 2),
    story("invite", "t2", null, "r1", "in_progress", 0),
  ],
};

const none = { release: null, status: null };

describe("buildBacklogTree", () => {
  it("shows activity > task > epic > story in map order, with loose stories under the task", () => {
    const result = buildBacklogTree(tree, none);
    expect(result.activities.map((a) => a.activity.name)).toEqual(["Plan work", "Empty activity"]);
    const [createProject, inviteTeam] = result.activities[0]!.tasks;
    expect(createProject!.epics.map((e) => e.epic.name)).toEqual(["Project templates"]);
    expect(createProject!.epics[0]!.stories.map((s) => s.id)).toEqual(["pick", "save"]);
    expect(createProject!.stories.map((s) => s.id)).toEqual(["rename"]);
    expect(inviteTeam!.stories.map((s) => s.id)).toEqual(["invite"]);
    expect(result.storyCount).toBe(4);
  });

  it("keeps empty branches when no filter is on", () => {
    const result = buildBacklogTree({ ...tree, stories: [] }, none);
    expect(result.activities).toHaveLength(2);
    expect(result.activities[0]!.tasks).toHaveLength(2);
  });

  it("filters by release and prunes branches without a match", () => {
    const result = buildBacklogTree(tree, { release: "r1", status: null });
    const ids = result.activities.flatMap((a) =>
      a.tasks.flatMap((t) => [...t.epics.flatMap((e) => e.stories), ...t.stories].map((s) => s.id)),
    );
    expect(ids.sort()).toEqual(["invite", "pick"]);
    expect(result.activities.map((a) => a.activity.name)).toEqual(["Plan work"]);
    expect(result.storyCount).toBe(2);
  });

  it("filters Unscheduled to the stories in no release", () => {
    const result = buildBacklogTree(tree, { release: FILTER_UNSCHEDULED, status: null });
    expect(result.storyCount).toBe(2);
    expect(result.activities[0]!.tasks).toHaveLength(1);
    expect(result.activities[0]!.tasks[0]!.epics[0]!.stories.map((s) => s.id)).toEqual(["save"]);
    expect(result.activities[0]!.tasks[0]!.stories.map((s) => s.id)).toEqual(["rename"]);
  });

  it("treats a story whose release is gone as Unscheduled", () => {
    const orphaned = { ...tree, stories: [story("lost", "t1", null, "deleted-release", "planned", 0)] };
    expect(buildBacklogTree(orphaned, { release: FILTER_UNSCHEDULED, status: null }).storyCount).toBe(1);
  });

  it("filters by status and combines both filters", () => {
    expect(buildBacklogTree(tree, { release: null, status: "done" }).storyCount).toBe(1);
    expect(buildBacklogTree(tree, { release: "r1", status: "in_progress" }).storyCount).toBe(1);
    expect(buildBacklogTree(tree, { release: "r1", status: "done" }).storyCount).toBe(0);
    expect(buildBacklogTree(tree, { release: "r1", status: "done" }).activities).toEqual([]);
  });
});
