import type { ActivityEvent, IssueComment } from "@paperclipai/shared";

export type TaskActivityFilter = "all" | "comments" | "system" | "agent";

export interface TaskActivityFeedEntry {
  id: string;
  sourceKey: string;
  createdAt: Date | string;
  kind: "comment" | "agent" | "system" | "run";
  label: string;
  detail?: string;
}

function toMs(value: Date | string) {
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringDetail(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function activityLabel(event: ActivityEvent) {
  const details = asRecord(event.details);
  if (event.action === "issue.updated") {
    if (typeof details.status === "string") return `Status changed to ${details.status}`;
    if ("assigneeAgentId" in details || "assigneeUserId" in details) return "Assignee changed";
    if ("priority" in details) return "Priority changed";
    if ("labelIds" in details) return "Tags changed";
    if ("parentId" in details) return "Parent changed";
    return "Task updated";
  }
  if (event.action.startsWith("heartbeat.")) {
    return `Worker ${event.action.slice("heartbeat.".length).replaceAll("_", " ")}`;
  }
  if (event.action.includes("plan")) return "Plan updated";
  if (event.action.includes("artifact")) return "Artifact updated";
  if (event.action.includes("approval")) return "Approval updated";
  return event.action.replaceAll(".", " ").replaceAll("_", " ");
}

export function mergeTaskActivityFeed({
  comments,
  activity,
  filter = "all",
}: {
  comments: readonly IssueComment[];
  activity: readonly ActivityEvent[];
  filter?: TaskActivityFilter;
}): TaskActivityFeedEntry[] {
  const existingCommentIds = new Set(comments.map((comment) => comment.id));
  const seen = new Set<string>();
  const entries: TaskActivityFeedEntry[] = [];
  const add = (entry: TaskActivityFeedEntry) => {
    if (seen.has(entry.sourceKey)) return;
    seen.add(entry.sourceKey);
    entries.push(entry);
  };

  for (const comment of comments) {
    if (comment.deletedAt) continue;
    const kind = comment.authorType === "agent" || comment.authorAgentId ? "agent" : "comment";
    if (filter !== "all" && filter !== kind && !(filter === "comments" && kind === "comment")) continue;
    add({
      id: comment.id,
      sourceKey: `comment:${comment.id}`,
      createdAt: comment.createdAt,
      kind,
      label: comment.body,
    });
  }

  if (filter === "all" || filter === "system") {
    for (const event of activity) {
      const details = asRecord(event.details);
      const commentId = stringDetail(details.commentId);
      if (event.action === "issue.comment_added" && commentId && existingCommentIds.has(commentId)) continue;
      const runState = event.action.startsWith("heartbeat.");
      add({
        id: event.id,
        sourceKey: runState && event.runId ? `run:${event.runId}:${event.action}` : `activity:${event.id}`,
        createdAt: event.createdAt,
        kind: runState ? "run" : "system",
        label: activityLabel(event),
        detail: stringDetail(details.bodySnippet) ?? stringDetail(details.identifier),
      });
    }
  }

  return entries.sort((left, right) =>
    toMs(left.createdAt) - toMs(right.createdAt) || left.sourceKey.localeCompare(right.sourceKey),
  );
}
