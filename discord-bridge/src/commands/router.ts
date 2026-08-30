import type { ChatInputCommandInteraction } from "discord.js";
import type { DiscordIntegrationClient } from "../lib/discordIntegrationClient.js";
import { createTaskFromDiscord } from "../lib/taskCreate.js";

export interface CommandContext {
  paperclip: DiscordIntegrationClient;
}

export async function routeCommand(ctx: CommandContext, interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  try {
    const reply = await dispatch(ctx, interaction);
    await interaction.editReply(reply);
  } catch {
    // Do not write Discord command options, response bodies, credentials, or
    // other request contents to logs. The interaction ID is safe correlation.
    console.error("discord_command_failed", { interactionId: interaction.id, command: interaction.commandName });
    await interaction.editReply("Paperclip could not process this command. Try again in a moment.");
  }
}

async function dispatch(ctx: CommandContext, interaction: ChatInputCommandInteraction): Promise<string> {
  if (
    interaction.commandName !== "paperclip" ||
    interaction.options.getSubcommandGroup() !== "task" ||
    interaction.options.getSubcommand() !== "create"
  ) {
    return "Unknown Paperclip command.";
  }

  const channel = interaction.channel;
  const parentChannelId = channel?.isThread() ? channel.parentId : null;
  return createTaskFromDiscord(ctx, {
    discordInteractionId: interaction.id,
    discordUserId: interaction.user.id,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    parentChannelId,
    commandName: "paperclip task create",
    title: interaction.options.getString("title", true),
    description: interaction.options.getString("description") ?? undefined,
    priority: (interaction.options.getString("priority") ?? undefined) as
      | "low"
      | "medium"
      | "high"
      | "urgent"
      | undefined,
  });
}