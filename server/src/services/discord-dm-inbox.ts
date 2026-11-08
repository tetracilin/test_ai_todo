import { and, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { discordDmInboundMessages, discordUserLinks } from "@paperclipai/db";
import { logActivity } from "./activity-log.js";

// F-DM-3 inbound DM ledger. Discord's DM history is the durable copy of every
// message; this ledger only records which message ids were processed, so the
// bridge can replay what it missed and the server processes each one once.

/** A `processing` claim older than this is treated as a crashed attempt and may be re-claimed. */
export const DM_CLAIM_STALE_MS = 2 * 60 * 1000;
/**
 * A message that has failed this many times is left alone: it no longer holds
 * the replay cursor back, so one poison message cannot stall an engineer's
 * replay or keep the bridge retrying forever.
 */
export const DM_MAX_ATTEMPTS = 5;
/** Replay never reaches further back than this, whatever the ledger says. */
export const DM_REPLAY_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/**
 * Replay re-reads this far behind the newest processed message. A message the
 * bridge never delivered can sit before a later one that succeeded; re-reading
 * costs only duplicate answers, which the claim absorbs.
 */
export const DM_REPLAY_LOOKBACK_MS = 30 * 60 * 1000;

const DISCORD_EPOCH_MS = 1_420_070_400_000n;

/** The smallest Discord snowflake at `ms`; "after" it means "created at or after `ms`". */
export function discordSnowflakeAt(ms: number): string {
  return ((BigInt(Math.max(0, Math.floor(ms))) - DISCORD_EPOCH_MS) << 22n).toString();
}

export type DmClaimResult = { claimed: true } | { claimed: false };

export function discordDmInbox(db: Db) {
  return {
    /**
     * Claims a message for processing. A new id, a `failed` id, or a stale
     * `processing` id is claimed while it has attempts left; a succeeded,
     * in-flight or exhausted id is a duplicate.
     * One statement, so a live delivery racing its own replay cannot both win.
     */
    async claim(input: { companyId: string; discordUserId: string; discordMessageId: string; channelId: string; messageCreatedAt: Date }, now = new Date()): Promise<DmClaimResult> {
      const staleBefore = new Date(now.getTime() - DM_CLAIM_STALE_MS);
      const rows = await db.insert(discordDmInboundMessages)
        .values({ ...input, status: "processing", attempts: 1, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: discordDmInboundMessages.discordMessageId,
          set: { status: "processing", attempts: sql`${discordDmInboundMessages.attempts} + 1`, errorCode: null, updatedAt: now },
          setWhere: and(
            lt(discordDmInboundMessages.attempts, DM_MAX_ATTEMPTS),
            or(
              eq(discordDmInboundMessages.status, "failed"),
              and(eq(discordDmInboundMessages.status, "processing"), lt(discordDmInboundMessages.updatedAt, staleBefore)),
            ),
          ),
        })
        .returning({ id: discordDmInboundMessages.id });
      return rows.length > 0 ? { claimed: true } : { claimed: false };
    },

    async succeed(discordMessageId: string, now = new Date()) {
      await db.update(discordDmInboundMessages).set({ status: "succeeded", errorCode: null, updatedAt: now }).where(eq(discordDmInboundMessages.discordMessageId, discordMessageId));
    },

    /** Releases the claim: the next delivery of this id (replay or retry) is processed again. */
    async fail(discordMessageId: string, errorCode: string, now = new Date()) {
      await db.update(discordDmInboundMessages).set({ status: "failed", errorCode, updatedAt: now }).where(eq(discordDmInboundMessages.discordMessageId, discordMessageId));
    },

    /** One replay cursor per actively linked Discord user: replay messages after `afterMessageId`. */
    async replayCursors(now = new Date()): Promise<Array<{ discordUserId: string; afterMessageId: string }>> {
      const nowMs = now.getTime();
      const links = await db.select({ discordUserId: discordUserLinks.discordUserId, linkedAt: discordUserLinks.linkedAt }).from(discordUserLinks).where(eq(discordUserLinks.active, true));
      if (links.length === 0) return [];
      const linkedSince = new Map<string, number>();
      for (const link of links) {
        const at = link.linkedAt.getTime();
        linkedSince.set(link.discordUserId, Math.min(linkedSince.get(link.discordUserId) ?? at, at));
      }
      const windowStart = new Date(nowMs - DM_REPLAY_MAX_AGE_MS);
      const rows = await db.select({
        discordUserId: discordDmInboundMessages.discordUserId,
        status: discordDmInboundMessages.status,
        attempts: discordDmInboundMessages.attempts,
        messageCreatedAt: discordDmInboundMessages.messageCreatedAt,
        updatedAt: discordDmInboundMessages.updatedAt,
      }).from(discordDmInboundMessages).where(and(
        inArray(discordDmInboundMessages.discordUserId, [...linkedSince.keys()]),
        gte(discordDmInboundMessages.messageCreatedAt, windowStart),
      ));

      return [...linkedSince].map(([discordUserId, linkedAtMs]) => {
        let oldestUnsettledMs: number | null = null;
        let newestSucceededMs: number | null = null;
        for (const row of rows) {
          if (row.discordUserId !== discordUserId) continue;
          const createdMs = row.messageCreatedAt.getTime();
          const unsettled = row.attempts < DM_MAX_ATTEMPTS
            && (row.status === "failed" || (row.status === "processing" && nowMs - row.updatedAt.getTime() >= DM_CLAIM_STALE_MS));
          if (unsettled) oldestUnsettledMs = Math.min(oldestUnsettledMs ?? createdMs, createdMs);
          else if (row.status === "succeeded") newestSucceededMs = Math.max(newestSucceededMs ?? createdMs, createdMs);
        }
        // An unsettled message must be re-read itself; otherwise re-read the
        // lookback behind the newest success; with no history, everything since linking.
        const fromMs = oldestUnsettledMs !== null
          ? oldestUnsettledMs - 1
          : newestSucceededMs !== null ? newestSucceededMs - DM_REPLAY_LOOKBACK_MS : 0;
        const floorMs = Math.max(windowStart.getTime(), linkedAtMs);
        return { discordUserId, afterMessageId: discordSnowflakeAt(Math.max(floorMs, fromMs)) };
      });
    },

    /**
     * Logs a DM outage window into every company with an active Discord link,
     * so the pilot's band call can discount downtime the engineers did not cause.
     */
    async recordDowntime(input: { startedAt: Date; endedAt: Date; cause: string; affectedUsers: number; replayedMessages: number }) {
      const rows = await db.selectDistinct({ companyId: discordUserLinks.companyId }).from(discordUserLinks).where(eq(discordUserLinks.active, true));
      const minutes = Math.max(0, Math.round((input.endedAt.getTime() - input.startedAt.getTime()) / 60_000));
      for (const { companyId } of rows) {
        await logActivity(db, {
          companyId,
          actorType: "system",
          actorId: "discord-bridge",
          action: "discord.dm_downtime",
          entityType: "discord_bridge",
          entityId: "dm",
          details: {
            startedAt: input.startedAt.toISOString(),
            endedAt: input.endedAt.toISOString(),
            minutes,
            cause: input.cause,
            affectedUsers: input.affectedUsers,
            replayedMessages: input.replayedMessages,
          },
        });
      }
      return { companies: rows.length };
    },
  };
}
