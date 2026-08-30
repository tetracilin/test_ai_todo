import { describe, expect, it } from "vitest";
import type { ActivityEvent, IssueComment } from "@paperclipai/shared";
import { mergeTaskActivityFeed } from "./task-activity-feed";

const createdAt = new Date("2026-08-30T12:00:00.000Z");

function comment(overrides: Partial<IssueComment> = {}) {
  return {
    id: "comment-1",
    companyId: "company-1",
    issueId: "issue-1",
    authorType: "user",
    authorAgentId: null,
    authorUserId: "user-1",
    body: "Team note",
    presentation: null,
    metadata: null,
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
    ...overrides,
  } as IssueComment;
}

function activity(overrides: Partial<ActivityEvent> = {}) {
  return {
    id: "event-1",
    companyId: "company-1",
    actorType: "user",
    actorId: "user-1",
    action: "issue.updated",
    entityType: "issue",
    entityId: "issue-1",
    agentId: null,
    runId: null,
    createdAt,
    details: {},
    ...overrides,
  } as ActivityEvent;
}

describe("mergeTaskActivityFeed", () => {
  it("merges chronologically with stable source-key tie breaking", () => {
    const entries = mergeTaskActivityFeed({
      comments: [comment({ id: "comment-later", createdAt: new Date("2026-08-30T12:02:00.000Z") })],
      activity: [
        activity({ id: "event-b", createdAt: new Date("2026-08-30T12:01:00.000Z") }),
        activity({ id: "event-a", createdAt: new Date("2026-08-30T12:01:00.000Z") }),
      ],
    });

    expect(entries.map((entry) => entry.sourceKey)).toEqual([
      "activity:event-a",
      "activity:event-b",
      "comment:comment-later",
    ]);
  });

  it("deduplicates comment receipts and repeated run lifecycle events", () => {
    const entries = mergeTaskActivityFeed({
      comments: [comment()],
      activity: [
        activity({
          id: "comment-receipt",
          action: "issue.comment_added",
          details: { commentId: "comment-1" },
        }),
        activity({
          id: "run-a",
          action: "heartbeat.started",
          runId: "run-1",
        }),
        activity({
          id: "run-b",
          action: "heartbeat.started",
          runId: "run-1",
        }),
      ],
    });

    expect(entries.map((entry) => entry.sourceKey)).toEqual([
      "comment:comment-1",
      "run:run-1:heartbeat.started",
    ]);
  });

  it("omits deleted comments and honors system filtering", () => {
    const entries = mergeTaskActivityFeed({
      comments: [comment({ deletedAt: createdAt })],
      activity: [activity({ action: "issue.updated" })],
      filter: "system",
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "system", label: "Task updated" });
  });
});
