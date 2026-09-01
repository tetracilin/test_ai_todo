import type { ActivityEvent, Agent } from "@paperclipai/shared";
import { formatIssueActivityAction } from "@/lib/activity-format";
import type { CompanyUserProfile } from "@/lib/company-members";
import type { TaskChatActivityItem } from "./task-chat-model";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function commentIdForActivity(event: ActivityEvent) {
  const details = asRecord(event.details);
  return typeof details?.commentId === "string" ? details.commentId : null;
}

function interactionIdForActivity(event: ActivityEvent) {
  const details = asRecord(event.details);
  return typeof details?.interactionId === "string" ? details.interactionId : null;
}

function actorLabel(event: ActivityEvent, context: TaskChatActivityAdapterContext) {
  if (event.actorType === "system") return "System";
  if (event.actorType === "agent") return context.agentMap?.get(event.actorId)?.name ?? "Agent";
  if (event.actorId === context.currentUserId || event.actorId === "local-board") return "You";
  return context.userLabelMap?.get(event.actorId) ?? "Board user";
}

export interface TaskChatActivityAdapterContext {
  agentMap?: Map<string, Agent>;
  userLabelMap?: ReadonlyMap<string, string> | null;
  userProfileMap?: Map<string, CompanyUserProfile>;
  currentUserId?: string | null;
}

/**
 * Activity records are source events, not a second comment stream. Comments and
 * interaction cards already render their own source records, so their matching
 * activity receipts are deliberately omitted. Every remaining event keeps its
 * event ID and timestamp for stable chronological merging with the thread.
 */
export function activityToTaskChatItems(
  activity: readonly ActivityEvent[] | null | undefined,
  context: TaskChatActivityAdapterContext = {},
  renderedSourceIds: { commentIds?: ReadonlySet<string>; interactionIds?: ReadonlySet<string> } = {},
): TaskChatActivityItem[] {
  const seen = new Set<string>();
  const items: TaskChatActivityItem[] = [];
  for (const event of activity ?? []) {
    if (!event.id || seen.has(event.id)) continue;
    seen.add(event.id);

    const commentId = commentIdForActivity(event);
    if (commentId && renderedSourceIds.commentIds?.has(commentId)) continue;
    const interactionId = interactionIdForActivity(event);
    if (interactionId && renderedSourceIds.interactionIds?.has(interactionId)) continue;
    // Interaction cards carry their request and resolution state, so their audit
    // receipts would otherwise create a second row for the same source record.
    if (event.action.startsWith("issue.thread_interaction_")) continue;

    items.push({
      id: `activity:${event.id}`,
      kind: "activity",
      actor: actorLabel(event, context),
      text: formatIssueActivityAction(event.action, event.details, {
        agentMap: context.agentMap,
        userProfileMap: context.userProfileMap,
        currentUserId: context.currentUserId,
      }),
      createdAtIso: event.createdAt instanceof Date ? event.createdAt.toISOString() : String(event.createdAt),
    });
  }

  return items.sort((left, right) => {
    const timestamp = new Date(left.createdAtIso).getTime() - new Date(right.createdAtIso).getTime();
    return timestamp || left.id.localeCompare(right.id);
  });
}
