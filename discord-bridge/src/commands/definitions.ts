import { SlashCommandBuilder } from "discord.js";

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName("paperclip")
    .setDescription("Paperclip task commands")
    .addSubcommand((command) =>
      command
        .setName("link")
        .setDescription("Connect this Discord account to Paperclip with a one-time code")
        .addStringOption((option) => option.setName("code").setDescription("One-time code from Paperclip settings").setRequired(true)),
    )
    .addSubcommand((command) =>
      command.setName("unlink").setDescription("Disconnect this Discord account from Paperclip"),
    )
    .addSubcommandGroup((group) =>
      group
        .setName("task")
        .setDescription("Task commands")
        .addSubcommand((command) =>
          command
            .setName("create")
            .setDescription("Create a task in this channel's connected Paperclip project")
            .addStringOption((option) => option.setName("title").setDescription("Task title").setRequired(true))
            .addStringOption((option) => option.setName("description").setDescription("Task description"))
            .addStringOption((option) =>
              option
                .setName("priority")
                .setDescription("Task priority")
                .addChoices(
                  { name: "Low", value: "low" },
                  { name: "Medium", value: "medium" },
                  { name: "High", value: "high" },
                  { name: "Urgent", value: "urgent" },
                ),
            )
            .addStringOption((option) =>
              option.setName("assignee").setDescription("Paperclip user selector visible in this project"),
            ),
        ),
    ),
].map((builder) => builder.toJSON());