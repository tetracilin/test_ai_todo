import { Client, Events, GatewayIntentBits } from "discord.js";
import { config } from "./config.js";
import { PaperclipClient } from "./lib/paperclipClient.js";
import { LinkStore } from "./lib/linkStore.js";
import { HandlerContext } from "./lib/handlers.js";
import { routeCommand } from "./commands/router.js";
import { startNotifier } from "./lib/notifier.js";

const paperclip = new PaperclipClient({
  apiUrl: config.paperclip.apiUrl,
  apiKey: config.paperclip.apiKey,
  companyId: config.paperclip.companyId,
});
const store = new LinkStore(config.bridge.dbPath);
const ctx: HandlerContext = {
  paperclip,
  store,
  issuePrefix: config.paperclip.issuePrefix,
  dashboardUrl: config.paperclip.dashboardUrl,
};

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (c) => {
  console.log(`Discord bridge online as ${c.user.tag}`);
  startNotifier(client, ctx, config.bridge.pollIntervalSeconds);
});

client.on(Events.InteractionCreate, (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  void routeCommand(ctx, interaction);
});

client.login(config.discord.botToken);

function shutdown() {
  console.log("Shutting down...");
  store.close();
  client.destroy();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
