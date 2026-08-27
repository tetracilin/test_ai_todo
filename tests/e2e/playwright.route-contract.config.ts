import { defineConfig } from "@playwright/test";

// Points at the already-running throwaway Paperclip server (fixed UI build)
// booted on 3101 for this QA task. No webServer directive: the instance is
// managed externally so the embedded-postgres data dir can be pre-seeded with
// postgres-owned permissions (host runs as root).
export default defineConfig({
  testDir: ".",
  testMatch: "**/company-route-contract.spec.ts",
  timeout: 90_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3101",
    headless: true,
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
  outputDir: "./test-results-route-contract",
  reporter: [["list"]],
});
