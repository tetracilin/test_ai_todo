import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DM_PAIRING_WINDOW_MS, DmPairing, handleDirectMessage } from "./dmHandler.js";

const T0 = Date.parse("2026-11-08T03:00:00.000Z");
let nextId = 1;

function fakeMessage(overrides: Record<string, unknown> = {}) {
  const id = `message-${nextId++}`;
  return {
    id,
    channelId: "dm-channel-1",
    guildId: null,
    createdTimestamp: T0,
    content: "",
    author: { id: "discord-user-1", bot: false },
    attachments: new Map(),
    reply: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as any;
}

function photo(overrides: Record<string, unknown> = {}) {
  const attachment = { id: "a-1", name: "IMG_2041.jpg", contentType: "image/jpeg", size: 512, url: "https://cdn.discordapp.com/attachments/1/2/IMG_2041.jpg" };
  return fakeMessage({ attachments: new Map([[attachment.id, attachment]]), ...overrides });
}

const answered = (reply: string, extra: Record<string, unknown> = {}) => ({ linked: true, companyId: "company-1", duplicate: false, reply, attachments: [], ...extra });

describe("handleDirectMessage (F-CAP-1 additions)", () => {
  it("sends each attachment's CDN URL, and the paired caption with its own message id", async () => {
    const sendDirectMessage = vi.fn().mockResolvedValue(answered("Đã ghi vào thẻ T3-142"));
    const caption = fakeMessage({ content: "tủ điện tầng 3", createdTimestamp: T0 + 5_000 });

    await handleDirectMessage({ paperclip: { sendDirectMessage } }, photo(), { caption });

    expect(sendDirectMessage.mock.calls[0]![0]).toMatchObject({
      attachments: [{ id: "a-1", filename: "IMG_2041.jpg", contentType: "image/jpeg", size: 512, url: "https://cdn.discordapp.com/attachments/1/2/IMG_2041.jpg" }],
      caption: { messageId: caption.id, content: "tủ điện tầng 3", messageCreatedAt: "2026-11-08T03:00:05.000Z" },
    });
  });
});

describe("DmPairing", () => {
  let errorLog: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.useFakeTimers();
    errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    errorLog.mockRestore();
  });

  function pairing(sendDirectMessage: ReturnType<typeof vi.fn>) {
    return new DmPairing({ paperclip: { sendDirectMessage } });
  }

  it("pairs a photo with the caption that follows it inside the window: one capture, one request", async () => {
    const sendDirectMessage = vi.fn().mockResolvedValue(answered("Đã ghi vào thẻ T3-142"));
    const pair = pairing(sendDirectMessage);
    const image = photo();
    const caption = fakeMessage({ content: "tủ điện tầng 3", createdTimestamp: T0 + 5_000 });

    const held = pair.handle(image);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sendDirectMessage).not.toHaveBeenCalled();
    const outcome = await pair.handle(caption);

    expect(outcome).toBe("answered");
    expect(await held).toBe("answered");
    expect(sendDirectMessage).toHaveBeenCalledTimes(1);
    expect(sendDirectMessage.mock.calls[0]![0]).toMatchObject({ messageId: image.id, caption: { messageId: caption.id, content: "tủ điện tầng 3" } });
    // The confirmation is one reply, on the photo; the caption gets none of its own.
    expect(image.reply).toHaveBeenCalledTimes(1);
    expect(caption.reply).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(DM_PAIRING_WINDOW_MS * 2);
    expect(sendDirectMessage).toHaveBeenCalledTimes(1);
  });

  it("sends the photo alone when the caption arrives just outside the window", async () => {
    const sendDirectMessage = vi.fn()
      .mockResolvedValueOnce(answered("Đã ghi vào thẻ T3-142"))
      .mockResolvedValueOnce(answered("Mình chưa hiểu", { holdReplyForCaption: true }));
    const pair = pairing(sendDirectMessage);
    const image = photo();
    const late = fakeMessage({ content: "tủ điện tầng 3" });

    const held = pair.handle(image);
    await vi.advanceTimersByTimeAsync(DM_PAIRING_WINDOW_MS + 1);
    expect(await held).toBe("answered");
    expect(sendDirectMessage).toHaveBeenCalledTimes(1);
    expect(sendDirectMessage.mock.calls[0]![0].caption).toBeUndefined();

    const lateOutcome = pair.handle(late);
    await vi.advanceTimersByTimeAsync(DM_PAIRING_WINDOW_MS + 1);
    expect(await lateOutcome).toBe("answered");
    expect(sendDirectMessage).toHaveBeenCalledTimes(2);
    expect(sendDirectMessage.mock.calls[1]![0]).toMatchObject({ messageId: late.id, attachments: [] });
  });

  it("pairs caption-first: the held 'not understood' reply is dropped and the photo carries the text", async () => {
    const sendDirectMessage = vi.fn()
      .mockResolvedValueOnce(answered("Mình chưa hiểu", { holdReplyForCaption: true }))
      .mockResolvedValueOnce(answered("Đã ghi vào thẻ T3-142"));
    const pair = pairing(sendDirectMessage);
    const caption = fakeMessage({ content: "tủ điện tầng 3" });
    const image = photo({ createdTimestamp: T0 + 3_000 });

    const first = pair.handle(caption);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(caption.reply).not.toHaveBeenCalled();
    const outcome = await pair.handle(image);

    expect(outcome).toBe("answered");
    expect(await first).toBe("answered");
    expect(sendDirectMessage.mock.calls[1]![0]).toMatchObject({ messageId: image.id, caption: { messageId: caption.id, content: "tủ điện tầng 3" } });
    expect(image.reply).toHaveBeenCalledWith(expect.objectContaining({ content: "Đã ghi vào thẻ T3-142" }));
    await vi.advanceTimersByTimeAsync(DM_PAIRING_WINDOW_MS * 2);
    expect(caption.reply).not.toHaveBeenCalled();
  });

  it("posts the held 'not understood' reply when no photo follows", async () => {
    const sendDirectMessage = vi.fn().mockResolvedValue(answered("Mình chưa hiểu", { holdReplyForCaption: true }));
    const pair = pairing(sendDirectMessage);
    const text = fakeMessage({ content: "xyz abc" });

    const outcome = pair.handle(text);
    await vi.advanceTimersByTimeAsync(DM_PAIRING_WINDOW_MS - 1);
    expect(text.reply).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);

    expect(await outcome).toBe("answered");
    expect(text.reply).toHaveBeenCalledWith(expect.objectContaining({ content: "Mình chưa hiểu" }));
  });

  it("answers a verb straight away, with nothing held", async () => {
    const sendDirectMessage = vi.fn().mockResolvedValue(answered("Mình nhận các từ khoá sau"));
    const text = fakeMessage({ content: "trợ giúp" });

    expect(await pairing(sendDirectMessage).handle(text)).toBe("answered");
    expect(text.reply).toHaveBeenCalledTimes(1);
  });

  it("sends a photo that already carries text straight away", async () => {
    const sendDirectMessage = vi.fn().mockResolvedValue(answered("Đã ghi vào thẻ T3-142"));
    const image = photo({ content: "tủ điện tầng 3" });

    expect(await pairing(sendDirectMessage).handle(image)).toBe("answered");
    expect(sendDirectMessage.mock.calls[0]![0]).toMatchObject({ content: "tủ điện tầng 3" });
    expect(sendDirectMessage.mock.calls[0]![0].caption).toBeUndefined();
  });

  it("never pairs across senders", async () => {
    const sendDirectMessage = vi.fn().mockResolvedValue(answered("ok"));
    const pair = pairing(sendDirectMessage);
    const image = photo();
    const stranger = fakeMessage({ content: "tủ điện tầng 3", author: { id: "discord-user-2", bot: false } });

    const held = pair.handle(image);
    await pair.handle(stranger);
    expect(sendDirectMessage).toHaveBeenCalledTimes(1);
    expect(sendDirectMessage.mock.calls[0]![0]).toMatchObject({ discordUserId: "discord-user-2" });
    await vi.advanceTimersByTimeAsync(DM_PAIRING_WINDOW_MS + 1);
    await held;
    expect(sendDirectMessage.mock.calls[1]![0].caption).toBeUndefined();
  });

  it("sends the first photo alone when a second one arrives, and holds the second", async () => {
    const sendDirectMessage = vi.fn().mockResolvedValue(answered("Đã ghi vào thẻ T3-142"));
    const pair = pairing(sendDirectMessage);
    const first = photo();
    const second = photo();

    const firstOutcome = pair.handle(first);
    const secondOutcome = pair.handle(second);
    expect(await firstOutcome).toBe("answered");
    expect(sendDirectMessage).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(DM_PAIRING_WINDOW_MS + 1);
    expect(await secondOutcome).toBe("answered");
    expect(sendDirectMessage.mock.calls.map((call) => call[0].messageId)).toEqual([first.id, second.id]);
  });

  it("reports an unreachable Paperclip for a held photo, so the outage and replay path takes over", async () => {
    const sendDirectMessage = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const pair = pairing(sendDirectMessage);

    const held = pair.handle(photo());
    await vi.advanceTimersByTimeAsync(DM_PAIRING_WINDOW_MS + 1);

    expect(await held).toBe("unavailable");
  });

  it("ignores guild messages and bots without holding anything", async () => {
    const sendDirectMessage = vi.fn();
    const pair = pairing(sendDirectMessage);

    expect(await pair.handle(photo({ guildId: "guild-1" }))).toBe("ignored");
    expect(await pair.handle(photo({ author: { id: "bot-1", bot: true } }))).toBe("ignored");
    expect(sendDirectMessage).not.toHaveBeenCalled();
  });

  it("stops its timers on shutdown and sends nothing: the photo stays in DM history for the replay", async () => {
    const sendDirectMessage = vi.fn();
    const pair = pairing(sendDirectMessage);

    const held = pair.handle(photo());
    pair.stop();
    await vi.advanceTimersByTimeAsync(DM_PAIRING_WINDOW_MS * 2);

    expect(await held).toBe("ignored");
    expect(sendDirectMessage).not.toHaveBeenCalled();
  });
});
