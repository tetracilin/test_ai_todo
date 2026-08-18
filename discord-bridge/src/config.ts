import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

export const config = {
  discord: {
    botToken: required("DISCORD_BOT_TOKEN"),
    clientId: required("DISCORD_CLIENT_ID"),
    devGuildId: process.env.DISCORD_DEV_GUILD_ID || undefined,
  },
  paperclip: {
    apiUrl: required("PAPERCLIP_API_URL").replace(/\/+$/, "").replace(/\/api$/, ""),
    companyId: required("PAPERCLIP_COMPANY_ID"),
    apiKey: required("PAPERCLIP_API_KEY"),
    issuePrefix: process.env.PAPERCLIP_ISSUE_PREFIX || "T",
    dashboardUrl: (process.env.PAPERCLIP_DASHBOARD_URL || process.env.PAPERCLIP_API_URL || "").replace(
      /\/+$/,
      "",
    ),
  },
  bridge: {
    dbPath: process.env.BRIDGE_DB_PATH || "./data/bridge-store.json",
    pollIntervalSeconds: Number(process.env.POLL_INTERVAL_SECONDS || 30),
  },
};

export { issueUrl } from "./lib/issueUrl.js";

/** Same shape as `config`, but never throws — for tools (e.g. smoke tests) that only need a subset. */
export function loadPartialConfig() {
  return {
    discord: {
      botToken: process.env.DISCORD_BOT_TOKEN,
      clientId: process.env.DISCORD_CLIENT_ID,
      devGuildId: process.env.DISCORD_DEV_GUILD_ID,
    },
    paperclip: {
      apiUrl: (process.env.PAPERCLIP_API_URL || "").replace(/\/+$/, "").replace(/\/api$/, ""),
      companyId: process.env.PAPERCLIP_COMPANY_ID,
      apiKey: process.env.PAPERCLIP_API_KEY,
      issuePrefix: process.env.PAPERCLIP_ISSUE_PREFIX || "T",
    },
    bridge: {
      dbPath: process.env.BRIDGE_DB_PATH || "./data/bridge-store.json",
      pollIntervalSeconds: Number(process.env.POLL_INTERVAL_SECONDS || 30),
    },
  };
}
