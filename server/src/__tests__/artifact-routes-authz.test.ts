import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type { Db } from "@paperclipai/db";
import type { StorageService } from "../storage/types.js";
import { errorHandler } from "../middleware/error-handler.js";
import { artifactRoutes } from "../routes/artifacts.js";
import { wopiRoutes } from "../routes/wopi.js";
import { createWopiSessionStore } from "../services/wopi.js";

function appForAgent(companyId: string) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = { type: "agent", agentId: "agent-1", companyId, source: "agent_api_key" };
    next();
  });
  const db = {} as Db;
  const storage = {} as StorageService;
  app.use("/api", artifactRoutes(db, storage, null));
  app.use("/api", wopiRoutes(db, storage, createWopiSessionStore()));
  app.use(errorHandler);
  return app;
}

function appForUser() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = { type: "board", userId: "user-1", source: "local_implicit" };
    next();
  });
  const db = {} as Db;
  const storage = {} as StorageService;
  app.use("/api", wopiRoutes(db, storage, createWopiSessionStore()));
  app.use(errorHandler);
  return app;
}

describe("artifact route company boundaries", () => {
  it("rejects cross-company artifact, version, comment, and external-object routes before resource access", async () => {
    const app = appForAgent("company-a");
    const denied = [
      request(app).get("/api/companies/company-b/artifacts/storage-sources"),
      request(app).get("/api/companies/company-b/artifacts/external/objects"),
      request(app).get("/api/companies/company-b/issues/issue-b/artifacts"),
      request(app).get("/api/companies/company-b/artifacts/artifact-b/versions"),
      request(app).get("/api/companies/company-b/artifacts/artifact-b/comments"),
      request(app).get("/api/companies/company-b/artifacts/artifact-b/versions/version-b/content"),
    ];

    for (const response of await Promise.all(denied)) {
      expect(response.status).toBe(403);
      expect(response.body.error).toBe("Agent key cannot access another company");
    }
  });

  it("rejects cross-company WOPI editor-session creation before artifact lookup", async () => {
    const response = await request(appForAgent("company-a"))
      .post("/api/companies/company-b/artifacts/artifact-b/editor-sessions")
      .send({});

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Agent key cannot access another company");
  });

  it("rejects blank or missing Office editor version names before artifact lookup", async () => {
    for (const body of [{}, { versionName: "   " }]) {
      const response = await request(appForUser())
        .post("/api/companies/company-a/artifacts/artifact-a/editor-sessions")
        .send(body);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("A non-empty version name is required for DOCX/XLSX saves");
    }
  });
});
