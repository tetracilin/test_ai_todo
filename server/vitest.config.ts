import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Each server suite boots + tears down its own embedded Postgres in
    // beforeAll/afterAll. Under the loaded serial shard (maxWorkers=1) the
    // graceful shutdown can occasionally cross vitest's default 10s hookTimeout,
    // producing flaky "Hook timed out in 10000ms" afterAll failures on CI. Give
    // the boot/teardown hooks generous headroom; 30s is far above the observed
    // worst-case teardown yet still catches a genuinely hung hook. teardownTimeout
    // mirrors it for the same reason.
    hookTimeout: 30000,
    teardownTimeout: 30000,
    // Some route tests (e.g. document-annotation-routes.test.ts) call
    // vi.importActual on multi-thousand-line route modules from inside the
    // first test body rather than a hook. The one-time transform/JIT warm-up
    // for that import can cross vitest's default 5s testTimeout under a
    // loaded CI runner, timing out whichever test happens to run first in
    // the file even though the request itself resolves in milliseconds.
    // 20s is far above the observed worst-case cold start.
    testTimeout: 20000,
    isolate: true,
    maxConcurrency: 1,
    maxWorkers: 1,
    minWorkers: 1,
    pool: "forks",
    sequence: {
      concurrent: false,
      hooks: "list",
    },
    setupFiles: ["./src/__tests__/setup-supertest.ts"],
  },
});
