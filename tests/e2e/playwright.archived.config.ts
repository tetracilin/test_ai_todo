import { defineConfig } from "@playwright/test";

// Runs the existing archived-company-url routing spec against the already
// running throwaway server (fixed UI build) on 3101, as extra regression
// coverage on the shared company-prefix route code path.
export default defineConfig({
  testDir: ".",
  testMatch: "**/archived-company-url.spec.ts",
  timeout: 120_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3101",
    headless: true,
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  outputDir: "./test-results-archived",
  reporter: [["list"]],
});
