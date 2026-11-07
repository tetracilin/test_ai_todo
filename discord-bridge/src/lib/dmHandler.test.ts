import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleDirectMessage } from "./dmHandler.js";
import { DiscordIntegrationApiError } from "./discordIntegrationClient.js";

function fakeMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "message-1",
    channelId: "dm-channel-1",
    guildId: null,
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

const linkedReply = { linked: true, companyId: "company-1", reply: "Mình nhận các từ khoá sau", attachments: [] };

describe("handleDirectMessage", () => {
  let errorLog: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => errorLog.mockRestore());

  it("never reads or forwards a guild message", async () => {
    const ctx = fakeContext(linkedReply);
    const message = fakeMessage({ guildId: "guild-1" });

    await handleDirectMessage(ctx, message);

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

    await handleDirectMessage(ctx, message);

    expect(ctx.paperclip.sendDirectMessage).toHaveBeenCalledTimes(1);
    expect(message.reply).not.toHaveBeenCalled();
  });

  it("posts the server's reply to a linked sender without pinging anyone", async () => {
    const ctx = fakeContext(linkedReply);
    const message = fakeMessage();

    await handleDirectMessage(ctx, message);

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
    });
  });

  it("logs only the message id and error code when the server call fails", async () => {
    const ctx = fakeContext(new DiscordIntegrationApiError(429, "dm_rate_limited"));
    const message = fakeMessage({ content: "secret job order text" });

    await handleDirectMessage(ctx, message);

    expect(message.reply).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith("discord_dm_failed", { messageId: "message-1", code: "dm_rate_limited" });
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("secret job order text");
  });
});
