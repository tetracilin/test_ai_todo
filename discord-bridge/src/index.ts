import { Client, Events, GatewayIntentBits, Partials } from "discord.js";
import { config } from "./config.js";
import { routeCommand } from "./commands/router.js";
import { DiscordIntegrationClient } from "./lib/discordIntegrationClient.js";
import { DmRecovery } from "./lib/dmReplay.js";
import { startDeliveryWorker } from "./lib/notifier.js";
import { startHealthServer } from "./health.js";

const paperclip = new DiscordIntegrationClient({
  apiUrl: config.paperclip.apiUrl,
  apiKey: config.paperclip.apiKey,
});

// Guilds serves application commands. DirectMessages + MessageContent serve the
// WP-0 DM surface (F-DM-2); MessageContent is privileged and must be enabled in
// the Developer Portal, or DMs arrive with empty content. Guild messages are
// dropped unread by handleDirectMessage. Partials.Channel is required for
// discord.js to emit messageCreate for DM channels it has not cached.
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel],
});

// Loopback readiness endpoint for container health checks. It reports ready
// only after the Discord gateway connection has been established.
let ready = false;
const healthServer = startHealthServer(config.bridge.healthPort, () => ready);

// F-DM-3: DMs missed while this process, the gateway, or Paperclip was down are
// re-read from Discord's DM history and replayed once.
const dmRecovery = new DmRecovery({ client, paperclip });

client.once(Events.ClientReady, (readyClient) => {
  ready = true;
  console.log("discord_bridge_ready", { applicationId: readyClient.application?.id });
  startDeliveryWorker(client, paperclip, config.bridge.pollIntervalSeconds);
  void dmRecovery.sweep("bridge_restarted");
});

client.on(Events.ShardDisconnect, () => dmRecovery.gatewayDisconnected());
client.on(Events.ShardReconnecting, () => dmRecovery.gatewayDisconnected());
client.on(Events.ShardResume, () => dmRecovery.gatewayResumed());
// A fresh session after the first ready means events were lost, not resumed.
client.on(Events.ShardReady, () => {
  if (ready) void dmRecovery.sweep("gateway_disconnected");
});

client.on(Events.InteractionCreate, (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.user.bot) return;
  void routeCommand({ paperclip }, interaction);
});

client.on(Events.MessageCreate, (message) => {
  void dmRecovery.handleLive(message);
});

client.login(config.discord.botToken).catch(() => {
  // Never log Discord credentials or error bodies; fail fast so the container
  // health check reports unhealthy and orchestration can restart the bridge.
  console.error("discord_bridge_login_failed");
  process.exit(1);
});

function shutdown() {
  ready = false;
  dmRecovery.stop();
  healthServer.close();
  client.destroy();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
