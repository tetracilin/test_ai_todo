import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  companies,
  createDb,
  documentRevisions,
  documents,
  externalObjects,
  issueDocuments,
  issueEvidenceLinks,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";
import { issueDossierService, parseEvidenceLog } from "../services/issue-dossier.js";
import type { TeableAppendResult, teableAppendService as TeableAppendServiceFactory } from "../services/teable-append.js";

/**
 * F-010-2. Exercises `POST /issues/:id/teable-rows` end to end against a real database, with
 * Teable itself faked out via `opts.teableAppendService` -- no live Teable instance is ever
 * contacted, matching teable-client.test.ts / teable-append.test.ts.
 */

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
    `Skipping embedded Postgres teable-append route tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

const RECORD_ID = "recEvidence03";
const TABLE_ID = "tblSlice1Pilot";

/** A fake `teableAppendService` -- never calls out to a live Teable instance. */
function fakeTeableAppendService(
  impl?: (input: { companyId: string; tableId: string; fields: Record<string, unknown> }) => Promise<TeableAppendResult>,
): ReturnType<typeof TeableAppendServiceFactory> {
  const appendRow =
    impl ??
    (async (input: { companyId: string; tableId: string; fields: Record<string, unknown> }) => ({
      record: {
        id: RECORD_ID,
        name: "OEM row",
        fields: input.fields,
        autoNumber: 19,
        createdTime: "2026-09-13T09:05:00.000Z",
        lastModifiedTime: null,
        createdBy: "Paperclip Bot",
        lastModifiedBy: null,
        modifiedAt: new Date("2026-09-13T09:05:00.000Z"),
      },
      target: {
        providerKey: "teable",
        objectType: "record",
        externalId: `${input.tableId}/${RECORD_ID}`,
        displayTitle: "OEM row",
        url: null,
        data: { tableId: input.tableId, recordId: RECORD_ID, createdBy: "Paperclip Bot", createdTime: "2026-09-13T09:05:00.000Z" },
      },
    }));
  return { appendRow } as ReturnType<typeof TeableAppendServiceFactory>;
}

describeEmbeddedPostgres("POST /issues/:id/teable-rows (F-010-2)", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-teable-append-");
    db = createDb(tempDb.connectionString);
  }, 60_000);

  afterEach(async () => {
    dossierControl.failNext = false;
    await db.delete(issueEvidenceLinks);
    await db.delete(activityLog);
    await db.delete(documentRevisions);
    await db.delete(issueDocuments);
    await db.delete(documents);
    await db.delete(issues);
    await db.delete(externalObjects);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  let issueCounter = 0;

  async function seedCompany() {
    const companyId = randomUUID();
    const prefix = `TA${companyId.replaceAll("-", "").slice(0, 6).toUpperCase()}`;
    await db.insert(companies).values({
      id: companyId,
      name: "Teable Append Co",
      issuePrefix: prefix,
      requireBoardApprovalForNewAgents: false,
    });
    return { companyId, prefix };
  }

  async function seedIssue(companyId: string, prefix: string) {
    issueCounter += 1;
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: `Teable append issue ${issueCounter}`,
      status: "todo",
      priority: "medium",
      issueNumber: issueCounter,
      identifier: `${prefix}-${issueCounter}`,
    });
    return issueId;
  }

  function createApp(teableAppendService: ReturnType<typeof TeableAppendServiceFactory>) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).actor = { type: "board", source: "local_implicit" };
      next();
    });
    app.use("/api", issueRoutes(db, {} as any, { teableAppendService }));
    app.use(errorHandler);
    return app;
  }

  it("creates a row, links it on the card, and appears on GET evidence-links", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    const app = createApp(fakeTeableAppendService());

    const res = await request(app)
      .post(`/api/issues/${issueId}/teable-rows`)
      .send({ tableId: TABLE_ID, fields: { "Ten cong viec": "Tim OEM" }, caption: "Filed OEM row" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ recordId: RECORD_ID, tableId: TABLE_ID });
    expect(res.body.link.providerKey).toBe("teable");

    const linksRes = await request(app).get(`/api/issues/${issueId}/evidence-links`);
    expect(linksRes.status).toBe(200);
    expect(linksRes.body).toHaveLength(1);
    expect(linksRes.body[0]).toMatchObject({ providerKey: "teable", externalId: `${TABLE_ID}/${RECORD_ID}` });
  });

  it("appends exactly one dossier Evidence-log line, referencing tableId/recordId", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    const app = createApp(fakeTeableAppendService());

    await request(app)
      .post(`/api/issues/${issueId}/teable-rows`)
      .send({ tableId: TABLE_ID, fields: { a: 1 }, caption: "Filed OEM row" })
      .expect(201);

    const dossierSvc = issueDossierService(db);
    const dossier = await dossierSvc.get(issueId);
    expect(dossier).not.toBeNull();
    const lines = parseEvidenceLog(dossier!.document);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ providerKey: "teable", ref: `${TABLE_ID}/${RECORD_ID}`, caption: "Filed OEM row" });
  });

  it("writes an issue.teable_row_appended activity_log entry", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    const app = createApp(fakeTeableAppendService());

    await request(app)
      .post(`/api/issues/${issueId}/teable-rows`)
      .send({ tableId: TABLE_ID, fields: { a: 1 }, caption: "Filed OEM row" })
      .expect(201);

    const entries = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.companyId, companyId), eq(activityLog.action, "issue.teable_row_appended")));
    expect(entries).toHaveLength(1);
    expect(entries[0]!.entityId).toBe(issueId);
  });

  it("404s for a non-existent issue", async () => {
    const app = createApp(fakeTeableAppendService());

    const res = await request(app)
      .post(`/api/issues/${randomUUID()}/teable-rows`)
      .send({ tableId: TABLE_ID, fields: { a: 1 }, caption: "x" });

    expect(res.status).toBe(404);
  });

  it("rejects a body carrying source with 400 -- provenance is never client-supplied", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    const app = createApp(fakeTeableAppendService());

    const res = await request(app)
      .post(`/api/issues/${issueId}/teable-rows`)
      .send({ tableId: TABLE_ID, fields: { a: 1 }, caption: "x", source: "bot" });

    expect(res.status).toBe(400);
    expect(await db.select().from(issueEvidenceLinks)).toHaveLength(0);
  });

  it("still returns 201 when the dossier append fails -- it is best-effort", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    const app = createApp(fakeTeableAppendService());
    dossierControl.failNext = true;

    const res = await request(app)
      .post(`/api/issues/${issueId}/teable-rows`)
      .send({ tableId: TABLE_ID, fields: { a: 1 }, caption: "x" });

    expect(res.status).toBe(201);
    expect(await db.select().from(issueEvidenceLinks)).toHaveLength(1);
  });

  it("refuses an allowlist rejection from the service without writing a link", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    const app = createApp(
      fakeTeableAppendService(async () => {
        const { unprocessable } = await import("../errors.js");
        throw unprocessable("Teable table tblOther is not agent-writable. Slice 1 allows exactly one table: tblSlice1Pilot.");
      }),
    );

    const res = await request(app)
      .post(`/api/issues/${issueId}/teable-rows`)
      .send({ tableId: "tblOther", fields: { a: 1 }, caption: "x" });

    expect(res.status).toBe(422);
    expect(await db.select().from(issueEvidenceLinks)).toHaveLength(0);
  });
});
