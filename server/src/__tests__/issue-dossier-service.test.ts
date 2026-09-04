import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agents,
  assets,
  companies,
  createDb,
  documentRevisions,
  documents,
  externalObjects,
  issueAttachments,
  issueDocuments,
  issueEvidenceLinks,
  issueThreadInteractions,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";
import { createStorageService } from "../storage/service.js";
import type { StorageProvider, PutObjectInput, GetObjectInput, GetObjectResult, HeadObjectResult, ListObjectsInput, ListObjectsResult } from "../storage/types.js";
import { issueService } from "../services/issues.js";
import { issueThreadInteractionService } from "../services/issue-thread-interactions.js";
import {
  ISSUE_DOSSIER_DOCUMENT_KEY,
  issueDossierService,
  parseClarifications,
  parseDossierMarkdown,
  parseEvidenceLog,
  parseScopeChanges,
  queryScopeChangeTimestamps,
} from "../services/issue-dossier.js";

const dossierControl = vi.hoisted(() => ({ failNext: false }));

vi.mock("../services/issue-dossier.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/issue-dossier.js")>();
  return {
    ...actual,
    issueDossierService: (db: Parameters<typeof actual.issueDossierService>[0]) => {
      const real = actual.issueDossierService(db);
      return {
        ...real,
        appendEvidenceLine: async (...args: Parameters<typeof real.appendEvidenceLine>) => {
          if (dossierControl.failNext) {
            dossierControl.failNext = false;
            throw new Error("dossier append failed (test)");
          }
          return real.appendEvidenceLine(...args);
        },
      };
    },
  };
});

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;
if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres dossier tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("issue dossier (PC-002 F-002-1/2/3)", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db: ReturnType<typeof createDb>;
  let svc: ReturnType<typeof issueService>;
  let dossierSvc: ReturnType<typeof issueDossierService>;
  let interactionSvc: ReturnType<typeof issueThreadInteractionService>;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-issue-dossier-");
    db = createDb(tempDb.connectionString);
    svc = issueService(db);
    dossierSvc = issueDossierService(db);
    interactionSvc = issueThreadInteractionService(db);
  }, 30_000);

  afterEach(async () => {
    dossierControl.failNext = false;
    await db.delete(issueThreadInteractions);
    await db.delete(issueEvidenceLinks);
    await db.delete(issueAttachments);
    await db.delete(activityLog);
    await db.delete(documentRevisions);
    await db.delete(issueDocuments);
    await db.delete(documents);
    await db.delete(issues);
    await db.delete(externalObjects);
    await db.delete(assets);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  let issueCounter = 0;

  async function seedCompany(overrides: Partial<typeof companies.$inferInsert> = {}) {
    const companyId = randomUUID();
    const prefix = `DS${companyId.replaceAll("-", "").slice(0, 6).toUpperCase()}`;
    await db.insert(companies).values({
      id: companyId,
      name: "Dossier Co",
      issuePrefix: prefix,
      requireBoardApprovalForNewAgents: false,
      ...overrides,
    });
    return { companyId, prefix };
  }

  async function seedIssueDirect(
    companyId: string,
    prefix: string,
    overrides: Partial<typeof issues.$inferInsert> = {},
  ) {
    issueCounter += 1;
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: `Dossier issue ${issueCounter}`,
      description: "Original job order description.",
      status: "todo",
      priority: "medium",
      issueNumber: issueCounter,
      identifier: `${prefix}-${issueCounter}`,
      ...overrides,
    });
    return issueId;
  }

  async function seedAgent(companyId: string) {
    const id = randomUUID();
    await db.insert(agents).values({
      id,
      companyId,
      name: "Field agent",
      role: "engineer",
      status: "idle",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    return id;
  }

  function createFakeStorageProvider(): StorageProvider {
    const objects = new Map<string, Buffer>();
    return {
      id: "local_disk",
      async putObject(input: PutObjectInput) {
        const body = input.body instanceof Buffer ? input.body : Buffer.concat(await collectStream(input.body));
        objects.set(input.objectKey, body);
      },
      async getObject(input: GetObjectInput): Promise<GetObjectResult> {
        const body = objects.get(input.objectKey);
        if (!body) throw new Error("not found");
        const { Readable } = await import("node:stream");
        return { stream: Readable.from(body), contentLength: body.length };
      },
      async headObject(input: GetObjectInput): Promise<HeadObjectResult> {
        const body = objects.get(input.objectKey);
        return body ? { exists: true, contentLength: body.length } : { exists: false };
      },
      async deleteObject(input: GetObjectInput) {
        objects.delete(input.objectKey);
      },
      async listObjects(_input: ListObjectsInput): Promise<ListObjectsResult> {
        return { objects: [], truncated: false };
      },
    };
  }

  async function collectStream(stream: NodeJS.ReadableStream): Promise<Buffer[]> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return chunks;
  }

  function createApp(actor: any = { type: "board", source: "local_implicit" }) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).actor = actor;
      next();
    });
    app.use("/api", issueRoutes(db, createStorageService(createFakeStorageProvider()), {}));
    app.use(errorHandler);
    return app;
  }

  async function getDossier(issueId: string) {
    const result = await dossierSvc.get(issueId);
    return result?.document ?? null;
  }

  // -- F-002-1: create-on-intake.

  it("issueService(db).create() seeds a dossier with all five headings", async () => {
    const { companyId } = await seedCompany();
    const issue = await svc.create(companyId, {
      title: "Fix the pump",
      description: "Pump P-12 is leaking.",
      status: "todo",
      priority: "medium",
    } as any);

    const document = await getDossier(issue.id);
    expect(document).not.toBeNull();
    expect(document!.title).toBe("Fix the pump");
    expect(document!.sections["Job order"]).toBe("Pump P-12 is leaking.");
    expect(document!.sections["Clarifications"]).toBe("");
    expect(document!.sections["Evidence log"]).toBe("");
    expect(document!.sections["Scope changes"]).toBe("");
    expect(document!.sections["Related Teable rows"]).toBe("");
  });

  it("falls back to the title as the job order when the issue has no description", async () => {
    const { companyId } = await seedCompany();
    const issue = await svc.create(companyId, {
      title: "Bare card with no description",
      status: "todo",
      priority: "medium",
    } as any);

    const document = await getDossier(issue.id);
    expect(document!.sections["Job order"]).toBe("Bare card with no description");
  });

  it("a dedup hit (idempotencyKey) returns the existing issue and does not error re-seeding", async () => {
    const { companyId } = await seedCompany();
    const idempotencyKey = randomUUID();
    const first = await svc.create(companyId, {
      title: "Dedup me",
      status: "todo",
      priority: "medium",
      idempotencyKey,
    } as any);
    const second = await svc.create(companyId, {
      title: "Dedup me",
      status: "todo",
      priority: "medium",
      idempotencyKey,
    } as any);

    expect(second.id).toBe(first.id);
    const documents_ = await db.select().from(documents);
    // Exactly one dossier document exists for the one real issue -- the dedup path never
    // attempted a second seed.
    expect(documents_).toHaveLength(1);
  });

  // -- F-002-2: evidence-log hooks (both filing tables).

  it("POST /issues/:id/evidence-links appends exactly one Evidence-log line", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssueDirect(companyId, prefix);
    const app = createApp();

    const res = await request(app).post(`/api/issues/${issueId}/evidence-links`).send({
      providerKey: "teable",
      objectType: "row",
      externalId: "tbl1/rec1",
      displayTitle: "Nghiem thu ket qua",
    });
    expect(res.status).toBe(201);

    const document = await getDossier(issueId);
    const lines = parseEvidenceLog(document!);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ providerKey: "teable", ref: "tbl1/rec1", caption: "Nghiem thu ket qua" });
  });

  it("re-filing the same evidence (idempotent, created:false) does not append a second line", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssueDirect(companyId, prefix);
    const app = createApp();
    const body = { providerKey: "teable", objectType: "row", externalId: "tbl1/rec1" };

    await request(app).post(`/api/issues/${issueId}/evidence-links`).send(body);
    await request(app).post(`/api/issues/${issueId}/evidence-links`).send(body);

    const document = await getDossier(issueId);
    expect(parseEvidenceLog(document!)).toHaveLength(1);
  });

  it("an uploaded attachment appends an Evidence-log line under its own synthetic provider key", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssueDirect(companyId, prefix);
    const app = createApp();

    const res = await request(app)
      .post(`/api/companies/${companyId}/issues/${issueId}/attachments`)
      .attach("file", Buffer.from("hello"), { filename: "photo.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(201);

    const document = await getDossier(issueId);
    const lines = parseEvidenceLog(document!);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ providerKey: "attachment", caption: "photo.jpg" });
  });

  it("two concurrent evidence links on the same card both survive as two lines (retry-on-conflict)", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssueDirect(companyId, prefix);
    const app = createApp();

    const [a, b] = await Promise.all([
      request(app)
        .post(`/api/issues/${issueId}/evidence-links`)
        .send({ providerKey: "teable", objectType: "row", externalId: "tbl1/recA" }),
      request(app)
        .post(`/api/issues/${issueId}/evidence-links`)
        .send({ providerKey: "teable", objectType: "row", externalId: "tbl1/recB" }),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    const document = await getDossier(issueId);
    const lines = parseEvidenceLog(document!);
    expect(lines).toHaveLength(2);
    expect(new Set(lines.map((line) => line.ref))).toEqual(new Set(["tbl1/recA", "tbl1/recB"]));
  });

  it("a dossier-append failure does not fail or roll back the evidence link itself", async () => {
    const { companyId } = await seedCompany();
    const issue = await svc.create(companyId, {
      title: "Card with a dossier already seeded",
      status: "todo",
      priority: "medium",
    } as any);
    const app = createApp();
    dossierControl.failNext = true;

    const res = await request(app).post(`/api/issues/${issue.id}/evidence-links`).send({
      providerKey: "teable",
      objectType: "row",
      externalId: "tbl1/rec1",
    });

    expect(res.status).toBe(201);
    expect(await db.select().from(issueEvidenceLinks)).toHaveLength(1);
    // The dossier was already seeded at create() time; the append attempt failed (injected) and
    // left it with zero evidence lines rather than failing the evidence-link request itself.
    const document = await getDossier(issue.id);
    expect(document).not.toBeNull();
    expect(parseEvidenceLog(document!)).toHaveLength(0);
  });

  // -- F-002-2: clarification-answer hook.

  it("answering an ask_user_questions interaction appends a Clarifications line", async () => {
    const { companyId, prefix } = await seedCompany();
    const agentId = await seedAgent(companyId);
    const issueId = await seedIssueDirect(companyId, prefix);
    const issue = { id: issueId, companyId };

    const interaction = await interactionSvc.create(
      issue,
      {
        kind: "ask_user_questions",
        payload: {
          version: 1,
          questions: [
            {
              id: "q1",
              prompt: "Which environment is affected?",
              selectionMode: "single",
              options: [
                { id: "opt-prod", label: "Production" },
                { id: "opt-staging", label: "Staging" },
              ],
            },
          ],
        },
      } as any,
      { agentId },
    );

    const app = createApp();
    const res = await request(app)
      .post(`/api/issues/${issueId}/interactions/${interaction.id}/respond`)
      .send({ answers: [{ questionId: "q1", optionIds: ["opt-prod"] }] });

    expect(res.status).toBe(200);
    const document = await getDossier(issueId);
    const lines = parseClarifications(document!);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ question: "Which environment is affected?", answer: "Production" });
  });

  // -- F-002-2: scope-change route (not best-effort) + comment mirror.

  it("POST /issues/:id/dossier/scope-changes appends a line and mirrors an issue comment", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssueDirect(companyId, prefix);
    const app = createApp();

    const res = await request(app)
      .post(`/api/issues/${issueId}/dossier/scope-changes`)
      .send({ note: "Scope expanded to cover pump P-13 too." });

    expect(res.status).toBe(201);
    const document = await getDossier(issueId);
    const lines = parseScopeChanges(document!);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.note).toBe("Scope expanded to cover pump P-13 too.");

    const comments = await svc.listComments(issueId);
    expect(comments.some((comment: any) => comment.body.includes("Scope expanded to cover pump P-13 too."))).toBe(true);
  });

  // -- F-002-3: scope-change timestamp query.

  it("queryScopeChangeTimestamps reports the first-signal timestamp per card, company-scoped", async () => {
    const { companyId, prefix } = await seedCompany();
    const other = await seedCompany();
    const issueId = await seedIssueDirect(companyId, prefix);
    const otherIssueId = await seedIssueDirect(other.companyId, other.prefix);
    const app = createApp();

    await request(app).post(`/api/issues/${issueId}/dossier/scope-changes`).send({ note: "First change." });
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await request(app).post(`/api/issues/${issueId}/dossier/scope-changes`).send({ note: "Second change." });
    await request(app).post(`/api/issues/${otherIssueId}/dossier/scope-changes`).send({ note: "Other company." });

    const results = await queryScopeChangeTimestamps(db, { companyId });
    expect(results).toHaveLength(1);
    expect(results[0]!.issueId).toBe(issueId);
    expect(results[0]!.count).toBe(2);

    const document = await getDossier(issueId);
    const [firstLine] = parseScopeChanges(document!);
    expect(results[0]!.firstScopeChangeAt).toBe(firstLine!.at);
  });

  it("queryScopeChangeTimestamps filters entries to the [from, to] window", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssueDirect(companyId, prefix);
    const app = createApp();
    await request(app).post(`/api/issues/${issueId}/dossier/scope-changes`).send({ note: "Too early." });

    const results = await queryScopeChangeTimestamps(db, {
      companyId,
      from: new Date(Date.now() + 60_000),
    });
    expect(results).toHaveLength(0);
  });

  // -- Round-trip: the persisted body still parses through the module's own grammar.

  it("a seeded and appended-to dossier round-trips through parseDossierMarkdown/renderDossierMarkdown", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssueDirect(companyId, prefix);
    const app = createApp();
    await request(app)
      .post(`/api/issues/${issueId}/evidence-links`)
      .send({ providerKey: "teable", objectType: "row", externalId: "tbl1/rec1" });

    const row = await db
      .select({ body: documents.latestBody })
      .from(issueDocuments)
      .innerJoin(documents, eq(issueDocuments.documentId, documents.id))
      .where(and(eq(issueDocuments.issueId, issueId), eq(issueDocuments.key, ISSUE_DOSSIER_DOCUMENT_KEY)))
      .then((rows) => rows[0]!);

    const document = parseDossierMarkdown(row.body);
    expect(document.sections["Evidence log"]).toContain("tbl1/rec1");
  });
});
