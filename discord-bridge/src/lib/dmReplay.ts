import type { Message } from "discord.js";
import type { DiscordDmDowntime, DiscordDmReplayPlan, DiscordIntegrationClient } from "./discordIntegrationClient.js";
import { handleDirectMessage, type DirectMessageOutcome } from "./dmHandler.js";

/** Matches the WP-0 retry promise "mình sẽ thử lại trong 5 phút" in the downtime notice. */
export const DM_RETRY_INTERVAL_MS = 5 * 60 * 1000;
/** An outage longer than this earns each affected engineer one status message. */
export const DM_DOWNTIME_NOTICE_AFTER_MS = 15 * 60 * 1000;
const REPLAY_PAGE_SIZE = 100;
const REPLAY_MAX_PAGES = 10;
const NO_MENTIONS = { parse: [] as [] };
const VIETNAM_TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh" });

type DowntimeCause = DiscordDmDowntime["cause"];

interface DmChannelLike {
  messages: { fetch(options: { after: string; limit: number }): Promise<{ values(): Iterable<Message> }> };
  send(options: { content: string; allowedMentions: typeof NO_MENTIONS }): Promise<unknown>;
}

export interface DmRecoveryContext {
  client: { users: { createDM(userId: string): Promise<DmChannelLike> } };
  paperclip: Pick<DiscordIntegrationClient, "sendDirectMessage" | "getDmReplayPlan" | "reportDmDowntime">;
  now?: () => number;
}

interface Outage {
  since: number;
  cause: DowntimeCause;
  /** Engineers whose live DM could not be handed to Paperclip. */
  affected: Set<string>;
  notified: Set<string>;
}

/**
 * F-DM-3 inbound persistence and replay. Discord's DM history is the durable
 * copy of every message, so nothing is lost while Paperclip, the gateway, or
 * this process is down: a sweep re-reads each linked engineer's DMs after the
 * server's cursor and resubmits them, and the server's ledger answers each
 * message id once. A sweep runs at startup, after the gateway reconnects with a
 * fresh session, and every five minutes while Paperclip is unreachable.
 */
export class DmRecovery {
  private outage: Outage | null = null;
  private statusMessages: DiscordDmReplayPlan["statusMessages"] | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private sweeping: Promise<void> | null = null;
  private pendingSweep: DowntimeCause | null = null;
  private stopped = false;

  constructor(private readonly ctx: DmRecoveryContext) {}

  private now() {
    return this.ctx.now?.() ?? Date.now();
  }

  /** Handles a DM delivered live by the gateway. */
  async handleLive(message: Message): Promise<DirectMessageOutcome> {
    const outcome = await handleDirectMessage(this.ctx, message);
    if (outcome === "unavailable") {
      this.markOutage("paperclip_unreachable", message.author.id);
      await this.notifyDowntime();
    }
    return outcome;
  }

  /** The gateway dropped; events missed from here on are only in DM history. */
  gatewayDisconnected() {
    this.markOutage("gateway_disconnected");
  }

  /** A resumed session replays missed events itself, so a gateway-only outage needs no sweep. */
  gatewayResumed() {
    if (this.outage?.cause !== "gateway_disconnected" || this.outage.affected.size > 0) return;
    this.outage = null;
    this.clearRetry();
  }

  stop() {
    this.stopped = true;
    this.clearRetry();
  }

  /** Runs one replay sweep; a request during a sweep queues exactly one more. */
  sweep(cause: DowntimeCause): Promise<void> {
    if (this.sweeping) {
      this.pendingSweep ??= cause;
      return this.sweeping;
    }
    this.sweeping = this.runSweep(cause).finally(() => {
      this.sweeping = null;
      const next = this.pendingSweep;
      this.pendingSweep = null;
      if (next && !this.stopped) void this.sweep(next);
    });
    return this.sweeping;
  }

  private markOutage(cause: DowntimeCause, discordUserId?: string) {
    this.outage ??= { since: this.now(), cause, affected: new Set(), notified: new Set() };
    if (discordUserId) this.outage.affected.add(discordUserId);
    this.scheduleRetry();
  }

  private scheduleRetry() {
    if (this.retryTimer || this.stopped) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.sweep(this.outage?.cause ?? "paperclip_unreachable");
    }, DM_RETRY_INTERVAL_MS);
  }

  private clearRetry() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  /** One status message per affected engineer per outage, once it passes 15 minutes. */
  private async notifyDowntime() {
    const outage = this.outage;
    if (!outage || !this.statusMessages || this.now() - outage.since < DM_DOWNTIME_NOTICE_AFTER_MS) return;
    const since = VIETNAM_TIME.format(new Date(outage.since));
    for (const discordUserId of outage.affected) {
      if (outage.notified.has(discordUserId)) continue;
      outage.notified.add(discordUserId);
      await this.sendStatus(discordUserId, this.statusMessages.downtime.replaceAll("{{since}}", since));
    }
  }

  private async sendStatus(discordUserId: string, content: string) {
    try {
      const channel = await this.ctx.client.users.createDM(discordUserId);
      await channel.send({ content, allowedMentions: NO_MENTIONS });
    } catch {
      console.error("discord_dm_status_failed");
    }
  }

  private async runSweep(cause: DowntimeCause) {
    let plan: DiscordDmReplayPlan;
    try {
      plan = await this.ctx.paperclip.getDmReplayPlan();
    } catch {
      console.error("discord_dm_replay_unavailable");
      this.markOutage("paperclip_unreachable");
      await this.notifyDowntime();
      return;
    }
    // Cached so the downtime notice can still be sent while Paperclip is down.
    this.statusMessages = plan.statusMessages;

    let replayed = 0;
    let oldestReplayedAt: number | null = null;
    let unavailable = false;
    const affected = new Set(this.outage?.affected ?? []);
    for (const cursor of plan.cursors) {
      const result = await this.replayUser(cursor.discordUserId, cursor.afterMessageId);
      if (result.answered > 0) {
        replayed += result.answered;
        affected.add(cursor.discordUserId);
        oldestReplayedAt = Math.min(oldestReplayedAt ?? result.oldestAt!, result.oldestAt!);
        await this.sendStatus(cursor.discordUserId, plan.statusMessages.recovered.replaceAll("{{count}}", String(result.answered)));
      }
      // Keep going: other engineers' replays may still succeed, and this one
      // resumes from the server's cursor on the next sweep.
      if (result.unavailable) unavailable = true;
    }
    if (unavailable) {
      this.markOutage("paperclip_unreachable");
      await this.notifyDowntime();
      return;
    }

    const outage = this.outage;
    const endedAt = this.now();
    const startedAt = Math.min(outage?.since ?? endedAt, oldestReplayedAt ?? endedAt);
    // A reconnect blip that cost nobody a message is not pilot downtime.
    if (replayed > 0 || endedAt - startedAt >= DM_DOWNTIME_NOTICE_AFTER_MS) {
      await this.ctx.paperclip.reportDmDowntime({
        startedAt: new Date(startedAt).toISOString(),
        endedAt: new Date(endedAt).toISOString(),
        cause: outage?.cause ?? cause,
        affectedUsers: affected.size,
        replayedMessages: replayed,
      }).catch(() => console.error("discord_dm_downtime_report_failed"));
    }
    this.outage = null;
    this.clearRetry();
  }

  private async replayUser(discordUserId: string, afterMessageId: string) {
    const result = { answered: 0, oldestAt: null as number | null, unavailable: false };
    let channel: DmChannelLike;
    try {
      channel = await this.ctx.client.users.createDM(discordUserId);
    } catch {
      console.error("discord_dm_replay_channel_failed");
      return result;
    }
    let after = afterMessageId;
    for (let page = 0; page < REPLAY_MAX_PAGES; page += 1) {
      let batch: Message[];
      try {
        batch = [...(await channel.messages.fetch({ after, limit: REPLAY_PAGE_SIZE })).values()];
      } catch {
        console.error("discord_dm_replay_fetch_failed");
        return result;
      }
      // Discord returns a page newest-first; answer in the order it was sent.
      batch.sort((left, right) => (BigInt(left.id) < BigInt(right.id) ? -1 : 1));
      for (const message of batch) {
        if (message.author.id !== discordUserId) continue;
        const outcome = await handleDirectMessage(this.ctx, message, { replay: true });
        if (outcome === "unavailable") {
          result.unavailable = true;
          return result;
        }
        if (outcome === "answered") {
          result.answered += 1;
          result.oldestAt = Math.min(result.oldestAt ?? message.createdTimestamp, message.createdTimestamp);
        }
      }
      if (batch.length < REPLAY_PAGE_SIZE) break;
      after = batch[batch.length - 1]!.id;
    }
    return result;
  }
}
