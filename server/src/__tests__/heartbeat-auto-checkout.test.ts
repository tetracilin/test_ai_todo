import { describe, expect, it } from "vitest";
import { shouldAutoCheckoutIssueForWake } from "../services/heartbeat.ts";

describe("shouldAutoCheckoutIssueForWake", () => {
  it("auto-checks out an assigned todo issue for an actionable wake", () => {
    expect(shouldAutoCheckoutIssueForWake({
      contextSnapshot: { wakeReason: "issue_assigned" },
      issueStatus: "todo",
      issueAssigneeAgentId: "agent-1",
      isDependencyReady: true,
      agentId: "agent-1",
    })).toBe(true);
  });

  it("does not auto-checkout pending execution-review state even if the row status is todo", () => {
    const reviewerAgentId = "11111111-1111-4111-8111-111111111111";
    const coderAgentId = "22222222-2222-4222-8222-222222222222";
    expect(shouldAutoCheckoutIssueForWake({
      contextSnapshot: { wakeReason: "issue_recovery_action_restored" },
      issueStatus: "todo",
      issueAssigneeAgentId: reviewerAgentId,
      issueExecutionState: {
        status: "pending",
        currentStageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        currentStageIndex: 0,
        currentStageType: "review",
        currentParticipant: { type: "agent", agentId: reviewerAgentId },
        returnAssignee: { type: "agent", agentId: coderAgentId },
        reviewRequest: null,
        completedStageIds: [],
        lastDecisionId: null,
        lastDecisionOutcome: null,
      },
      isDependencyReady: true,
      agentId: reviewerAgentId,
    })).toBe(false);
  });

  const baseInput = {
    contextSnapshot: { wakeReason: "issue_assigned" } as Record<string, unknown> | null,
    issueStatus: "todo" as string | null,
    issueAssigneeAgentId: "agent-1" as string | null,
    isDependencyReady: true,
    agentId: "agent-1",
  };

  it.each(["todo", "backlog", "blocked", "in_progress"])(
    "auto-checks out an assigned %s issue",
    (issueStatus) => {
      expect(shouldAutoCheckoutIssueForWake({ ...baseInput, issueStatus })).toBe(true);
    },
  );

  it.each(["done", "cancelled", "in_review", null])(
    "does not auto-checkout an issue in status %s",
    (issueStatus) => {
      expect(shouldAutoCheckoutIssueForWake({ ...baseInput, issueStatus })).toBe(false);
    },
  );

  it("does not auto-checkout when the issue is assigned to a different agent or nobody", () => {
    expect(shouldAutoCheckoutIssueForWake({ ...baseInput, issueAssigneeAgentId: "agent-2" })).toBe(false);
    expect(shouldAutoCheckoutIssueForWake({ ...baseInput, issueAssigneeAgentId: null })).toBe(false);
  });

  it("does not auto-checkout while dependencies are unresolved", () => {
    expect(shouldAutoCheckoutIssueForWake({ ...baseInput, isDependencyReady: false })).toBe(false);
  });

  it.each([
    ["a missing context snapshot", null],
    ["a missing wake reason", {}],
    ["a blank wake reason", { wakeReason: "   " }],
    ["a mention-only wake", { wakeReason: "issue_comment_mentioned" }],
    ["a source-scoped recovery wake", { wakeReason: "source_scoped_recovery_action" }],
    ["an execution_* wake", { wakeReason: "execution_review_requested" }],
  ])("does not auto-checkout for %s", (_label, contextSnapshot) => {
    expect(shouldAutoCheckoutIssueForWake({ ...baseInput, contextSnapshot })).toBe(false);
  });
});
