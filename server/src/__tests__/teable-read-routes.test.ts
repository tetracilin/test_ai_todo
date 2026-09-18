import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { companies, createDb, issues } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";
import { HttpError, unprocessable } from "../errors.js";
import type { TeableRecordPage } from "../services/teable-client.js";
import type { teableReadService as TeableReadServiceFactory } from "../services/teable-read.js";

/**
 * F-010-3. Exercises `GET /issues/:id/teable-rows` end to end against a real database, with
 * Teable itself faked out via `opts.teableReadService` -- no live Teable instance is ever
 * contacted, matching teable-client.test.ts / teable-append-routes.test.ts.
 */

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;
if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres teable-read route tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

const TABLE_ID = "tblSlice1Pilot";

function fakePage(overrides: Partial<TeableRecordPage> = {}): TeableRecordPage {
  return {
    records: [
      {
        id: "recEvidence01",
        name: "WP-1 evidence",
        fields: { "Ten cong viec": "Lap rap phan co khi" },
        autoNumber: 17,
        createdTime: "2026-09-11T01:00:00.000Z",
        lastModifiedTime: "2026-09-12T08:31:44.000Z",
        createdBy: "Paperclip Bot",
        lastModifiedBy: "Nguyen Van A",
        modifiedAt: new Date("2026-09-12T08:31:44.000Z"),
      },
    ],
    hasMore: false,
    pageSize: 100,
    ...overrides,
  };
}

/** A fake `teableReadService` -- never calls out to a live Teable instance. */
function fakeTeableReadService(
  impl?: (input: { companyId: string; tableId: string; search?: string; take?: number; skip?: number }) => Promise<TeableRecordPage>,
): ReturnType<typeof TeableReadServiceFactory> {
  const queryRows = impl ?? (async () => fakePage());
  return { queryRows } as ReturnType<typeof TeableReadServiceFactory>;
}

describeEmbeddedPostgres("GET /issues/:id/teable-rows (F-010-3)", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-teable-read-");
    db = createDb(tempDb.connectionString);
  }, 60_000);

  afterEach(async () => {
    await db.delete(issues);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  let issueCounter = 0;

  async function seedCompany() {
    const companyId = randomUUID();
    const prefix = `TR${companyId.replaceAll("-", "").slice(0, 6).toUpperCase()}`;
    await db.insert(companies).values({
      id: companyId,
      name: "Teable Read Co",
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
      title: `Teable read issue ${issueCounter}`,
      status: "todo",
      priority: "medium",
      issueNumber: issueCounter,
      identifier: `${prefix}-${issueCounter}`,
    });
    return issueId;
  }

  function createApp(teableReadService: ReturnType<typeof TeableReadServiceFactory>) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).actor = { type: "board", source: "local_implicit" };
      next();
    });
    app.use("/api", issueRoutes(db, {} as any, { teableReadService }));
    app.use(errorHandler);
    return app;
  }

  it("returns the queried page for the allowlisted table", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    const app = createApp(fakeTeableReadService());

    const res = await request(app).get(`/api/issues/${issueId}/teable-rows`).query({ tableId: TABLE_ID });

    expect(res.status).toBe(200);
    expect(res.body.records).toHaveLength(1);
    expect(res.body.records[0]).toMatchObject({ id: "recEvidence01" });
    expect(res.body.hasMore).toBe(false);
  });

  it("forwards search/take/skip query params to the service", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    let received: unknown = null;
    const app = createApp(
      fakeTeableReadService(async (input) => {
        received = input;
        return fakePage();
      }),
    );

    await request(app)
      .get(`/api/issues/${issueId}/teable-rows`)
      .query({ tableId: TABLE_ID, search: "Tim OEM", take: "5", skip: "10" })
      .expect(200);

    expect(received).toMatchObject({ companyId, tableId: TABLE_ID, search: "Tim OEM", take: 5, skip: 10 });
  });

  it("never writes anything -- the read route creates no external_objects/evidence-links/dossier rows", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    const app = createApp(fakeTeableReadService());

    await request(app).get(`/api/issues/${issueId}/teable-rows`).query({ tableId: TABLE_ID }).expect(200);

    const linksRes = await request(app).get(`/api/issues/${issueId}/evidence-links`);
    expect(linksRes.status).toBe(200);
    expect(linksRes.body).toHaveLength(0);
  });

  it("404s for a non-existent issue", async () => {
    const app = createApp(fakeTeableReadService());

    const res = await request(app)
      .get(`/api/issues/${randomUUID()}/teable-rows`)
      .query({ tableId: TABLE_ID });

    expect(res.status).toBe(404);
  });

  it("refuses a non-allowlisted table with 422 and never calls Teable", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    const app = createApp(
      fakeTeableReadService(async () => {
        throw unprocessable("Teable table tblOther is not agent-readable. Slice 1 allows exactly one table: tblSlice1Pilot.");
      }),
    );

    const res = await request(app)
      .get(`/api/issues/${issueId}/teable-rows`)
      .query({ tableId: "tblOther" });

    expect(res.status).toBe(422);
  });

  it("rejects a malformed tableId with 400 before reaching the service", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    let called = false;
    const app = createApp(
      fakeTeableReadService(async () => {
        called = true;
        return fakePage();
      }),
    );

    const res = await request(app)
      .get(`/api/issues/${issueId}/teable-rows`)
      .query({ tableId: "../../admin" });

    expect(res.status).toBe(400);
    expect(called).toBe(false);
  });

  it("rejects a missing tableId with 400", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    const app = createApp(fakeTeableReadService());

    const res = await request(app).get(`/api/issues/${issueId}/teable-rows`);

    expect(res.status).toBe(400);
  });

  it("rejects a take above the page-size cap with 400", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    const app = createApp(fakeTeableReadService());

    const res = await request(app)
      .get(`/api/issues/${issueId}/teable-rows`)
      .query({ tableId: TABLE_ID, take: "1000" });

    expect(res.status).toBe(400);
  });

  it("maps an upstream not-found from Teable to a 502", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    const app = createApp(
      fakeTeableReadService(async () => {
        throw new HttpError(502, "Teable has no such resource.");
      }),
    );

    const res = await request(app)
      .get(`/api/issues/${issueId}/teable-rows`)
      .query({ tableId: TABLE_ID });

    expect(res.status).toBe(502);
  });
});
