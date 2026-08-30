import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  artifacts,
  authUsers,
  companies,
  companyMemberships,
  createDb,
  documents,
  goals,
  issueDocuments,
  issues,
  projectMemberships,
  projectGoals,
  projects,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { projectRoutes } from "../routes/projects.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

function boardActor(companyId: string, userId: string): Express.Request["actor"] {
  return {
    type: "board",
    userId,
    source: "session",
    isInstanceAdmin: false,
    companyIds: [companyId],
    memberships: [{ companyId, membershipRole: "member", status: "active" }],
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

describeEmbeddedPostgres("project homepage routes", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-project-homepage-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(artifacts);
    await db.delete(issueDocuments);
    await db.delete(documents);
    await db.delete(issues);
    await db.delete(projectGoals);
    await db.delete(projectMemberships);
    await db.delete(projects);
    await db.delete(goals);
    await db.delete(companyMemberships);
    await db.delete(authUsers);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seed() {
    const companyId = randomUUID();
    const projectId = randomUUID();
    const goalId = randomUUID();
    const issueId = randomUUID();
    const documentId = randomUUID();
    const artifactId = randomUUID();
    const now = new Date("2026-08-30T00:00:00.000Z");

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(authUsers).values([
      { id: "member-1", name: "Ada", email: "ada@example.com", emailVerified: true, createdAt: now, updatedAt: now },
      { id: "member-2", name: "Lin", email: "lin@example.com", emailVerified: true, createdAt: now, updatedAt: now },
    ]);
    await db.insert(projects).values({
      id: projectId,
      companyId,
      name: "Website refresh",
      status: "in_progress",
      homepageConfig: {
        discordUrl: "https://discord.com/channels/1/2",
        whatsappUrl: "https://chat.whatsapp.com/example",
        resources: [{
          id: "resource-1",
          title: "Research brief",
          url: "https://docs.example.com/research",
          addedByUserId: "member-1",
          addedAt: now.toISOString(),
        }],
      },
    });
    await db.insert(goals).values({
      id: goalId,
      companyId,
      title: "Increase adoption",
      description: "Company goal",
      level: "company",
      status: "active",
    });
    await db.insert(projectGoals).values({ companyId, projectId, goalId });
    await db.insert(projectMemberships).values([
      { companyId, projectId, userId: "member-1", state: "joined" },
      { companyId, projectId, userId: "member-2", state: "left" },
    ]);
    await db.insert(companyMemberships).values([
      { companyId, principalType: "user", principalId: "member-1", status: "active", membershipRole: "member" },
      { companyId, principalType: "user", principalId: "member-2", status: "active", membershipRole: "member" },
    ]);
    await db.insert(issues).values({
      id: issueId,
      companyId,
      projectId,
      goalId,
      title: "Publish prototype",
      identifier: "PAP-1",
      status: "in_progress",
      createdByUserId: "member-1",
    });
    await db.insert(documents).values({
      id: documentId,
      companyId,
      title: "Requirements",
      latestBody: "Requirements body",
      createdByUserId: "member-1",
    });
    await db.insert(issueDocuments).values({ companyId, issueId, documentId, key: "requirements" });
    await db.insert(artifacts).values({
      id: artifactId,
      companyId,
      issueId,
      kind: "attachment",
      name: "prototype.png",
      contentType: "image/png",
      createdByUserId: "member-1",
    });

    return { artifactId, companyId, documentId, goalId, projectId };
  }

  it("returns project goals, resources, channels, documents, and artifacts to a joined member", async () => {
    const seeded = await seed();
    const app = createApp(db, boardActor(seeded.companyId, "member-1"));

    const res = await request(app).get(`/api/projects/${seeded.projectId}/homepage`);

    expect(res.status).toBe(200);
    expect(res.body.project).toEqual(expect.objectContaining({ id: seeded.projectId, name: "Website refresh" }));
    expect(res.body.resources).toEqual([
      expect.objectContaining({
        id: "resource-1",
        title: "Research brief",
        url: "https://docs.example.com/research",
        addedBy: { id: "member-1", name: "Ada" },
      }),
    ]);
    expect(res.body.channels).toEqual({
      discordUrl: "https://discord.com/channels/1/2",
      whatsappUrl: "https://chat.whatsapp.com/example",
    });
    expect(res.body.documents).toEqual([
      expect.objectContaining({ id: seeded.documentId, title: "Requirements", creator: { id: "member-1", name: "Ada" } }),
    ]);
    expect(res.body.artifacts).toEqual([
      expect.objectContaining({ id: seeded.artifactId, title: "prototype.png", creator: { id: "member-1", name: "Ada" } }),
    ]);
  });

  it("denies a project member who left", async () => {
    const seeded = await seed();
    const app = createApp(db, boardActor(seeded.companyId, "member-2"));

    const res = await request(app).get(`/api/projects/${seeded.projectId}/homepage`);

    expect(res.status).toBe(403);
  });

  it("lets a joined member add a safe resource and rejects unsafe URLs", async () => {
    const seeded = await seed();
    const app = createApp(db, boardActor(seeded.companyId, "member-1"));

    const created = await request(app)
      .post(`/api/projects/${seeded.projectId}/homepage/resources`)
      .send({ title: "Runbook", url: "https://docs.example.com/runbook" });
    const unsafe = await request(app)
      .post(`/api/projects/${seeded.projectId}/homepage/resources`)
      .send({ title: "Unsafe", url: "javascript:alert(1)" });
    const homepage = await request(app).get(`/api/projects/${seeded.projectId}/homepage`);

    expect(created.status).toBe(201);
    expect(created.body).toEqual(expect.objectContaining({ title: "Runbook", addedBy: { id: "member-1", name: "Ada" } }));
    expect(unsafe.status).toBe(400);
    expect(homepage.body.resources).toHaveLength(2);
  });

  it("lets a joined member configure safe channel links", async () => {
    const seeded = await seed();
    const app = createApp(db, boardActor(seeded.companyId, "member-1"));

    const res = await request(app)
      .patch(`/api/projects/${seeded.projectId}/homepage/channels`)
      .send({ discordUrl: "https://discord.gg/project", whatsappUrl: null });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ discordUrl: "https://discord.gg/project", whatsappUrl: null });
  });
});
