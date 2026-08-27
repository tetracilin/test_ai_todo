import { defineConfig } from "@playwright/test";

// Extra regression coverage on the shared company-prefix route code path,
// against the already-running throwaway server (fixed UI build) on 3101.
export default defineConfig({
  testDir: ".",
  testMatch: ["sidebar-takeover.spec.ts", "onboarding.spec.ts"],
  timeout: 120_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3101",
    headless: true,
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  outputDir: "./test-results-extra",
  reporter: [["list"]],
});
