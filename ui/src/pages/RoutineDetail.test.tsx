import { describe, expect, it } from "vitest";
import { buildRoutineProjectOptions } from "./RoutineDetail";

describe("RoutineDetail project selector options", () => {
  it("excludes archived projects from the editor selector", () => {
    expect(buildRoutineProjectOptions([
      { id: "active-project", name: "Active Project", description: "Visible", archivedAt: null },
      {
        id: "archived-project",
        name: "Archived Project",
        description: "Hidden",
        archivedAt: new Date("2026-04-02T00:00:00.000Z"),
      },
    ])).toEqual([
      { id: "active-project", label: "Active Project", searchText: "Visible" },
    ]);
  });

  it("excludes projects archived with an ISO string and defaults a missing description to empty search text", () => {
    expect(buildRoutineProjectOptions([
      { id: "no-description", name: "No Description" },
      { id: "archived-string", name: "Archived", archivedAt: "2026-04-02T00:00:00.000Z" },
    ])).toEqual([
      { id: "no-description", label: "No Description", searchText: "" },
    ]);
  });
});
