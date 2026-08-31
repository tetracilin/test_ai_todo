import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("dotenv/config", () => ({}));

const REQUIRED_KEYS = ["DISCORD_BOT_TOKEN", "DISCORD_CLIENT_ID", "DISCORD_WEBHOOK_SECRET", "PAPERCLIP_API_URL", "PAPERCLIP_API_KEY"] as const;
const ORIGINAL_ENV = { ...process.env };

function setRequiredEnv() {
  process.env.DISCORD_BOT_TOKEN = "bot-token";
  process.env.DISCORD_CLIENT_ID = "client-id";
  process.env.DISCORD_WEBHOOK_SECRET = "webhook-secret";
  process.env.PAPERCLIP_API_URL = "https://paperclip.example/api/";
  process.env.PAPERCLIP_API_KEY = "api-key";
}

describe("discord bridge config", () => {
  beforeEach(() => {
    vi.resetModules();
    for (const key of REQUIRED_KEYS) delete process.env[key];
    for (const key of REQUIRED_KEYS) delete process.env[`${key}_FILE`];
    delete process.env.DISCORD_DEV_GUILD_ID;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("requires only Discord and bridge-scoped Paperclip credentials", async () => {
    setRequiredEnv();
    delete process.env.DISCORD_BOT_TOKEN;
    await expect(import("./config.js")).rejects.toThrow(/DISCORD_BOT_TOKEN/);
  });

  it("normalizes the integration API base URL", async () => {
    setRequiredEnv();
    const { config } = await import("./config.js");
    expect(config.paperclip.apiUrl).toBe("https://paperclip.example");
    expect(config.discord.devGuildId).toBeUndefined();
    expect(config.bridge.pollIntervalSeconds).toBe(30);
  });

  it("loads all Discord credentials from mounted secret files", async () => {
    setRequiredEnv();
    const directory = await mkdtemp(join(tmpdir(), "paperclip-discord-"));
    const tokenFile = join(directory, "bot-token");
    const clientIdFile = join(directory, "client-id");
    const webhookSecretFile = join(directory, "webhook-secret");
    await writeFile(tokenFile, "mounted-token\n");
    await writeFile(clientIdFile, "mounted-client-id\n");
    await writeFile(webhookSecretFile, "mounted-webhook-secret\n");
    delete process.env.DISCORD_BOT_TOKEN;
    delete process.env.DISCORD_CLIENT_ID;
    delete process.env.DISCORD_WEBHOOK_SECRET;
    process.env.DISCORD_BOT_TOKEN_FILE = tokenFile;
    process.env.DISCORD_CLIENT_ID_FILE = clientIdFile;
    process.env.DISCORD_WEBHOOK_SECRET_FILE = webhookSecretFile;

    const { config } = await import("./config.js");
    expect(config.discord.botToken).toBe("mounted-token");
    expect(config.discord.clientId).toBe("mounted-client-id");
    expect(config.discord.webhookSecret).toBe("mounted-webhook-secret");
  });
});