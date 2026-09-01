import { randomUUID } from "node:crypto";
import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.PAPERCLIP_E2E_PORT ?? 3104);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PAPERCLIP_E2E_HERMES_PORT = Number(process.env.PAPERCLIP_E2E_HERMES_PORT ?? 38643);
process.env.PAPERCLIP_E2E_HERMES_PORT = String(PAPERCLIP_E2E_HERMES_PORT);
process.env.PAPERCLIP_E2E_HERMES_API_KEY =
  process.env.PAPERCLIP_E2E_HERMES_API_KEY ?? `e2e-hermes-${randomUUID()}`;
process.env.PAPERCLIP_E2E_HERMES_API_BASE_URL =
  process.env.PAPERCLIP_E2E_HERMES_API_BASE_URL ?? `http://127.0.0.1:${PAPERCLIP_E2E_HERMES_PORT}/api`;

export default defineConfig({
  testDir: ".",
  testMatch: "multi-user.spec.ts",
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: BASE_URL,
    headless: true,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
  // No webServer — expects an already-running server at BASE_URL.
  outputDir: "./test-results",
  reporter: [["list"], ["html", { open: "never", outputFolder: "./playwright-report" }]],
});
