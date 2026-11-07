import type { Message } from "discord.js";
import { DiscordIntegrationApiError, type DiscordIntegrationClient } from "./discordIntegrationClient.js";

export interface DirectMessageContext {
  paperclip: Pick<DiscordIntegrationClient, "sendDirectMessage">;
}

/**
 * F-DM-2 DM surface. Guild messages are never read or forwarded, even though the
 * MessageContent intent would deliver them: the bridge only acts on DMs. The
 * server owns every decision (who is linked, which attachments pass, what to
 * say); this handler forwards metadata and posts the reply it gets back.
 */
export async function handleDirectMessage(ctx: DirectMessageContext, message: Message): Promise<void> {
  if (message.author.bot || message.guildId !== null) return;

  try {
    const result = await ctx.paperclip.sendDirectMessage({
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
    });
    // Unlinked senders get no reply at all, so a stranger cannot probe the bot.
    if (!result.linked) return;
    // The reply echoes engineer text (filenames, unknown phrases); never let it ping anyone.
    await message.reply({ content: result.reply, allowedMentions: { parse: [], repliedUser: false } });
  } catch (error) {
    // Never log message content, filenames, or response bodies.
    console.error("discord_dm_failed", {
      messageId: message.id,
      code: error instanceof DiscordIntegrationApiError ? error.code : "unexpected_error",
    });
  }
}
