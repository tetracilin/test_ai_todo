import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("dotenv/config", () => ({}));

const REQUIRED_KEYS = ["DISCORD_BOT_TOKEN", "DISCORD_CLIENT_ID", "PAPERCLIP_API_URL", "PAPERCLIP_API_KEY"] as const;
const ORIGINAL_ENV = { ...process.env };

function setRequiredEnv() {
  process.env.DISCORD_BOT_TOKEN = "bot-token";
  process.env.DISCORD_CLIENT_ID = "client-id";
  process.env.PAPERCLIP_API_URL = "https://paperclip.example/api/";
  process.env.PAPERCLIP_API_KEY = "api-key";
}

describe("discord bridge config", () => {
  beforeEach(() => {
    vi.resetModules();
    for (const key of REQUIRED_KEYS) delete process.env[key];
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
});