import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  activityLog,
  agentApiKeys,
  companies,
  discordDeliveryAttempts,
  discordNotificationPreferences,
  discordProjectChannelMappings,
  discordUserLinks,
  heartbeatRuns,
  integrationEventOutbox,
  issues,
} from "@paperclipai/db";
import { isUuidLike, PLUGIN_EVENT_TYPES, type PluginEventType } from "@paperclipai/shared";
import type { PluginEvent } from "@paperclipai/plugin-sdk";
import { publishLiveEvent } from "./live-events.js";
import { redactCurrentUserValue } from "../log-redaction.js";
import { sanitizeRecord } from "../redaction.js";
import { logger } from "../middleware/logger.js";
import type { PluginEventBus } from "./plugin-event-bus.js";
import { instanceSettingsService } from "./instance-settings.js";

const PLUGIN_EVENT_SET: ReadonlySet<string> = new Set(PLUGIN_EVENT_TYPES);
const ACTIVITY_ACTION_TO_PLUGIN_EVENT: Readonly<Record<string, PluginEventType>> = {
  issue_comment_added: "issue.comment.created",
  issue_comment_created: "issue.comment.created",
  issue_document_created: "issue.document.created",
  issue_document_updated: "issue.document.updated",
  issue_document_deleted: "issue.document.deleted",
  issue_blockers_updated: "issue.relations.updated",
  approval_approved: "approval.decided",
  approval_rejected: "approval.decided",
  approval_revision_requested: "approval.decided",
  budget_soft_threshold_crossed: "budget.incident.opened",
  budget_hard_threshold_crossed: "budget.incident.opened",
  budget_incident_resolved: "budget.incident.resolved",
};

let _pluginEventBus: PluginEventBus | null = null;

/** Wire the plugin event bus so domain events are forwarded to plugins. */
export function setPluginEventBus(bus: PluginEventBus): void {
  if (_pluginEventBus) {
    logger.warn("setPluginEventBus called more than once, replacing existing bus");
  }
  _pluginEventBus = bus;
}

function eventTypeForActivityAction(action: string): PluginEventType | null {
  if (PLUGIN_EVENT_SET.has(action)) return action as PluginEventType;
  return ACTIVITY_ACTION_TO_PLUGIN_EVENT[action.replaceAll(".", "_")] ?? null;
}

type DiscordEventType =
  | "issue.created"
  | "issue.status_changed"
  | "issue.assignee_changed"
  | "issue.priority_changed"
  | "issue.comment_created"
  | "issue.mentioned"
  | "issue.blocked"
  | "issue.unblocked"
  | "issue.completed";

export function discordEventTypesForActivity(input: LogActivityInput): DiscordEventType[] {
  if (input.entityType !== "issue") return [];
  if (input.action === "issue.created") return ["issue.created"];
  if (
    input.action === "issue.comment.created"
    || input.action === "issue.comment_added"
    || input.action === "issue_comment_added"
    || input.action === "issue_comment_created"
  ) {
    const events: DiscordEventType[] = ["issue.comment_created"];
    if (Array.isArray(input.details?.mentionedUserIds) && input.details.mentionedUserIds.length > 0) {
      events.push("issue.mentioned");
    }
    return events;
  }
  if (input.action !== "issue.updated") return [];
  const details = input.details ?? {};
  const events: DiscordEventType[] = [];
  if ("status" in details) {
    if (details.status === "blocked") events.push("issue.blocked");
    else if (details.status === "done") events.push("issue.completed");
    else if (details._previous && typeof details._previous === "object" && (details._previous as Record<string, unknown>).status === "blocked") events.push("issue.unblocked");
    else events.push("issue.status_changed");
  }
  if ("assigneeAgentId" in details || "assigneeUserId" in details) events.push("issue.assignee_changed");
  if ("priority" in details) events.push("issue.priority_changed");
  return events;
}

function discordIssueUrl(issue: { id: string; identifier: string | null }) {
  const base = process.env.PAPERCLIP_DASHBOARD_URL?.replace(/\/$/, "") ?? "";
  return `${base}/issues/${encodeURIComponent(issue.identifier ?? issue.id)}`;
}

async function enqueueDiscordNotifications(
  db: Db,
  activityId: string,
  input: LogActivityInput,
  redactedDetails: Record<string, unknown> | null,
) {
  const eventTypes = discordEventTypesForActivity(input);
  if (eventTypes.length === 0) return;
  const issue = await db.select({
    id: issues.id,
    companyId: issues.companyId,
    projectId: issues.projectId,
    identifier: issues.identifier,
    title: issues.title,
    assigneeUserId: issues.assigneeUserId,
  }).from(issues).where(and(eq(issues.companyId, input.companyId), eq(issues.id, input.entityId))).then((rows) => rows[0] ?? null);
  if (!issue) return;

  const [mappings, preferences] = await Promise.all([
    issue.projectId
      ? db.select().from(discordProjectChannelMappings).where(and(
        eq(discordProjectChannelMappings.companyId, issue.companyId),
        eq(discordProjectChannelMappings.projectId, issue.projectId),
        eq(discordProjectChannelMappings.enabled, true),
      ))
      : Promise.resolve([]),
    db.select({
      preference: discordNotificationPreferences,
      discordUserId: discordUserLinks.discordUserId,
      userId: discordNotificationPreferences.userId,
    })
      .from(discordNotificationPreferences)
      .innerJoin(discordUserLinks, and(
        eq(discordUserLinks.companyId, discordNotificationPreferences.companyId),
        eq(discordUserLinks.userId, discordNotificationPreferences.userId),
        eq(discordUserLinks.active, true),
      ))
      .where(and(eq(discordNotificationPreferences.companyId, issue.companyId), eq(discordNotificationPreferences.enabled, true))),
  ]);

  for (const eventType of eventTypes) {
    const personalTargetUserIds = eventType === "issue.mentioned"
      ? Array.isArray(redactedDetails?.mentionedUserIds)
        ? redactedDetails.mentionedUserIds.filter((value): value is string => typeof value === "string")
        : []
      : eventType === "issue.assignee_changed" && issue.assigneeUserId
        ? [issue.assigneeUserId]
        : null;
    const [event] = await db.insert(integrationEventOutbox).values({
      idempotencyKey: `discord:activity:${activityId}:${eventType}`,
      companyId: issue.companyId,
      projectId: issue.projectId,
      issueId: issue.id,
      eventType,
      origin: "paperclip",
      payload: {
        issueIdentifier: issue.identifier,
        title: issue.title,
        issueUrl: discordIssueUrl(issue),
        actor: input.actorId,
        before: redactedDetails?._previous ?? null,
        after: redactedDetails,
        commentExcerpt: eventType === "issue.comment_created" || eventType === "issue.mentioned"
          ? typeof redactedDetails?.bodySnippet === "string" ? redactedDetails.bodySnippet : null
          : null,
        ...(personalTargetUserIds ? { personalTargetUserIds } : {}),
      },
    }).onConflictDoNothing().returning();
    if (!event) continue;

    const recipients = new Map<string, { recipientType: "channel" | "dm"; recipientId: string }>();
    for (const mapping of mappings) {
      if (mapping.notificationEvents.includes(eventType)) {
        recipients.set(`channel:${mapping.channelId}`, { recipientType: "channel", recipientId: mapping.channelId });
      }
    }
    for (const { preference, discordUserId, userId } of preferences) {
      if (preference.eventType !== eventType) continue;
      if (personalTargetUserIds && !personalTargetUserIds.includes(userId)) continue;
      const recipientId = preference.deliveryMode === "channel" ? preference.channelId : discordUserId;
      if (!recipientId) continue;
      const recipientType = preference.deliveryMode === "channel" ? "channel" : "dm";
      recipients.set(`${recipientType}:${recipientId}`, { recipientType, recipientId });
    }
    if (recipients.size > 0) {
      await db.insert(discordDeliveryAttempts).values([...recipients.values()].map((recipient) => ({
        eventId: event.id,
        recipientType: recipient.recipientType,
        recipientId: recipient.recipientId,
        idempotencyKey: `${event.id}:${recipient.recipientType}:${recipient.recipientId}`,
      }))).onConflictDoNothing();
    }
  }
}

export function publishPluginDomainEvent(event: PluginEvent): void {
  if (!_pluginEventBus) return;
  void _pluginEventBus.emit(event).then(({ errors }) => {
    for (const { pluginId, error } of errors) {
      logger.warn({ pluginId, eventType: event.eventType, err: error }, "plugin event handler failed");
    }
  }).catch(() => {});
}

export interface LogActivityInput {
  companyId: string;
  actorType: "agent" | "user" | "system" | "plugin";
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  agentId?: string | null;
  runId?: string | null;
  agentApiKeyId?: string | null;
  issueId?: string | null;
  details?: Record<string, unknown> | null;
  responsibleUserIdOverride?: string | null;
}

export interface ActivityPublication {
  companyId: string;
  payload: Record<string, unknown>;
  pluginEvent: PluginEvent | null;
}

export async function createActivityDetailsRedactor(db: Db) {
  const currentUserRedactionOptions = {
    enabled: (await instanceSettingsService(db).getGeneral()).censorUsernameInLogs,
  };
  return (details: Record<string, unknown> | null) => (
    details ? redactCurrentUserValue(sanitizeRecord(details), currentUserRedactionOptions) : null
  );
}

export async function redactActivityDetails(db: Db, details: Record<string, unknown> | null) {
  if (!details) return null;
  return (await createActivityDetailsRedactor(db))(details);
}

function readNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export async function resolveResponsibleUserIdForActivity(db: Db, input: LogActivityInput) {
  if (input.responsibleUserIdOverride !== undefined) {
    return readNonEmptyString(input.responsibleUserIdOverride);
  }
  if (input.actorType === "user") return readNonEmptyString(input.actorId);

  const runId = readNonEmptyString(input.runId);
  if (runId && isUuidLike(runId)) {
    const run = await db
      .select({ responsibleUserId: heartbeatRuns.responsibleUserId })
      .from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, runId)))
      .then((rows) => rows[0] ?? null);
    const runResponsibleUserId = readNonEmptyString(run?.responsibleUserId);
    if (runResponsibleUserId) return runResponsibleUserId;
  }

  const issueIdCandidate = readNonEmptyString(input.issueId)
    ?? (input.entityType === "issue" ? readNonEmptyString(input.entityId) : null);
  const issueId = isUuidLike(issueIdCandidate) ? issueIdCandidate : null;
  if (issueId) {
    const issue = await db
      .select({
        responsibleUserId: issues.responsibleUserId,
        createdByUserId: issues.createdByUserId,
      })
      .from(issues)
      .where(and(eq(issues.companyId, input.companyId), eq(issues.id, issueId)))
      .then((rows) => rows[0] ?? null);
    const issueResponsibleUserId = readNonEmptyString(issue?.responsibleUserId)
      ?? readNonEmptyString(issue?.createdByUserId);
    if (issueResponsibleUserId) return issueResponsibleUserId;
  }

  const agentApiKeyId = readNonEmptyString(input.agentApiKeyId);
  const agentId = readNonEmptyString(input.agentId);
  if (agentApiKeyId && isUuidLike(agentApiKeyId)) {
    const apiKey = await db
      .select({ responsibleUserId: agentApiKeys.responsibleUserId })
      .from(agentApiKeys)
      .where(and(
        eq(agentApiKeys.companyId, input.companyId),
        eq(agentApiKeys.id, agentApiKeyId),
        ...(agentId && isUuidLike(agentId) ? [eq(agentApiKeys.agentId, agentId)] : []),
      ))
      .then((rows) => rows[0] ?? null);
    const apiKeyResponsibleUserId = readNonEmptyString(apiKey?.responsibleUserId);
    if (apiKeyResponsibleUserId) return apiKeyResponsibleUserId;
  }

  const company = await db
    .select({ defaultResponsibleUserId: companies.defaultResponsibleUserId })
    .from(companies)
    .where(eq(companies.id, input.companyId))
    .then((rows) => rows[0] ?? null);
  return readNonEmptyString(company?.defaultResponsibleUserId);
}

export function publishActivity(publication: ActivityPublication) {
  publishLiveEvent({
    companyId: publication.companyId,
    type: "activity.logged",
    payload: publication.payload,
  });
  if (publication.pluginEvent) publishPluginDomainEvent(publication.pluginEvent);
}

export async function persistActivity(db: Db, input: LogActivityInput) {
  const redactedDetails = await redactActivityDetails(db, input.details ?? null);
  const responsibleUserId = await resolveResponsibleUserIdForActivity(db, input);
  const [activity] = await db.insert(activityLog).values({
    companyId: input.companyId,
    actorType: input.actorType,
    actorId: input.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    agentId: input.agentId ?? null,
    runId: input.runId ?? null,
    responsibleUserId,
    details: redactedDetails,
  }).returning({ id: activityLog.id });
  try {
    await enqueueDiscordNotifications(db, activity.id, input, redactedDetails);
  } catch (error) {
    // Discord delivery must never block a source issue action. Only safe
    // correlation fields reach logs; payloads and credentials stay omitted.
    logger.warn({ err: error, activityId: activity.id, action: input.action }, "failed to enqueue Discord notification");
  }

  const payload = {
    actorType: input.actorType,
    actorId: input.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    agentId: input.agentId ?? null,
    runId: input.runId ?? null,
    responsibleUserId,
    details: redactedDetails,
  };
  const pluginEventType = eventTypeForActivityAction(input.action);
  const pluginEvent: PluginEvent | null = pluginEventType
    ? {
        eventId: randomUUID(),
        eventType: pluginEventType,
        occurredAt: new Date().toISOString(),
        actorId: input.actorId,
        actorType: input.actorType,
        entityId: input.entityId,
        entityType: input.entityType,
        companyId: input.companyId,
        payload: {
          ...redactedDetails,
          agentId: input.agentId ?? null,
          runId: input.runId ?? null,
          responsibleUserId,
        },
      }
    : null;

  return {
    activity,
    publication: {
      companyId: input.companyId,
      payload,
      pluginEvent,
    } satisfies ActivityPublication,
  };
}

export async function logActivity(
  db: Db,
  input: LogActivityInput,
  postCommitPublications?: ActivityPublication[],
) {
  const { activity, publication } = await persistActivity(db, input);
  if (postCommitPublications) {
    postCommitPublications.push(publication);
  } else {
    publishActivity(publication);
  }
  return activity;
}
