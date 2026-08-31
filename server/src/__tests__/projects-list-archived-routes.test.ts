import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { companies, createDb, projects } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { projectRoutes } from "../routes/projects.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres project list archived tests on this host: ${
      embeddedPostgresSupport.reason ?? "unsupported environment"
    }`,
  );
}

function boardActor(companyId: string): Express.Request["actor"] {
  return {
    type: "board",
    userId: "user-1",
    source: "session",
    isInstanceAdmin: true,
    companyIds: [companyId],
    memberships: [{ companyId, membershipRole: "admin", status: "active" }],
  };
}

function createApp(db: ReturnType<typeof createDb>, actor: Express.Request["actor"]) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api", projectRoutes(db));
  app.use(errorHandler);
  return app;
}

describeEmbeddedPostgres("project list archived route defaults", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-projects-list-archived-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(projects);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seed() {
    const companyId = randomUUID();
    const activeProjectId = randomUUID();
    const archivedProjectId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(projects).values([
      { id: activeProjectId, companyId, name: "Active Project", status: "in_progress" },
      {
        id: archivedProjectId,
        companyId,
        name: "Archived Project",
        status: "completed",
        archivedAt: new Date(),
      },
    ]);

    return { activeProjectId, archivedProjectId, companyId };
  }

  it("omits archived projects by default", async () => {
    const { activeProjectId, archivedProjectId, companyId } = await seed();
    const app = createApp(db, boardActor(companyId));

    const res = await request(app).get(`/api/companies/${companyId}/projects`);

    expect(res.status).toBe(200);
    expect(res.body.map((project: { id: string }) => project.id)).toEqual([activeProjectId]);
    expect(res.body.map((project: { id: string }) => project.id)).not.toContain(archivedProjectId);
  });

  it("includes archived projects when includeArchived is true", async () => {
    const { activeProjectId, archivedProjectId, companyId } = await seed();
    const app = createApp(db, boardActor(companyId));

    const res = await request(app).get(`/api/companies/${companyId}/projects?includeArchived=true`);

    expect(res.status).toBe(200);
    expect(res.body.map((project: { id: string }) => project.id)).toEqual([activeProjectId, archivedProjectId]);
  });

  // Regression: the list query previously had no ORDER BY, so Postgres was free to
  // return any row order and this route's responses were unstable.
  it("sorts archived projects last even when they were created first", async () => {
    const companyId = randomUUID();
    const archivedProjectId = randomUUID();
    const activeProjectId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    // The archived project is the oldest row, so ordering on `createdAt` alone would
    // place it first. Archived projects must still sort after active ones.
    await db.insert(projects).values([
      {
        id: archivedProjectId,
        companyId,
        name: "Archived Project",
        status: "completed",
        createdAt: new Date("2020-01-01T00:00:00.000Z"),
        archivedAt: new Date("2020-02-01T00:00:00.000Z"),
      },
      {
        id: activeProjectId,
        companyId,
        name: "Active Project",
        status: "in_progress",
        createdAt: new Date("2024-01-01T00:00:00.000Z"),
      },
    ]);

    const app = createApp(db, boardActor(companyId));
    const res = await request(app).get(`/api/companies/${companyId}/projects?includeArchived=true`);

    expect(res.status).toBe(200);
    expect(res.body.map((project: { id: string }) => project.id)).toEqual([
      activeProjectId,
      archivedProjectId,
    ]);
  });

  it("returns a stable order for projects sharing a createdAt timestamp", async () => {
    const companyId = randomUUID();
    // Rows inserted in a single statement share `now()`, so `createdAt` cannot break
    // the tie on its own; `id` has to close the total order.
    const sharedCreatedAt = new Date("2024-05-05T00:00:00.000Z");
    const projectIds = [randomUUID(), randomUUID(), randomUUID()];

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(projects).values(
      projectIds.map((id, index) => ({
        id,
        companyId,
        name: `Project ${index}`,
        status: "in_progress",
        createdAt: sharedCreatedAt,
      })),
    );

    const app = createApp(db, boardActor(companyId));
    const expectedOrder = [...projectIds].sort();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const res = await request(app).get(`/api/companies/${companyId}/projects`);

      expect(res.status).toBe(200);
      expect(res.body.map((project: { id: string }) => project.id)).toEqual(expectedOrder);
    }
  });
});
