import { Client, Events, GatewayIntentBits } from "discord.js";
import { config } from "./config.js";
import { routeCommand } from "./commands/router.js";
import { DiscordIntegrationClient } from "./lib/discordIntegrationClient.js";
import { startDeliveryWorker } from "./lib/notifier.js";

const paperclip = new DiscordIntegrationClient({
  apiUrl: config.paperclip.apiUrl,
  apiKey: config.paperclip.apiKey,
});

// Guilds is enough for application commands. This bridge intentionally does
// not read arbitrary user messages or request privileged message/member intents.
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (readyClient) => {
  console.log("discord_bridge_ready", { applicationId: readyClient.application?.id });
  startDeliveryWorker(client, paperclip, config.bridge.pollIntervalSeconds);
});

client.on(Events.InteractionCreate, (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.user.bot) return;
  void routeCommand({ paperclip }, interaction);
});

client.login(config.discord.botToken);

function shutdown() {
  client.destroy();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);