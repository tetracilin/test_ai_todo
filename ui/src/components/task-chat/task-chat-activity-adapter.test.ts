import { describe, expect, it } from "vitest";
import type { ActivityEvent } from "@paperclipai/shared";
import { activityToTaskChatItems } from "./task-chat-activity-adapter";

function activity(overrides: Partial<ActivityEvent>): ActivityEvent {
  return {
    id: "evt-1",
    companyId: "company-1",
    actorType: "user",
    actorId: "user-1",
    action: "issue.updated",
    entityType: "issue",
    entityId: "issue-1",
    agentId: null,
    runId: null,
    createdAt: new Date("2026-08-30T12:00:00.000Z"),
    details: { status: "done", _previous: { status: "in_progress" } },
    ...overrides,
  } as ActivityEvent;
}

describe("activityToTaskChatItems", () => {
  it("keeps unique non-comment receipts in stable chronological order", () => {
    const items = activityToTaskChatItems([
      activity({ id: "later", createdAt: new Date("2026-08-30T12:02:00.000Z") }),
      activity({ id: "early", createdAt: new Date("2026-08-30T12:01:00.000Z") }),
      activity({ id: "later", createdAt: new Date("2026-08-30T12:03:00.000Z") }),
    ], { currentUserId: "user-1" });

    expect(items.map((item) => item.id)).toEqual(["activity:early", "activity:later"]);
    expect(items[0]).toMatchObject({ actor: "You", text: "changed the status from in progress to done" });
  });

  it("omits a comment activity receipt when source comment is already in feed", () => {
    const items = activityToTaskChatItems([
      activity({
        action: "issue.comment_added",
        details: { commentId: "comment-1" },
      }),
    ], {}, { commentIds: new Set(["comment-1"]) });

    expect(items).toEqual([]);
  });

  it("omits interaction activity because interaction card is source of truth", () => {
    const items = activityToTaskChatItems([
      activity({
        action: "issue.thread_interaction_accepted",
        details: { interactionId: "interaction-1", interactionKind: "request_confirmation" },
      }),
    ]);

    expect(items).toEqual([]);
  });
});
