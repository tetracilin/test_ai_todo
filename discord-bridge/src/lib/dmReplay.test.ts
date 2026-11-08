import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DM_DOWNTIME_NOTICE_AFTER_MS, DM_RETRY_INTERVAL_MS, DmRecovery } from "./dmReplay.js";

const T0 = Date.parse("2026-11-08T03:00:00.000Z"); // 10:00 in Vietnam
const statusMessages = { downtime: "DOWN since {{since}}", recovered: "BACK {{count}}" };

function fakeMessage(id: string, authorId: string, createdTimestamp: number, bot = false) {
  return {
    id,
    channelId: `dm-${authorId}`,
    guildId: null,
    createdTimestamp,
    content: `message ${id}`,
    author: { id: authorId, bot },
    attachments: new Map(),
    reply: vi.fn().mockResolvedValue(undefined),
  } as any;
}

/**
 * A Paperclip server with the F-DM-3 ledger (each message id answered once)
 * and a Discord whose DM history keeps every message, as the real one does.
 */
function fakeWorld(users = ["u1"]) {
  let clock = T0;
  const world = {
    down: false,
    answered: new Set<string>(),
    history: new Map<string, any[]>(users.map((user) => [user, []])),
    sent: [] as Array<{ to: string; content: string }>,
    now: () => clock,
    advance: (ms: number) => { clock += ms; },
  };
  const unavailable = () => new TypeError("fetch failed");
  const paperclip = {
    sendDirectMessage: vi.fn(async (request: { messageId: string }) => {
      if (world.down) throw unavailable();
      if (world.answered.has(request.messageId)) return { linked: true as const, companyId: "c1", duplicate: true as const };
      world.answered.add(request.messageId);
      return { linked: true as const, companyId: "c1", duplicate: false as const, reply: `answer ${request.messageId}`, attachments: [] };
    }),
    getDmReplayPlan: vi.fn(async () => {
      if (world.down) throw unavailable();
      return { cursors: users.map((discordUserId) => ({ discordUserId, afterMessageId: "0" })), statusMessages };
    }),
    reportDmDowntime: vi.fn(async () => undefined),
  };
  const client = {
    users: {
      createDM: vi.fn(async (userId: string) => ({
        messages: {
          fetch: vi.fn(async ({ after, limit }: { after: string; limit: number }) => {
            const newer = (world.history.get(userId) ?? [])
              .filter((message) => BigInt(message.id) > BigInt(after))
              .sort((left, right) => (BigInt(left.id) < BigInt(right.id) ? -1 : 1))
              .slice(0, limit)
              .reverse();
            return new Map(newer.map((message) => [message.id, message]));
          }),
        },
        send: vi.fn(async ({ content }: { content: string }) => {
          world.sent.push({ to: userId, content });
        }),
      })),
    },
  };
  const recovery = new DmRecovery({ client, paperclip, now: world.now });
  const dm = (id: string, authorId = "u1", createdTimestamp = world.now()) => {
    const message = fakeMessage(id, authorId, createdTimestamp);
    world.history.get(authorId)!.push(message);
    return message;
  };
  return { world, paperclip, client, recovery, dm };
}

describe("DmRecovery (F-DM-3)", () => {
  let errorLog: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.useFakeTimers();
    errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    errorLog.mockRestore();
  });

  it("keeps a DM sent while Paperclip is down and answers it exactly once after recovery", async () => {
    const { world, recovery, dm, paperclip } = fakeWorld();
    world.down = true;
    const message = dm("101");

    expect(await recovery.handleLive(message)).toBe("unavailable");
    expect(message.reply).not.toHaveBeenCalled();

    world.down = false;
    world.advance(DM_RETRY_INTERVAL_MS);
    await recovery.sweep("paperclip_unreachable");
    await recovery.sweep("bridge_restarted");

    expect(message.reply).toHaveBeenCalledTimes(1);
    expect(message.reply).toHaveBeenCalledWith(expect.objectContaining({ content: "answer 101" }));
    expect(world.sent).toEqual([{ to: "u1", content: "BACK 1" }]);
    expect(paperclip.reportDmDowntime).toHaveBeenCalledTimes(1);
    expect(paperclip.reportDmDowntime).toHaveBeenCalledWith({
      startedAt: new Date(T0).toISOString(),
      endedAt: new Date(T0 + DM_RETRY_INTERVAL_MS).toISOString(),
      cause: "paperclip_unreachable",
      affectedUsers: 1,
      replayedMessages: 1,
    });
    recovery.stop();
  });

  it("retries on its own every five minutes while Paperclip is unreachable", async () => {
    const { world, recovery, dm, paperclip } = fakeWorld();
    world.down = true;
    const message = dm("101");
    await recovery.handleLive(message);

    await vi.advanceTimersByTimeAsync(DM_RETRY_INTERVAL_MS);
    expect(paperclip.getDmReplayPlan).toHaveBeenCalledTimes(1);
    expect(message.reply).not.toHaveBeenCalled();

    world.down = false;
    await vi.advanceTimersByTimeAsync(DM_RETRY_INTERVAL_MS);
    expect(message.reply).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(DM_RETRY_INTERVAL_MS * 3);
    expect(paperclip.getDmReplayPlan).toHaveBeenCalledTimes(2);
    recovery.stop();
  });

  it("sends one downtime notice per affected engineer once the outage passes 15 minutes", async () => {
    const { world, recovery, dm } = fakeWorld(["u1", "u2"]);
    await recovery.sweep("bridge_restarted"); // caches the phrase-table status messages
    world.down = true;

    await recovery.handleLive(dm("101", "u1"));
    expect(world.sent).toEqual([]);

    world.advance(DM_DOWNTIME_NOTICE_AFTER_MS + 60_000);
    await recovery.handleLive(dm("102", "u1"));
    await recovery.handleLive(dm("103", "u1"));
    await recovery.handleLive(dm("104", "u2"));

    expect(world.sent).toEqual([
      { to: "u1", content: "DOWN since 10:00" },
      { to: "u2", content: "DOWN since 10:00" },
    ]);
    recovery.stop();
  });

  it("replays in the order the engineer sent, and skips the bot's own messages", async () => {
    const { world, recovery, dm } = fakeWorld();
    const first = dm("101");
    const second = dm("102");
    world.history.get("u1")!.push(fakeMessage("103", "bot-1", T0, true));
    const order: string[] = [];
    first.reply.mockImplementation(async () => { order.push("101"); });
    second.reply.mockImplementation(async () => { order.push("102"); });

    await recovery.sweep("bridge_restarted");

    expect(order).toEqual(["101", "102"]);
    expect(world.sent).toEqual([{ to: "u1", content: "BACK 2" }]);
  });

  it("dates restart downtime from the oldest message it had to replay", async () => {
    const { world, recovery, dm, paperclip } = fakeWorld();
    dm("101", "u1", T0 - 20 * 60_000);

    await recovery.sweep("bridge_restarted");

    expect(paperclip.reportDmDowntime).toHaveBeenCalledWith(expect.objectContaining({
      startedAt: new Date(T0 - 20 * 60_000).toISOString(),
      endedAt: new Date(world.now()).toISOString(),
      cause: "bridge_restarted",
      replayedMessages: 1,
    }));
  });

  it("reports nothing and messages nobody when a restart missed nothing", async () => {
    const { world, recovery, dm, paperclip } = fakeWorld();
    world.answered.add(dm("101").id);

    await recovery.sweep("bridge_restarted");

    expect(world.sent).toEqual([]);
    expect(paperclip.reportDmDowntime).not.toHaveBeenCalled();
  });

  it("does not sweep after a resumed gateway session, which replays events itself", async () => {
    const { recovery, paperclip } = fakeWorld();

    recovery.gatewayDisconnected();
    recovery.gatewayResumed();
    await vi.advanceTimersByTimeAsync(DM_RETRY_INTERVAL_MS * 2);

    expect(paperclip.getDmReplayPlan).not.toHaveBeenCalled();
  });

  it("queues one more sweep when asked during a sweep, never two at once", async () => {
    const { recovery, paperclip } = fakeWorld();

    const first = recovery.sweep("bridge_restarted");
    void recovery.sweep("gateway_disconnected");
    void recovery.sweep("gateway_disconnected");
    await first;
    await vi.runAllTimersAsync();

    expect(paperclip.getDmReplayPlan).toHaveBeenCalledTimes(2);
  });
});
