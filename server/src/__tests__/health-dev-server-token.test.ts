import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import { healthRoutes } from "../routes/health.js";

const tempDirs: string[] = [];

function createDevServerStatusFile(payload: unknown) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "paperclip-health-dev-server-"));
  tempDirs.push(dir);
  const filePath = path.join(dir, "dev-server-status.json");
  writeFileSync(filePath, `${JSON.stringify(payload)}\n`, "utf8");
  return filePath;
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("GET /health dev-server supervisor access", () => {
  it("exposes dev-server metadata to the supervising dev runner in authenticated mode", async () => {
    const previousFile = process.env.PAPERCLIP_DEV_SERVER_STATUS_FILE;
    const previousToken = process.env.PAPERCLIP_DEV_SERVER_STATUS_TOKEN;
    process.env.PAPERCLIP_DEV_SERVER_STATUS_FILE = createDevServerStatusFile({
      dirty: true,
      lastChangedAt: "2026-03-20T12:00:00.000Z",
      changedPathCount: 1,
      changedPathsSample: ["server/src/routes/health.ts"],
      pendingMigrations: [],
      lastRestartAt: "2026-03-20T11:30:00.000Z",
    });
    process.env.PAPERCLIP_DEV_SERVER_STATUS_TOKEN = "dev-runner-token";

    let selectCall = 0;
    const db = {
      execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
      select: vi.fn(() => {
        selectCall += 1;
        if (selectCall === 1) {
          return {
            from: vi.fn(() => ({
              where: vi.fn().mockResolvedValue([{ count: 1 }]),
            })),
          };
        }
        if (selectCall === 2) {
          return {
            from: vi.fn(() => ({
              where: vi.fn().mockResolvedValue([
                {
                  id: "settings-1",
                  general: {},
                  experimental: { autoRestartDevServerWhenIdle: true },
                  createdAt: new Date("2026-03-20T11:00:00.000Z"),
                  updatedAt: new Date("2026-03-20T11:00:00.000Z"),
                },
              ]),
            })),
          };
        }
        return {
          from: vi.fn(() => ({
            where: vi.fn().mockResolvedValue([{ count: 0 }]),
          })),
        };
      }),
    } as unknown as Db;

    try {
      const app = express();
      app.use((req, _res, next) => {
        (req as any).actor = { type: "none", source: "none" };
        next();
      });
      app.use(
        "/health",
        healthRoutes(db, {
          deploymentMode: "authenticated",
          deploymentExposure: "private",
          authReady: true,
          companyDeletionEnabled: true,
          // Pin server info so the commit field is deterministic (null)
          // instead of picking up the checkout's real git metadata.
          serverInfo: {
            processStartedAt: "2026-03-20T11:00:00.000Z",
            git: { available: false, unavailableReason: "git_unavailable" },
          },
        }),
      );

      const res = await request(app)
        .get("/health")
        .set("X-Paperclip-Dev-Server-Status-Token", "dev-runner-token");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        status: "ok",
        deploymentMode: "authenticated",
        deploymentExposure: "private",
        commit: null,
        bootstrapStatus: "ready",
        bootstrapInviteActive: false,
        devServer: {
          enabled: true,
          restartRequired: true,
          reason: "backend_changes",
          lastChangedAt: "2026-03-20T12:00:00.000Z",
          changedPathCount: 1,
          changedPathsSample: ["server/src/routes/health.ts"],
          pendingMigrations: [],
          autoRestartEnabled: true,
          activeRunCount: 0,
          waitingForIdle: false,
          lastRestartAt: "2026-03-20T11:30:00.000Z",
        },
      });
    } finally {
      if (previousFile === undefined) {
        delete process.env.PAPERCLIP_DEV_SERVER_STATUS_FILE;
      } else {
        process.env.PAPERCLIP_DEV_SERVER_STATUS_FILE = previousFile;
      }
      if (previousToken === undefined) {
        delete process.env.PAPERCLIP_DEV_SERVER_STATUS_TOKEN;
      } else {
        process.env.PAPERCLIP_DEV_SERVER_STATUS_TOKEN = previousToken;
      }
    }
  });
});

describe("POST /health/dev-server/restart", () => {
  it("records a manual restart request for the dev runner", async () => {
    const previousFile = process.env.PAPERCLIP_DEV_SERVER_STATUS_FILE;
    process.env.PAPERCLIP_DEV_SERVER_STATUS_FILE = createDevServerStatusFile({
      dirty: true,
      lastChangedAt: "2026-03-20T12:00:00.000Z",
      changedPathCount: 1,
      changedPathsSample: ["server/src/routes/health.ts"],
      pendingMigrations: [],
      lastRestartAt: "2026-03-20T11:30:00.000Z",
    });

    try {
      const app = express();
      app.use("/health", healthRoutes(undefined));

      const res = await request(app).post("/health/dev-server/restart");

      expect(res.status).toBe(202);
      expect(res.body).toEqual({ status: "restart_requested" });

      const requestPath = path.join(
        path.dirname(process.env.PAPERCLIP_DEV_SERVER_STATUS_FILE),
        "dev-server-restart-request.json",
      );
      expect(existsSync(requestPath)).toBe(true);
      expect(JSON.parse(readFileSync(requestPath, "utf8"))).toMatchObject({
        reason: "manual_restart_now",
      });
    } finally {
      if (previousFile === undefined) {
        delete process.env.PAPERCLIP_DEV_SERVER_STATUS_FILE;
      } else {
        process.env.PAPERCLIP_DEV_SERVER_STATUS_FILE = previousFile;
      }
    }
  });

  it("rejects unauthenticated manual restarts in authenticated mode", async () => {
    const previousFile = process.env.PAPERCLIP_DEV_SERVER_STATUS_FILE;
    process.env.PAPERCLIP_DEV_SERVER_STATUS_FILE = createDevServerStatusFile({
      dirty: true,
      changedPathCount: 1,
      changedPathsSample: ["server/src/routes/health.ts"],
      pendingMigrations: [],
    });

    try {
      const app = express();
      app.use((req, _res, next) => {
        (req as any).actor = { type: "none", source: "none" };
        next();
      });
      app.use(
        "/health",
        healthRoutes(undefined, {
          deploymentMode: "authenticated",
          deploymentExposure: "private",
          authReady: true,
          companyDeletionEnabled: true,
        }),
      );

      const res = await request(app).post("/health/dev-server/restart");

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "board_access_required" });
    } finally {
      if (previousFile === undefined) {
        delete process.env.PAPERCLIP_DEV_SERVER_STATUS_FILE;
      } else {
        process.env.PAPERCLIP_DEV_SERVER_STATUS_FILE = previousFile;
      }
    }
  });
});

describe("GET /health dev-server token rejection", () => {
  it("keeps dev-server metadata redacted when the supervisor token is wrong or missing", async () => {
    vi.stubEnv(
      "PAPERCLIP_DEV_SERVER_STATUS_FILE",
      createDevServerStatusFile({
        dirty: true,
        lastChangedAt: "2026-03-20T12:00:00.000Z",
        changedPathCount: 1,
        changedPathsSample: ["server/src/routes/health.ts"],
        pendingMigrations: [],
        lastRestartAt: null,
      }),
    );
    vi.stubEnv("PAPERCLIP_DEV_SERVER_STATUS_TOKEN", "dev-runner-token");
    const db = {
      execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([{ count: 1 }]),
        })),
      })),
    } as unknown as Db;
    const app = express();
    app.use((req, _res, next) => {
      (req as any).actor = { type: "none", source: "none" };
      next();
    });
    app.use(
      "/health",
      healthRoutes(db, {
        deploymentMode: "authenticated",
        deploymentExposure: "private",
        authReady: true,
        companyDeletionEnabled: true,
        serverInfo: {
          processStartedAt: "2026-03-20T11:00:00.000Z",
          git: { available: false, unavailableReason: "git_unavailable" },
        },
      }),
    );

    const wrong = await request(app).get("/health").set("X-Paperclip-Dev-Server-Status-Token", "not-the-token");
    const missing = await request(app).get("/health");

    for (const res of [wrong, missing]) {
      expect(res.status).toBe(200);
      expect(res.body.devServer).toBeUndefined();
      expect(res.body.serverInfo).toBeUndefined();
    }
  });
});

describe("POST /health/dev-server/restart preconditions", () => {
  it("answers 404 when no dev-server supervisor status file is configured", async () => {
    vi.stubEnv("PAPERCLIP_DEV_SERVER_STATUS_FILE", "");
    const app = express();
    app.use("/health", healthRoutes(undefined));

    const res = await request(app).post("/health/dev-server/restart");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "dev_server_supervisor_unavailable" });
  });

  it("answers 409 and writes no request when no restart is required", async () => {
    const statusFile = createDevServerStatusFile({
      dirty: false,
      lastChangedAt: null,
      changedPathCount: 0,
      changedPathsSample: [],
      pendingMigrations: [],
      lastRestartAt: null,
    });
    vi.stubEnv("PAPERCLIP_DEV_SERVER_STATUS_FILE", statusFile);
    const app = express();
    app.use("/health", healthRoutes(undefined));

    const res = await request(app).post("/health/dev-server/restart");

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "restart_not_required" });
    expect(existsSync(path.join(path.dirname(statusFile), "dev-server-restart-request.json"))).toBe(false);
  });
});

