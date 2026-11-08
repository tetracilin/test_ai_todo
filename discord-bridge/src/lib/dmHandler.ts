import type { Message } from "discord.js";
import { DiscordIntegrationApiError, type DiscordIntegrationClient } from "./discordIntegrationClient.js";

export interface DirectMessageContext {
  paperclip: Pick<DiscordIntegrationClient, "sendDirectMessage">;
}

/**
 * What happened to one DM. `unavailable` means Paperclip could not be reached
 * (network error or 5xx): the message stays in Discord's DM history and the
 * replay (F-DM-3) picks it up. Every other failure is final for this delivery.
 */
export type DirectMessageOutcome = "ignored" | "unlinked" | "duplicate" | "answered" | "unavailable" | "failed";

export function isPaperclipUnavailable(error: unknown): boolean {
  return !(error instanceof DiscordIntegrationApiError) || error.status >= 500;
}

/**
 * F-DM-2 DM surface. Guild messages are never read or forwarded, even though the
 * MessageContent intent would deliver them: the bridge only acts on DMs. The
 * server owns every decision (who is linked, which attachments pass, what to
 * say, whether this message id was already answered); this handler forwards
 * metadata and posts the reply it gets back.
 */
export async function handleDirectMessage(
  ctx: DirectMessageContext,
  message: Message,
  opts: { replay?: boolean } = {},
): Promise<DirectMessageOutcome> {
  if (message.author.bot || message.guildId !== null) return "ignored";

  let result;
  try {
    result = await ctx.paperclip.sendDirectMessage({
      discordUserId: message.author.id,
      messageId: message.id,
      channelId: message.channelId,
      content: message.content,
      attachments: [...message.attachments.values()].map((attachment) => ({
        id: attachment.id,
        filename: attachment.name,
        contentType: attachment.contentType ?? null,
        size: attachment.size,
      })),
      messageCreatedAt: new Date(message.createdTimestamp).toISOString(),
      ...(opts.replay ? { replay: true } : {}),
    });
  } catch (error) {
    logFailure(message, error);
    return isPaperclipUnavailable(error) ? "unavailable" : "failed";
  }
  // Unlinked senders get no reply at all, so a stranger cannot probe the bot.
  if (!result.linked) return "unlinked";
  if (result.duplicate) return "duplicate";
  try {
    // The reply echoes engineer text (filenames, unknown phrases); never let it ping anyone.
    await message.reply({ content: result.reply, allowedMentions: { parse: [], repliedUser: false } });
    return "answered";
  } catch (error) {
    // Discord refused the reply. The server already settled the message, so a
    // replay would only be dropped as a duplicate: this is final.
    logFailure(message, error);
    return "failed";
  }
}

function logFailure(message: Message, error: unknown) {
  // Never log message content, filenames, or response bodies.
  console.error("discord_dm_failed", {
    messageId: message.id,
    code: error instanceof DiscordIntegrationApiError ? error.code : "unexpected_error",
  });
}
