export interface DiscordTaskCreateRequest {
  discordInteractionId: string;
  discordUserId: string;
  guildId: string | null;
  channelId: string;
  parentChannelId: string | null;
  commandName: "paperclip task create";
  title: string;
  description?: string;
  priority?: "low" | "medium" | "high" | "urgent";
}

export interface DiscordTaskCreateResult {
  issue: {
    id: string;
    identifier: string;
    title: string;
    url: string;
  };
  duplicate: boolean;
}

export interface DiscordNotificationEvent {
  id: string;
  idempotencyKey: string;
  occurredAt: string;
  projectId: string;
  issueId: string;
  issueIdentifier: string;
  eventType: "issue.created" | "issue.status_changed" | "issue.assignee_changed" | "issue.priority_changed" | "issue.comment_created" | "issue.blocked" | "issue.unblocked" | "issue.completed";
  origin: "dashboard" | "api" | "discord" | "automation";
  originDiscordChannelId?: string | null;
  actor: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  issueUrl: string;
}

export interface DiscordDelivery {
  id: string;
  event: DiscordNotificationEvent;
  recipient: { type: "channel" | "dm"; id: string };
}

export interface DiscordDeliveryAcknowledgement {
  outcome: "delivered" | "suppressed" | "retryable_failure" | "terminal_failure";
  discordMessageId?: string;
  errorCode?: string;
  retryAfterSeconds?: number;
}

export class DiscordIntegrationApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(`Discord integration API ${status}: ${code}`);
    this.name = "DiscordIntegrationApiError";
  }
}

/**
 * Bridge-scoped Paperclip client. It deliberately exposes only integration
 * endpoints, so a deployed bridge credential cannot become a generic issue
 * writer or submit caller-controlled Paperclip identity fields.
 */
export class DiscordIntegrationClient {
  constructor(
    private readonly opts: { apiUrl: string; apiKey: string },
  ) {}

  async createTask(request: DiscordTaskCreateRequest): Promise<DiscordTaskCreateResult> {
    return this.request("/api/integrations/discord/commands/task-create", { method: "POST", body: JSON.stringify(request) });
  }

  async getPendingDiscordDeliveries(): Promise<DiscordDelivery[]> {
    return this.request("/api/integrations/discord/deliveries/pending");
  }

  async acknowledgeDiscordDelivery(eventId: string, deliveryId: string, acknowledgement: DiscordDeliveryAcknowledgement): Promise<void> {
    await this.request(`/api/integrations/discord/events/${encodeURIComponent(eventId)}/deliveries/${encodeURIComponent(deliveryId)}`, {
      method: "POST", body: JSON.stringify(acknowledgement),
    });
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.opts.apiUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.opts.apiKey}`, "Content-Type": "application/json", ...init.headers },
    });
    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        throw new DiscordIntegrationApiError(response.status, "invalid_response");
      }
    }

    if (!response.ok) {
      const code =
        typeof body === "object" && body !== null && "code" in body && typeof body.code === "string"
          ? body.code
          : "request_failed";
      throw new DiscordIntegrationApiError(response.status, code);
    }
    return body as T;
  }
}