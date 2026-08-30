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
    apiKey: required("PAPERCLIP_API_KEY"),
  },
  bridge: {
    pollIntervalSeconds: Math.max(1, Number(process.env.POLL_INTERVAL_SECONDS || 30)),
  },
};