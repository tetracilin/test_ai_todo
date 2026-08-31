import "dotenv/config";
import { readFileSync } from "node:fs";

function required(name: string): string {
  const value = process.env[name];
  if (value) return value;

  const file = process.env[`${name}_FILE`];
  if (file) {
    try {
      const secret = readFileSync(file, "utf8").trim();
      if (secret) return secret;
    } catch {
      // Report the variable name only; never expose secret-file paths or contents.
    }
  }

  throw new Error(`Missing required env var ${name}. Set ${name} for local development or ${name}_FILE for a mounted secret.`);
}

export const config = {
  discord: {
    botToken: required("DISCORD_BOT_TOKEN"),
    clientId: required("DISCORD_CLIENT_ID"),
    webhookSecret: required("DISCORD_WEBHOOK_SECRET"),
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