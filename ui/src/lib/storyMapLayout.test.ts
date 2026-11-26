import { describe, expect, it } from "vitest";
import type { StoryMapTree } from "@paperclipai/shared";
import { UNSCHEDULED_ROW, buildStoryMapLayout, formatReleaseDate } from "./storyMapLayout";

const NOW = new Date("2026-11-26T00:00:00Z");
const base = { companyId: "c", mapId: "m", createdAt: NOW, updatedAt: NOW };

function tree(partial: Partial<StoryMapTree>): StoryMapTree {
  return { map: null, activities: [], tasks: [], releases: [], epics: [], stories: [], ...partial };
}

describe("buildStoryMapLayout", () => {
  it("orders activities and their tasks left to right by position", () => {
    const layout = buildStoryMapLayout(
      tree({
        activities: [
          { ...base, id: "a2", name: "Second", position: 1 },
          { ...base, id: "a1", name: "First", position: 0 },
        ],
        tasks: [
          { ...base, id: "t2", activityId: "a1", name: "Invite team", position: 1 },
          { ...base, id: "t1", activityId: "a1", name: "Create project", position: 0 },
          { ...base, id: "t3", activityId: "a2", name: "Other", position: 0 },
        ],
      }),
    );
    expect(layout.groups.map((g) => g.activity.name)).toEqual(["First", "Second"]);
    expect(layout.columns.map((c) => c.task.name)).toEqual(["Create project", "Invite team", "Other"]);
  });

  it("always ends with an Unscheduled row after the releases", () => {
    const empty = buildStoryMapLayout(tree({}));
    expect(empty.rows.map((r) => r.key)).toEqual([UNSCHEDULED_ROW]);

    const layout = buildStoryMapLayout(
      tree({
        releases: [
          { ...base, id: "r2", name: "Release 2", targetDate: null, position: 1 },
          { ...base, id: "r1", name: "Release 1", targetDate: "2026-12-31", position: 0 },
        ],
      }),
    );
    expect(layout.rows.map((r) => r.release?.name ?? "Unscheduled")).toEqual(["Release 1", "Release 2", "Unscheduled"]);
  });

  it("puts each story in its task and release cell, top to bottom by priority", () => {
    const layout = buildStoryMapLayout(
      tree({
        activities: [{ ...base, id: "a1", name: "A", position: 0 }],
        tasks: [{ ...base, id: "t1", activityId: "a1", name: "T", position: 0 }],
        releases: [{ ...base, id: "r1", name: "Release 1", targetDate: null, position: 0 }],
        stories: [
          { ...base, id: "s2", taskId: "t1", epicId: null, releaseId: "r1", title: "Save", description: null, acceptanceCriteria: null, size: null, status: "planned", position: 1 },
          { ...base, id: "s1", taskId: "t1", epicId: null, releaseId: "r1", title: "Pick", description: null, acceptanceCriteria: null, size: null, status: "planned", position: 0 },
          { ...base, id: "s3", taskId: "t1", epicId: null, releaseId: null, title: "Later", description: null, acceptanceCriteria: null, size: null, status: "planned", position: 0 },
        ],
      }),
    );
    expect(layout.storiesAt("t1", "r1").map((s) => s.title)).toEqual(["Pick", "Save"]);
    expect(layout.storiesAt("t1", UNSCHEDULED_ROW).map((s) => s.title)).toEqual(["Later"]);
  });

  it("shows a story with an unknown release as Unscheduled instead of hiding it", () => {
    const layout = buildStoryMapLayout(
      tree({
        tasks: [{ ...base, id: "t1", activityId: "a1", name: "T", position: 0 }],
        stories: [
          { ...base, id: "s1", taskId: "t1", epicId: null, releaseId: "gone", title: "Lost", description: null, acceptanceCriteria: null, size: null, status: "planned", position: 0 },
        ],
      }),
    );
    expect(layout.storiesAt("t1", UNSCHEDULED_ROW)).toHaveLength(1);
  });

  it("looks up epics by id and returns null for none", () => {
    const layout = buildStoryMapLayout(
      tree({ epics: [{ ...base, id: "e1", taskId: "t1", name: "Templates", description: null, position: 0 }] }),
    );
    expect(layout.epicById("e1")?.name).toBe("Templates");
    expect(layout.epicById(null)).toBeNull();
    expect(layout.epicById("missing")).toBeNull();
  });
});

describe("formatReleaseDate", () => {
  it("formats a calendar date without shifting the day", () => {
    expect(formatReleaseDate("2026-12-31")).toBe("31 Dec 2026");
    expect(formatReleaseDate("2026-01-01")).toBe("1 Jan 2026");
  });

  it("returns null for no date or a bad one", () => {
    expect(formatReleaseDate(null)).toBeNull();
    expect(formatReleaseDate("soon")).toBeNull();
  });
});

describe("moving items", () => {
  it("drops forward after the target and backward before it", async () => {
    const { beforeIdForDrop } = await import("./storyMapLayout");
    const ids = ["a", "b", "c", "d"];
    // Drag a over c: a ends up right after c, so it goes before d.
    expect(beforeIdForDrop(ids, "a", "c")).toBe("d");
    // Drag d over b: d goes before b.
    expect(beforeIdForDrop(ids, "d", "b")).toBe("b");
    // Drag a over the last item: a goes to the end.
    expect(beforeIdForDrop(ids, "a", "d")).toBeNull();
    // Unknown target: no sensible place, so the end.
    expect(beforeIdForDrop(ids, "a", "zzz")).toBeNull();
  });

  it("steps one place for the Move menu and reports the ends", async () => {
    const { beforeIdForStep } = await import("./storyMapLayout");
    const ids = ["a", "b", "c"];
    expect(beforeIdForStep(ids, "b", "earlier")).toBe("a");
    expect(beforeIdForStep(ids, "a", "earlier")).toBeUndefined();
    expect(beforeIdForStep(ids, "a", "later")).toBe("c");
    expect(beforeIdForStep(ids, "b", "later")).toBeNull();
    expect(beforeIdForStep(ids, "c", "later")).toBeUndefined();
    expect(beforeIdForStep(ids, "missing", "later")).toBeUndefined();
  });

  const story = (id: string, taskId: string, releaseId: string | null, position: number) => ({
    ...base,
    id,
    taskId,
    epicId: null,
    releaseId,
    title: id,
    description: null,
    acceptanceCriteria: null,
    size: null,
    status: "planned" as const,
    position,
  });
  const movable = tree({
    activities: [
      { ...base, id: "a1", name: "A1", position: 0 },
      { ...base, id: "a2", name: "A2", position: 1 },
    ],
    tasks: [
      { ...base, id: "t1", activityId: "a1", name: "T1", position: 0 },
      { ...base, id: "t2", activityId: "a1", name: "T2", position: 1 },
      { ...base, id: "t3", activityId: "a2", name: "T3", position: 0 },
    ],
    epics: [
      { ...base, id: "e1", taskId: "t1", name: "E1", description: null, position: 0 },
      { ...base, id: "e2", taskId: "t1", name: "E2", description: null, position: 1 },
    ],
    stories: [story("s1", "t1", "r1", 0), story("s2", "t1", null, 1), story("s3", "t2", null, 0)],
  });

  it("turns a drop into a move for activities, tasks and epics within the same parent", async () => {
    const { resolveDrop } = await import("./storyMapLayout");
    expect(resolveDrop("activity:a2", "activity:a1", movable)).toEqual({
      kind: "activities",
      id: "a2",
      body: { beforeId: "a1" },
    });
    expect(resolveDrop("task:t1", "task:t2", movable)).toEqual({ kind: "tasks", id: "t1", body: { beforeId: null } });
    expect(resolveDrop("epic:e1", "epic:e2", movable)).toEqual({ kind: "epics", id: "e1", body: { beforeId: null } });
  });

  it("ignores drops onto itself, another kind or another parent", async () => {
    const { resolveDrop } = await import("./storyMapLayout");
    expect(resolveDrop("task:t1", "task:t1", movable)).toBeNull();
    expect(resolveDrop("task:t1", null, movable)).toBeNull();
    expect(resolveDrop("task:t1", "activity:a1", movable)).toBeNull();
    expect(resolveDrop("task:t1", "task:t3", movable)).toBeNull();
    expect(resolveDrop("story:s1", "story:s3", movable)).toBeNull();
    expect(resolveDrop("story:s1", "cell:t2|r1", movable)).toBeNull();
    expect(resolveDrop("story:missing", "story:s1", movable)).toBeNull();
  });

  it("moves a story onto another story and adopts that story's release", async () => {
    const { resolveDrop } = await import("./storyMapLayout");
    // s1 (Release r1) dropped on s2 (Unscheduled): lands after it, now Unscheduled.
    expect(resolveDrop("story:s1", "story:s2", movable)).toEqual({
      kind: "stories",
      id: "s1",
      body: { beforeId: null, releaseId: null },
    });
  });

  it("moves a story onto an empty cell of its own task: a release, or Unscheduled", async () => {
    const { resolveDrop, dragKey } = await import("./storyMapLayout");
    expect(resolveDrop("story:s2", dragKey.cell("t1", "r1"), movable)).toEqual({
      kind: "stories",
      id: "s2",
      body: { releaseId: "r1" },
    });
    expect(resolveDrop("story:s1", dragKey.cell("t1", UNSCHEDULED_ROW), movable)).toEqual({
      kind: "stories",
      id: "s1",
      body: { releaseId: null },
    });
  });
});
