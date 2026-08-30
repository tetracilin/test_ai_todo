import { describe, expect, it } from "vitest";
import { aggregateSubtaskProgress } from "./issue-subtask-progress.js";

describe("aggregateSubtaskProgress", () => {
  it("returns zero progress for no children", () => {
    expect(aggregateSubtaskProgress([])).toEqual({ total: 0, completed: 0, progress: 0 });
  });

  it("averages child progress and counts completed children", () => {
    // 50, 100, 100 -> mean 250/3 = 83 (rounded), completed = 2
    expect(aggregateSubtaskProgress([50, 100, 100])).toEqual({
      total: 3,
      completed: 2,
      progress: 83,
    });
  });

  it("rounds the mean to the nearest integer", () => {
    expect(aggregateSubtaskProgress([1, 2])).toEqual({ total: 2, completed: 0, progress: 2 });
    expect(aggregateSubtaskProgress([2, 3])).toEqual({ total: 2, completed: 0, progress: 3 });
  });

  it("clamps out-of-range progress values to [0, 100]", () => {
    expect(aggregateSubtaskProgress([-10, 150])).toEqual({
      total: 2,
      completed: 1,
      progress: 50,
    });
  });

  it("counts a fully-complete single child as 100%", () => {
    expect(aggregateSubtaskProgress([100])).toEqual({ total: 1, completed: 1, progress: 100 });
  });
});
