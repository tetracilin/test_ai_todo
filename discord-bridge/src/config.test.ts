import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// config.ts side-effect-imports "dotenv/config", which would otherwise reload
// the real (gitignored) discord-bridge/.env and repopulate any env vars this
// test deliberately deletes below. Stub it so process.env stays test-controlled.
vi.mock("dotenv/config", () => ({}));

const REQUIRED_KEYS = [
  "DISCORD_BOT_TOKEN",
  "DISCORD_CLIENT_ID",
  "PAPERCLIP_API_URL",
  "PAPERCLIP_COMPANY_ID",
  "PAPERCLIP_API_KEY",
] as const;

const ORIGINAL_ENV = { ...process.env };

function setRequiredEnv() {
  process.env.DISCORD_BOT_TOKEN = "bot-token";
  process.env.DISCORD_CLIENT_ID = "client-id";
  process.env.PAPERCLIP_API_URL = "https://paperclip.example/api/";
  process.env.PAPERCLIP_COMPANY_ID = "company-1";
  process.env.PAPERCLIP_API_KEY = "api-key";
}

describe("discord-bridge config", () => {
  beforeEach(() => {
    vi.resetModules();
    for (const key of REQUIRED_KEYS) delete process.env[key];
    delete process.env.PAPERCLIP_ISSUE_PREFIX;
    delete process.env.PAPERCLIP_DASHBOARD_URL;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("throws a clear error when a required env var is missing", async () => {
    setRequiredEnv();
    delete process.env.DISCORD_BOT_TOKEN;
    await expect(import("./config.js")).rejects.toThrow(/Missing required env var DISCORD_BOT_TOKEN/);
  });

  it("strips trailing slashes and a trailing /api suffix from the Paperclip API URL", async () => {
    setRequiredEnv();
    const { config } = await import("./config.js");
    expect(config.paperclip.apiUrl).toBe("https://paperclip.example");
  });

  it("defaults the issue prefix to T and dashboard URL to the API URL", async () => {
    setRequiredEnv();
    const { config } = await import("./config.js");
    expect(config.paperclip.issuePrefix).toBe("T");
    expect(config.paperclip.dashboardUrl).toBe("https://paperclip.example/api");
  });

  it("loadPartialConfig reports undefined for unset optional vars instead of throwing", async () => {
    // Note: importing config.js at all requires the full required-env set (the
    // `config` export computes eagerly at module load and would throw
    // otherwise), so this exercises loadPartialConfig's own defaulting logic
    // for the vars it treats as optional, not a fully-empty environment.
    setRequiredEnv();
    const { loadPartialConfig } = await import("./config.js");
    const partial = loadPartialConfig();
    expect(partial.discord.devGuildId).toBeUndefined();
    expect(partial.paperclip.issuePrefix).toBe("T");
    expect(partial.bridge.pollIntervalSeconds).toBe(30);
  });
});
