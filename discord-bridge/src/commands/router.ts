import { ChatInputCommandInteraction } from "discord.js";
import {
  HandlerContext,
  handleApprove,
  handleCreate,
  handleLink,
  handlePlate,
  handleReject,
  handleReply,
  handleStatus,
  handleUnlink,
} from "../lib/handlers.js";

export async function routeCommand(ctx: HandlerContext, interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: false });
  try {
    const reply = await dispatch(ctx, interaction);
    await interaction.editReply(reply);
  } catch (err) {
    console.error(`/${interaction.commandName} failed:`, err);
    await interaction.editReply("Something went wrong talking to Paperclip. Try again in a moment.");
  }
}

async function dispatch(ctx: HandlerContext, interaction: ChatInputCommandInteraction): Promise<string> {
  const userId = interaction.user.id;
  const channelId = interaction.channelId;
  switch (interaction.commandName) {
    case "link":
      return handleLink(ctx, userId, channelId, interaction.options.getString("paperclip_user_id", true));
    case "unlink":
      return handleUnlink(ctx, userId);
    case "plate":
      return handlePlate(ctx, userId);
    case "status":
      return handleStatus(ctx, userId, interaction.options.getString("issue", true));
    case "reply":
      return handleReply(
        ctx,
        userId,
        interaction.user.username,
        interaction.options.getString("issue", true),
        interaction.options.getString("message", true),
      );
    case "approve":
      return handleApprove(ctx, userId, interaction.options.getString("issue", true));
    case "reject":
      return handleReject(
        ctx,
        userId,
        interaction.options.getString("issue", true),
        interaction.options.getString("reason") ?? undefined,
      );
    case "create":
      return handleCreate(
        ctx,
        userId,
        interaction.options.getString("title", true),
        interaction.options.getString("description") ?? undefined,
      );
    default:
      return `Unknown command /${interaction.commandName}`;
  }
}
