import { REST, Routes } from "discord.js";
import { config } from "./config.js";
import { commandDefinitions } from "./commands/definitions.js";

/**
 * One-time (or per-deploy) registration of slash commands with Discord.
 * Run via `npm run register-commands`. Scoped to DISCORD_DEV_GUILD_ID when set
 * (instant propagation), otherwise registered globally (~1h propagation).
 */
async function main() {
  const rest = new REST({ version: "10" }).setToken(config.discord.botToken);
  const route = config.discord.devGuildId
    ? Routes.applicationGuildCommands(config.discord.clientId, config.discord.devGuildId)
    : Routes.applicationCommands(config.discord.clientId);

  const result = (await rest.put(route, { body: commandDefinitions })) as unknown[];
  console.log(`Registered ${result.length} slash commands${config.discord.devGuildId ? " (dev guild)" : " (global)"}.`);
}

main().catch((err) => {
  console.error("Failed to register commands:", err);
  process.exit(1);
});
