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
