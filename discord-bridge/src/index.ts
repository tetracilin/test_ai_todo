import { Client, Events, GatewayIntentBits } from "discord.js";
import { config } from "./config.js";
import { routeCommand } from "./commands/router.js";
import { DiscordIntegrationClient } from "./lib/discordIntegrationClient.js";
import { startDeliveryWorker } from "./lib/notifier.js";
import { startHealthServer } from "./health.js";

const paperclip = new DiscordIntegrationClient({
  apiUrl: config.paperclip.apiUrl,
  apiKey: config.paperclip.apiKey,
});

// Guilds is enough for application commands. This bridge intentionally does
// not read arbitrary user messages or request privileged message/member intents.
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Loopback readiness endpoint for container health checks. It reports ready
// only after the Discord gateway connection has been established.
let ready = false;
const healthServer = startHealthServer(config.bridge.healthPort, () => ready);

client.once(Events.ClientReady, (readyClient) => {
  ready = true;
  console.log("discord_bridge_ready", { applicationId: readyClient.application?.id });
  startDeliveryWorker(client, paperclip, config.bridge.pollIntervalSeconds);
});

client.on(Events.InteractionCreate, (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.user.bot) return;
  void routeCommand({ paperclip }, interaction);
});

client.login(config.discord.botToken).catch(() => {
  // Never log Discord credentials or error bodies; fail fast so the container
  // health check reports unhealthy and orchestration can restart the bridge.
  console.error("discord_bridge_login_failed");
  process.exit(1);
});

function shutdown() {
  ready = false;
  healthServer.close();
  client.destroy();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
