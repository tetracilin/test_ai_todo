import { describe, expect, it } from "vitest";
import { discordEventTypesForActivity, type LogActivityInput } from "../services/activity-log.js";

const input = (overrides: Partial<LogActivityInput> = {}): LogActivityInput => ({
  companyId: "company-1",
  actorType: "user",
  actorId: "user-1",
  action: "issue.updated",
  entityType: "issue",
  entityId: "issue-1",
  ...overrides,
});

describe("Discord notification event filtering", () => {
  it("emits only supported issue lifecycle events", () => {
    expect(discordEventTypesForActivity(input({
      details: { status: "blocked", assigneeUserId: "user-2", priority: "high" },
    }))).toEqual(["issue.blocked", "issue.assignee_changed", "issue.priority_changed"]);
    expect(discordEventTypesForActivity(input({ entityType: "project" }))).toEqual([]);
  });

  it("emits a personal mention event only when a parsed mention target exists", () => {
    expect(discordEventTypesForActivity(input({
      action: "issue.comment_added",
      details: { mentionedUserIds: ["user-2"] },
    }))).toEqual(["issue.comment_created", "issue.mentioned"]);
    expect(discordEventTypesForActivity(input({
      action: "issue.comment_added",
      details: { mentionedUserIds: [] },
    }))).toEqual(["issue.comment_created"]);
  });
});
