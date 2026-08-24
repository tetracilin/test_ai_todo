import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.PAPERCLIP_NETWORK_TEST_PORT ?? 3201);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: ".",
  testMatch: "no-legacy-provider-network.spec.ts",
  timeout: 30_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: BASE_URL,
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: `pnpm --filter @paperclipai/ui preview --host 127.0.0.1 --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  outputDir: "./test-results/network-guard",
  reporter: [["list"]],
});
