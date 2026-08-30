import { SlashCommandBuilder } from "discord.js";

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName("paperclip")
    .setDescription("Paperclip task commands")
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
        ),
    ),
].map((builder) => builder.toJSON());