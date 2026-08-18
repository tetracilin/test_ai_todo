import { SlashCommandBuilder } from "discord.js";

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName("link")
    .setDescription("Link this Discord account to your Paperclip user account")
    .addStringOption((opt) =>
      opt.setName("paperclip_user_id").setDescription("Your Paperclip user id").setRequired(true),
    ),
  new SlashCommandBuilder().setName("unlink").setDescription("Unlink this Discord account from Paperclip"),
  new SlashCommandBuilder().setName("plate").setDescription("List issues assigned to or owned by you"),
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Show an issue's status and latest comments")
    .addStringOption((opt) =>
      opt.setName("issue").setDescription('Issue identifier, e.g. "T-10"').setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("reply")
    .setDescription("Post a comment on an issue as yourself")
    .addStringOption((opt) =>
      opt.setName("issue").setDescription('Issue identifier, e.g. "T-10"').setRequired(true),
    )
    .addStringOption((opt) => opt.setName("message").setDescription("Comment body").setRequired(true)),
  new SlashCommandBuilder()
    .setName("approve")
    .setDescription("Approve the latest pending confirmation on an issue")
    .addStringOption((opt) =>
      opt.setName("issue").setDescription('Issue identifier, e.g. "T-10"').setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("reject")
    .setDescription("Reject the latest pending confirmation on an issue")
    .addStringOption((opt) =>
      opt.setName("issue").setDescription('Issue identifier, e.g. "T-10"').setRequired(true),
    )
    .addStringOption((opt) => opt.setName("reason").setDescription("Why? (shown to the assignee)")),
  new SlashCommandBuilder()
    .setName("create")
    .setDescription("Create a new Paperclip issue, assigned to you")
    .addStringOption((opt) => opt.setName("title").setDescription("Issue title").setRequired(true))
    .addStringOption((opt) => opt.setName("description").setDescription("Issue description")),
].map((builder) => builder.toJSON());
