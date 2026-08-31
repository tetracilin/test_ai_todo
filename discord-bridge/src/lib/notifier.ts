import type { Client, TextBasedChannel, User } from "discord.js";
import type {
  DiscordDelivery,
  DiscordDeliveryAcknowledgement,
  DiscordNotificationEvent,
  DiscordIntegrationClient,
} from "./discordIntegrationClient.js";

const ALLOWED_MENTIONS = { parse: [] as [] };

type DiscordError = Error & {
  status?: number;
  statusCode?: number;
  httpStatus?: number;
  retry_after?: number;
  retryAfter?: number;
  code?: number | string;
};

function text(value: unknown, maximum = 300): string {
  if (typeof value !== "string") return "";
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maximum ? `${normalized.slice(0, maximum - 1)}…` : normalized;
}

function changed(event: DiscordNotificationEvent, field: string): string {
  const before = text(event.before?.[field], 80) || "unset";
  const after = text(event.after?.[field], 80) || "unset";
  return `${before} → ${after}`;
}

/** Formats only allowlisted outbox fields; event bodies and credentials never reach Discord. */
export function formatDiscordNotification(event: DiscordNotificationEvent): string {
  const title = text(event.title, 160) || text(event.after?.title, 160) || text(event.before?.title, 160) || "Untitled task";
  let detail: string;
  switch (event.eventType) {
    case "issue.status_changed":
      detail = `Status: ${changed(event, "status")}`;
      break;
    case "issue.assignee_changed":
      detail = `Assignee: ${changed(event, "assignee")}`;
      break;
    case "issue.priority_changed":
      detail = `Priority: ${changed(event, "priority")}`;
      break;
    case "issue.comment_created":
      detail = `Comment: ${text(event.commentExcerpt, 300) || "New comment"}`;
      break;
    case "issue.mentioned":
      detail = `You were mentioned: ${text(event.commentExcerpt, 300) || "New comment"}`;
      break;
    case "issue.blocked":
      detail = "Task blocked";
      break;
    case "issue.unblocked":
      detail = "Task unblocked";
      break;
    case "issue.completed":
      detail = "Task completed";
      break;
    case "issue.created":
      detail = "Task created";
      break;
  }
  const actor = text(event.actor, 80) || "Paperclip";
  return `**${text(event.issueIdentifier, 80)}** ${title}\n${detail}\nBy ${actor} · ${event.occurredAt}\n<${event.issueUrl}>`;
}

function httpStatus(error: unknown): number | undefined {
  const candidate = error as DiscordError;
  return candidate?.status ?? candidate?.statusCode ?? candidate?.httpStatus;
}

function retryAfterSeconds(error: unknown): number | undefined {
  const candidate = error as DiscordError;
  const raw = candidate?.retry_after ?? candidate?.retryAfter;
  return typeof raw === "number" && raw >= 0 ? raw : undefined;
}

export function failureAcknowledgement(error: unknown): DiscordDeliveryAcknowledgement {
  const status = httpStatus(error);
  const errorCode = status ? `discord_http_${status}` : "discord_network_error";
  if (status !== undefined && status >= 400 && status < 500 && status !== 429) {
    return { outcome: "terminal_failure", errorCode };
  }
  return {
    outcome: "retryable_failure",
    errorCode,
    retryAfterSeconds: retryAfterSeconds(error),
  };
}

function shouldSuppress(delivery: DiscordDelivery): boolean {
  const { event, recipient } = delivery;
  return (
    event.eventType === "issue.created" &&
    event.origin === "discord" &&
    recipient.type === "channel" &&
    recipient.id === event.originDiscordChannelId
  );
}

async function sendDelivery(client: Client, delivery: DiscordDelivery): Promise<string> {
  const payload = { content: formatDiscordNotification(delivery.event), allowedMentions: ALLOWED_MENTIONS };
  if (delivery.recipient.type === "dm") {
    const user = (await client.users.fetch(delivery.recipient.id)) as User;
    const message = await user.send(payload);
    return message.id;
  }
  const channel = (await client.channels.fetch(delivery.recipient.id)) as TextBasedChannel | null;
  if (!channel || !("send" in channel)) {
    const error = new Error("Discord channel is not sendable") as DiscordError;
    error.status = 404;
    throw error;
  }
  const message = await channel.send(payload);
  return message.id;
}

async function acknowledge(
  paperclip: DiscordIntegrationClient,
  delivery: DiscordDelivery,
  result: DiscordDeliveryAcknowledgement,
): Promise<void> {
  await paperclip.acknowledgeDiscordDelivery(delivery.event.id, delivery.id, result);
}

/** Processes committed outbox deliveries. Failure acknowledgment never throws into source issue actions. */
export async function deliverPendingOnce(client: Client, paperclip: DiscordIntegrationClient): Promise<void> {
  const deliveries = await paperclip.getPendingDiscordDeliveries();
  for (const delivery of deliveries) {
    if (shouldSuppress(delivery)) {
      await acknowledge(paperclip, delivery, { outcome: "suppressed" });
      continue;
    }

    let discordMessageId: string;
    try {
      discordMessageId = await sendDelivery(client, delivery);
    } catch (error) {
      const result = failureAcknowledgement(error);
      try {
        await acknowledge(paperclip, delivery, result);
      } catch (acknowledgementError) {
        console.error("discord delivery acknowledgement failed", {
          eventId: delivery.event.id,
          deliveryId: delivery.id,
          errorCode: httpStatus(acknowledgementError) ? `paperclip_http_${httpStatus(acknowledgementError)}` : "paperclip_network_error",
        });
      }
      console.warn("discord delivery failed", {
        eventId: delivery.event.id,
        deliveryId: delivery.id,
        eventType: delivery.event.eventType,
        outcome: result.outcome,
        errorCode: result.errorCode,
      });
      continue;
    }

    try {
      await acknowledge(paperclip, delivery, { outcome: "delivered", discordMessageId });
      console.info("discord delivery delivered", {
        eventId: delivery.event.id,
        deliveryId: delivery.id,
        eventType: delivery.event.eventType,
      });
    } catch (error) {
      console.error("discord delivery acknowledgement failed", {
        eventId: delivery.event.id,
        deliveryId: delivery.id,
        errorCode: httpStatus(error) ? `paperclip_http_${httpStatus(error)}` : "paperclip_network_error",
      });
    }
  }
}

/** Polls only durable delivery records; issue events are never inferred from polling. */
export function startDeliveryWorker(client: Client, paperclip: DiscordIntegrationClient, pollIntervalSeconds: number): NodeJS.Timeout {
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    void deliverPendingOnce(client, paperclip)
      .catch((error) => {
        console.error("discord delivery poll failed", {
          errorCode: httpStatus(error) ? `paperclip_http_${httpStatus(error)}` : "paperclip_network_error",
        });
      })
      .finally(() => {
        running = false;
      });
  };
  tick();
  return setInterval(tick, pollIntervalSeconds * 1000);
}