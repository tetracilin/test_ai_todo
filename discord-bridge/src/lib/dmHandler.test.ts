import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleDirectMessage } from "./dmHandler.js";
import { DiscordIntegrationApiError } from "./discordIntegrationClient.js";

function fakeMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "message-1",
    channelId: "dm-channel-1",
    guildId: null,
    createdTimestamp: Date.parse("2026-11-08T03:00:00.000Z"),
    content: "trợ giúp",
    author: { id: "discord-user-1", bot: false },
    attachments: new Map(),
    reply: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as any;
}

function fakeContext(result: unknown) {
  const sendDirectMessage = vi.fn();
  if (result instanceof Error) sendDirectMessage.mockRejectedValue(result);
  else sendDirectMessage.mockResolvedValue(result);
  return { paperclip: { sendDirectMessage } };
}

const linkedReply = { linked: true, companyId: "company-1", duplicate: false, reply: "Mình nhận các từ khoá sau", attachments: [] };

describe("handleDirectMessage", () => {
  let errorLog: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => errorLog.mockRestore());

  it("never reads or forwards a guild message", async () => {
    const ctx = fakeContext(linkedReply);
    const message = fakeMessage({ guildId: "guild-1" });

    expect(await handleDirectMessage(ctx, message)).toBe("ignored");

    expect(ctx.paperclip.sendDirectMessage).not.toHaveBeenCalled();
    expect(message.reply).not.toHaveBeenCalled();
  });

  it("ignores bot authors, including itself", async () => {
    const ctx = fakeContext(linkedReply);

    await handleDirectMessage(ctx, fakeMessage({ author: { id: "bot-1", bot: true } }));

    expect(ctx.paperclip.sendDirectMessage).not.toHaveBeenCalled();
  });

  it("stays silent for an unlinked sender", async () => {
    const ctx = fakeContext({ linked: false });
    const message = fakeMessage();

    expect(await handleDirectMessage(ctx, message)).toBe("unlinked");

    expect(ctx.paperclip.sendDirectMessage).toHaveBeenCalledTimes(1);
    expect(message.reply).not.toHaveBeenCalled();
  });

  it("posts the server's reply to a linked sender without pinging anyone", async () => {
    const ctx = fakeContext(linkedReply);
    const message = fakeMessage();

    expect(await handleDirectMessage(ctx, message)).toBe("answered");

    expect(message.reply).toHaveBeenCalledWith({
      content: linkedReply.reply,
      allowedMentions: { parse: [], repliedUser: false },
    });
  });

  it("forwards attachment metadata only", async () => {
    const ctx = fakeContext(linkedReply);
    const attachments = new Map([
      ["a-1", { id: "a-1", name: "photo.png", contentType: "image/png", size: 512, url: "https://cdn.discordapp.com/x" }],
      ["a-2", { id: "a-2", name: "notes", contentType: null, size: 3, url: "https://cdn.discordapp.com/y" }],
    ]);

    await handleDirectMessage(ctx, fakeMessage({ content: "", attachments }));

    expect(ctx.paperclip.sendDirectMessage).toHaveBeenCalledWith({
      discordUserId: "discord-user-1",
      messageId: "message-1",
      channelId: "dm-channel-1",
      content: "",
      attachments: [
        { id: "a-1", filename: "photo.png", contentType: "image/png", size: 512 },
        { id: "a-2", filename: "notes", contentType: null, size: 3 },
      ],
      messageCreatedAt: "2026-11-08T03:00:00.000Z",
    });
  });

  it("logs only the message id and error code when the server call fails", async () => {
    const ctx = fakeContext(new DiscordIntegrationApiError(429, "dm_rate_limited"));
    const message = fakeMessage({ content: "secret job order text" });

    expect(await handleDirectMessage(ctx, message)).toBe("failed");

    expect(message.reply).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith("discord_dm_failed", { messageId: "message-1", code: "dm_rate_limited" });
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("secret job order text");
  });

  it("stays silent on a message id the server already answered", async () => {
    const ctx = fakeContext({ linked: true, companyId: "company-1", duplicate: true });
    const message = fakeMessage();

    expect(await handleDirectMessage(ctx, message, { replay: true })).toBe("duplicate");

    expect(message.reply).not.toHaveBeenCalled();
    expect(ctx.paperclip.sendDirectMessage).toHaveBeenCalledWith(expect.objectContaining({ replay: true }));
  });

  it.each([
    ["a network error", new TypeError("fetch failed")],
    ["a 5xx", new DiscordIntegrationApiError(503, "request_failed")],
  ])("reports Paperclip unavailable on %s, so the replay retries it", async (_label, error) => {
    const message = fakeMessage();

    expect(await handleDirectMessage(fakeContext(error), message)).toBe("unavailable");
    expect(message.reply).not.toHaveBeenCalled();
  });

  it("treats a refused Discord reply as final, not as Paperclip downtime", async () => {
    const message = fakeMessage({ reply: vi.fn().mockRejectedValue(new Error("Missing Access")) });

    expect(await handleDirectMessage(fakeContext(linkedReply), message)).toBe("failed");
  });

  it("forwards a Discord forward's snapshot and the original message's ids", async () => {
    const ctx = fakeContext(linkedReply);
    const snapshot = {
      content: "Thay tủ điện tầng 3",
      attachments: new Map([["a-1", { id: "a-1", name: "so-do.png", contentType: "image/png", size: 20 }]]),
    };
    const message = fakeMessage({
      content: "",
      reference: { type: 1, messageId: "origin-1", channelId: "origin-channel", guildId: undefined },
      messageSnapshots: new Map([["origin-1", snapshot]]),
    });
    message.messageSnapshots.first = () => snapshot;

    await handleDirectMessage(ctx, message);

    expect(ctx.paperclip.sendDirectMessage).toHaveBeenCalledWith(expect.objectContaining({
      content: "",
      forwarded: {
        messageId: "origin-1",
        channelId: "origin-channel",
        content: "Thay tủ điện tầng 3",
        attachments: [{ id: "a-1", filename: "so-do.png", contentType: "image/png", size: 20 }],
      },
    }));
  });

  it("treats an ordinary reply as a plain DM, not a forward", async () => {
    const ctx = fakeContext(linkedReply);

    await handleDirectMessage(ctx, fakeMessage({ reference: { type: 0, messageId: "m-0", channelId: "dm-channel-1" } }));

    expect(ctx.paperclip.sendDirectMessage.mock.calls[0]![0]).not.toHaveProperty("forwarded");
  });
});
