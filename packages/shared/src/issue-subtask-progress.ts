import type { IssueSubtaskProgress } from "./types/issue.js";

/**
 * Pure aggregation over a parent's children progress values (0-100 each).
 *
 * - `total`    — number of children.
 * - `completed`— number of children whose progress reached 100.
 * - `progress` — mean of the children's progress, rounded to the nearest
 *                integer and clamped to [0, 100]. Zero when there are no
 *                children.
 */
export function aggregateSubtaskProgress(values: readonly number[]): IssueSubtaskProgress {
  const total = values.length;
  if (total === 0) return { total: 0, completed: 0, progress: 0 };

  const clamped = values.map((value) => Math.min(100, Math.max(0, value)));
  const completed = clamped.filter((value) => value >= 100).length;
  const sum = clamped.reduce((acc, value) => acc + value, 0);
  return { total, completed, progress: Math.round(sum / total) };
}
