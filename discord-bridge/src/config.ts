import "dotenv/config";
import { readFileSync } from "node:fs";

function optional(name: string): string | undefined {
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

  return undefined;
}

function required(name: string): string {
  const resolved = optional(name);
  if (!resolved) {
    throw new Error(`Missing required env var ${name}. Set ${name} for local development or ${name}_FILE for a mounted secret.`);
  }
  return resolved;
}

export const config = {
  discord: {
    botToken: required("DISCORD_BOT_TOKEN"),
    clientId: required("DISCORD_CLIENT_ID"),
    webhookSecret: required("DISCORD_WEBHOOK_SECRET"),
    devGuildId: optional("DISCORD_DEV_GUILD_ID"),
  },
  paperclip: {
    apiUrl: required("PAPERCLIP_API_URL").replace(/\/+$/, "").replace(/\/api$/, ""),
    apiKey: required("PAPERCLIP_API_KEY"),
  },
  bridge: {
    pollIntervalSeconds: Math.max(1, Number(process.env.POLL_INTERVAL_SECONDS || 30)),
    healthPort: Math.max(1, Number(process.env.HEALTH_PORT || 8080)),
  },
};
