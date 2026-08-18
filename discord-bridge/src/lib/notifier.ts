import type { Client, TextBasedChannel } from "discord.js";
import { HandlerContext } from "./handlers.js";
import { issueUrl } from "./issueUrl.js";

/**
 * Polling-based inbound notifier. Paperclip has no outbound webhook for issue
 * events reachable by a standalone service, so this bridge polls each linked
 * user's Mine inbox and diffs against locally-stored watch state to detect:
 *   - status changes
 *   - new comments (any author — agent or human, dashboard or chat)
 *   - newly-opened pending interactions (e.g. request_confirmation)
 *
 * First poll after a link only establishes a baseline; it does not notify,
 * so linking doesn't dump the user's entire history into Discord.
 */
export function startNotifier(
  client: Client,
  ctx: HandlerContext,
  pollIntervalSeconds: number,
): NodeJS.Timeout {
  const tick = () => {
    pollOnce(client, ctx).catch((err) => console.error("notifier poll failed:", err));
  };
  tick();
  return setInterval(tick, pollIntervalSeconds * 1000);
}

export async function pollOnce(client: Client, ctx: HandlerContext): Promise<void> {
  const links = ctx.store.getAllLinks();
  for (const link of links) {
    if (!link.notifyChannelId) continue;
    let issues;
    try {
      issues = await ctx.paperclip.getMineInbox(link.paperclipUserId);
    } catch (err) {
      console.error(`notifier: failed to fetch Mine inbox for ${link.paperclipUserId}:`, err);
      continue;
    }

    for (const issue of issues) {
      const prior = ctx.store.getWatchState(link.discordUserId, issue.id);
      const interactions = await ctx.paperclip
        .listInteractions(issue.id)
        .catch(() => [] as Awaited<ReturnType<typeof ctx.paperclip.listInteractions>>);
      const pendingIds = interactions.filter((i) => i.status === "pending").map((i) => i.id);

      const comments = await ctx.paperclip.getComments(issue.id, { order: "desc" }).catch(() => []);
      const latestCommentId = comments[0]?.id ?? null;

      if (!prior) {
        // Baseline only — don't notify on first sight of an issue.
        ctx.store.upsertWatchState({
          discordUserId: link.discordUserId,
          issueId: issue.id,
          lastStatus: issue.status,
          lastCommentId: latestCommentId,
          lastSeenInteractionIds: pendingIds,
          updatedAt: new Date().toISOString(),
        });
        continue;
      }

      const messages: string[] = [];
      const url = issueUrl(issue.identifier, ctx.issuePrefix, ctx.dashboardUrl);

      if (prior.lastStatus !== issue.status) {
        messages.push(`**${issue.identifier}** changed status: \`${prior.lastStatus}\` → \`${issue.status}\` — <${url}>`);
      }

      if (latestCommentId && latestCommentId !== prior.lastCommentId) {
        const newComments = prior.lastCommentId
          ? await ctx.paperclip
              .getComments(issue.id, { after: prior.lastCommentId, order: "asc" })
              .catch(() => [])
          : [];
        for (const c of newComments) {
          const author = c.authorAgentId ? "agent" : c.onBehalfOfUserId || c.authorUserId ? "human" : "system";
          const body = c.body.length > 300 ? `${c.body.slice(0, 300)}…` : c.body;
          messages.push(`**${issue.identifier}** new comment [${author}]: ${body} — <${url}>`);
        }
      }

      const newPendingIds = pendingIds.filter((id) => !prior.lastSeenInteractionIds.includes(id));
      for (const id of newPendingIds) {
        const interaction = interactions.find((i) => i.id === id);
        messages.push(
          `**${issue.identifier}** has a new pending ${interaction?.kind ?? "interaction"}: ${interaction?.title ?? ""} — <${url}>`,
        );
      }

      if (messages.length > 0) {
        await sendToChannel(client, link.notifyChannelId, messages.join("\n"));
      }

      ctx.store.upsertWatchState({
        discordUserId: link.discordUserId,
        issueId: issue.id,
        lastStatus: issue.status,
        lastCommentId: latestCommentId,
        lastSeenInteractionIds: pendingIds,
        updatedAt: new Date().toISOString(),
      });
    }
  }
}

async function sendToChannel(client: Client, channelId: string, content: string): Promise<void> {
  const channel = (await client.channels.fetch(channelId).catch(() => null)) as TextBasedChannel | null;
  if (!channel || !("send" in channel)) {
    console.error(`notifier: channel ${channelId} not found or not sendable`);
    return;
  }
  await channel.send(content);
}
