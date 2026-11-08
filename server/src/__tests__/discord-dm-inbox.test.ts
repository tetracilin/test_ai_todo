import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { activityLog, companies, createDb, discordDmInboundMessages, discordUserLinks, type Db } from "@paperclipai/db";
import {
  DM_CLAIM_STALE_MS,
  DM_MAX_ATTEMPTS,
  DM_REPLAY_LOOKBACK_MS,
  DM_REPLAY_MAX_AGE_MS,
  discordDmInbox,
  discordSnowflakeAt,
} from "../services/discord-dm-inbox.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

describe("discordSnowflakeAt", () => {
  it("matches Discord's epoch encoding", () => {
    // Discord's documented example: 175928847299117063 was created at 1462015105796 ms.
    expect(BigInt(discordSnowflakeAt(1_462_015_105_796))).toBe(175928847299117063n >> 22n << 22n);
  });
});

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("discord DM inbound ledger (F-DM-3)", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const now = new Date("2026-11-08T03:00:00.000Z");

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-discord-dm-inbox-");
    db = createDb(tempDb.connectionString);
  }, 90_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function linkedUser(linkedAt = new Date(now.getTime() - 7 * DM_REPLAY_MAX_AGE_MS)) {
    const companyId = randomUUID();
    const discordUserId = `discord-${randomUUID()}`;
    await db.insert(companies).values({ id: companyId, name: "Pilot", issuePrefix: `D${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}` });
    await db.insert(discordUserLinks).values({ companyId, userId: `user-${randomUUID()}`, discordUserId, linkedAt });
    return { companyId, discordUserId };
  }

  function message(user: { companyId: string; discordUserId: string }, createdAt: Date) {
    return { ...user, discordMessageId: `m-${randomUUID()}`, channelId: "dm-1", messageCreatedAt: createdAt };
  }

  async function cursorFor(discordUserId: string, at = now) {
    const cursors = await discordDmInbox(db).replayCursors(at);
    return cursors.find((cursor) => cursor.discordUserId === discordUserId)?.afterMessageId;
  }

  it("claims a message id once, so a live delivery and its replay answer once", async () => {
    const inbox = discordDmInbox(db);
    const input = message(await linkedUser(), now);

    const [first, second] = await Promise.all([inbox.claim(input, now), inbox.claim(input, now)]);
    await inbox.succeed(input.discordMessageId, now);
    const replayed = await inbox.claim(input, new Date(now.getTime() + DM_CLAIM_STALE_MS * 10));

    expect([first.claimed, second.claimed].sort()).toEqual([false, true]);
    expect(replayed).toEqual({ claimed: false });
  });

  it("releases a failed message so its resend is processed, not dropped as a duplicate", async () => {
    const inbox = discordDmInbox(db);
    const input = message(await linkedUser(), now);

    await inbox.claim(input, now);
    await inbox.fail(input.discordMessageId, "processing_failed", now);
    const retry = await inbox.claim(input, new Date(now.getTime() + 1_000));
    await inbox.succeed(input.discordMessageId, now);

    expect(retry).toEqual({ claimed: true });
    const [row] = await db.select().from(discordDmInboundMessages).where(eq(discordDmInboundMessages.discordMessageId, input.discordMessageId));
    expect(row).toMatchObject({ status: "succeeded", attempts: 2, errorCode: null });
  });

  it("re-claims a processing message only after its claim goes stale", async () => {
    const inbox = discordDmInbox(db);
    const input = message(await linkedUser(), now);

    await inbox.claim(input, now);

    expect(await inbox.claim(input, new Date(now.getTime() + DM_CLAIM_STALE_MS - 1_000))).toEqual({ claimed: false });
    expect(await inbox.claim(input, new Date(now.getTime() + DM_CLAIM_STALE_MS + 1_000))).toEqual({ claimed: true });
  });

  it("gives up on a message that keeps failing, so it cannot stall the replay", async () => {
    const inbox = discordDmInbox(db);
    const user = await linkedUser();
    const poison = message(user, new Date(now.getTime() - 60 * 60 * 1000));
    for (let attempt = 1; attempt <= DM_MAX_ATTEMPTS; attempt += 1) {
      expect(await inbox.claim(poison, now)).toEqual({ claimed: true });
      await inbox.fail(poison.discordMessageId, "processing_failed", now);
    }

    expect(await inbox.claim(poison, now)).toEqual({ claimed: false });
    expect(await cursorFor(user.discordUserId)).toBe(discordSnowflakeAt(now.getTime() - DM_REPLAY_MAX_AGE_MS));
  });

  it("replays a user with no history from the start of the replay window", async () => {
    const user = await linkedUser();

    expect(await cursorFor(user.discordUserId)).toBe(discordSnowflakeAt(now.getTime() - DM_REPLAY_MAX_AGE_MS));
  });

  it("never replays messages sent before the account was linked", async () => {
    const linkedAt = new Date(now.getTime() - 60_000);
    const user = await linkedUser(linkedAt);

    expect(await cursorFor(user.discordUserId)).toBe(discordSnowflakeAt(linkedAt.getTime()));
  });

  it("re-reads the lookback behind the newest processed message", async () => {
    const inbox = discordDmInbox(db);
    const user = await linkedUser();
    const older = message(user, new Date(now.getTime() - 3 * 60 * 60 * 1000));
    const newer = message(user, new Date(now.getTime() - 60 * 60 * 1000));
    for (const input of [older, newer]) {
      await inbox.claim(input, now);
      await inbox.succeed(input.discordMessageId, now);
    }

    expect(await cursorFor(user.discordUserId)).toBe(discordSnowflakeAt(newer.messageCreatedAt.getTime() - DM_REPLAY_LOOKBACK_MS));
  });

  it("starts the replay at the oldest failed message, even behind later successes", async () => {
    const inbox = discordDmInbox(db);
    const user = await linkedUser();
    const failed = message(user, new Date(now.getTime() - 5 * 60 * 60 * 1000));
    const later = message(user, new Date(now.getTime() - 60 * 60 * 1000));
    await inbox.claim(failed, now);
    await inbox.fail(failed.discordMessageId, "processing_failed", now);
    await inbox.claim(later, now);
    await inbox.succeed(later.discordMessageId, now);

    expect(await cursorFor(user.discordUserId)).toBe(discordSnowflakeAt(failed.messageCreatedAt.getTime() - 1));
  });

  it("returns no cursor for an unlinked account", async () => {
    const user = await linkedUser();
    await db.update(discordUserLinks).set({ active: false }).where(eq(discordUserLinks.discordUserId, user.discordUserId));

    expect(await cursorFor(user.discordUserId)).toBeUndefined();
  });

  it("logs a downtime window into each company with linked engineers", async () => {
    const user = await linkedUser();

    await discordDmInbox(db).recordDowntime({
      startedAt: new Date("2026-11-08T02:00:00.000Z"),
      endedAt: new Date("2026-11-08T02:20:00.000Z"),
      cause: "paperclip_unreachable",
      affectedUsers: 1,
      replayedMessages: 3,
    });

    const rows = await db.select().from(activityLog).where(and(eq(activityLog.companyId, user.companyId), eq(activityLog.action, "discord.dm_downtime")));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorType: "system", entityType: "discord_bridge", entityId: "dm" });
    expect(rows[0]!.details).toMatchObject({ minutes: 20, cause: "paperclip_unreachable", affectedUsers: 1, replayedMessages: 3 });
  });
});
