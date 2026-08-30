import { describe, expect, it, vi } from "vitest";
import {
  deliverPendingOnce,
  failureAcknowledgement,
  formatDiscordNotification,
} from "./notifier.js";
import type { DiscordDelivery, DiscordNotificationEvent } from "./discordIntegrationClient.js";

const event: DiscordNotificationEvent = {
  id: "event-1",
  idempotencyKey: "immutable-event-key",
  occurredAt: "2026-08-30T10:00:00.000Z",
  projectId: "project-1",
  issueId: "issue-1",
  issueIdentifier: "T-10",
  eventType: "issue.status_changed",
  origin: "dashboard",
  actor: "Jane Doe",
  before: { status: "todo", title: "Ship Discord bridge" },
  after: { status: "in_progress", title: "Ship Discord bridge" },
  issueUrl: "https://paperclip.example/issues/T-10",
};

function delivery(overrides: Partial<DiscordDelivery> = {}): DiscordDelivery {
  return {
    id: "delivery-1",
    event,
    recipient: { type: "channel", id: "channel-1" },
    ...overrides,
  };
}

function fakePaperclip(deliveries: DiscordDelivery[]) {
  return {
    getPendingDiscordDeliveries: vi.fn().mockResolvedValue(deliveries),
    acknowledgeDiscordDelivery: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function fakeClient(send: ReturnType<typeof vi.fn>) {
  return {
    channels: { fetch: vi.fn().mockResolvedValue({ send }) },
    users: { fetch: vi.fn() },
  } as any;
}

describe("formatDiscordNotification", () => {
  it("formats allowlisted status fields without mentions", () => {
    expect(formatDiscordNotification(event)).toBe(
      "**T-10** Ship Discord bridge\nStatus: todo → in_progress\nBy Jane Doe · 2026-08-30T10:00:00.000Z\n<https://paperclip.example/issues/T-10>",
    );
  });

  it("caps comment excerpts at 300 characters", () => {
    const content = "x".repeat(400);
    const message = formatDiscordNotification({
      ...event,
      eventType: "issue.comment_created",
      after: { commentExcerpt: content },
    });

    expect(message).toContain(`Comment: ${"x".repeat(299)}…`);
    expect(message).not.toContain("x".repeat(300));
  });
});

describe("failureAcknowledgement", () => {
  it("marks unavailable recipients terminal and rate limits retryable", () => {
    expect(failureAcknowledgement({ status: 403 })).toEqual({
      outcome: "terminal_failure",
      errorCode: "discord_http_403",
    });
    expect(failureAcknowledgement({ status: 429, retry_after: 7 })).toEqual({
      outcome: "retryable_failure",
      errorCode: "discord_http_429",
      retryAfterSeconds: 7,
    });
  });
});

describe("deliverPendingOnce", () => {
  it("sends one configured delivery with mentions disabled, then acknowledges it", async () => {
    const send = vi.fn().mockResolvedValue({ id: "discord-message-1" });
    const paperclip = fakePaperclip([delivery()]);

    await deliverPendingOnce(fakeClient(send), paperclip);

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({
      content: formatDiscordNotification(event),
      allowedMentions: { parse: [] },
    });
    expect(paperclip.acknowledgeDiscordDelivery).toHaveBeenCalledWith("event-1", "delivery-1", {
      outcome: "delivered",
      discordMessageId: "discord-message-1",
    });
  });

  it("suppresses source-channel create echo without posting", async () => {
    const send = vi.fn();
    const paperclip = fakePaperclip([
      delivery({
        event: {
          ...event,
          eventType: "issue.created",
          origin: "discord",
          originDiscordChannelId: "channel-1",
        },
      }),
    ]);

    await deliverPendingOnce(fakeClient(send), paperclip);

    expect(send).not.toHaveBeenCalled();
    expect(paperclip.acknowledgeDiscordDelivery).toHaveBeenCalledWith("event-1", "delivery-1", {
      outcome: "suppressed",
    });
  });

  it("records failed delivery and continues with other recipients", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("missing access"), { status: 403 }))
      .mockResolvedValueOnce({ id: "discord-message-2" });
    const first = delivery();
    const second = delivery({ id: "delivery-2", recipient: { type: "channel", id: "channel-2" } });
    const paperclip = fakePaperclip([first, second]);

    await deliverPendingOnce(fakeClient(send), paperclip);

    expect(paperclip.acknowledgeDiscordDelivery).toHaveBeenNthCalledWith(1, "event-1", "delivery-1", {
      outcome: "terminal_failure",
      errorCode: "discord_http_403",
    });
    expect(paperclip.acknowledgeDiscordDelivery).toHaveBeenNthCalledWith(2, "event-1", "delivery-2", {
      outcome: "delivered",
      discordMessageId: "discord-message-2",
    });
  });
});
