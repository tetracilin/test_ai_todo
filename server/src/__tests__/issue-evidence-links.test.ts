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
  externalObjectMentions,
  externalObjects,
  issueAttachments,
  issueEvidenceLinks,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { subscribeCompanyLiveEvents } from "../services/live-events.js";
import { issueRoutes } from "../routes/issues.js";
import { externalObjectService } from "../services/external-objects.js";
import { countEvidenceForIssue, issueEvidenceLinkService } from "../services/issue-evidence-links.js";
import { issueService } from "../services/issues.js";

/**
 * The move route writes TWO audit entries inside one transaction, and the
 * second really can fail on its own -- `logActivity` inserts `runId`, an FK to
 * `heartbeat_runs` that retention prunes mid-request. Only a failure BETWEEN
 * the two entries exposes the ordering this file cares about (was the first
 * entry already announced to SSE subscribers and out-of-process plugin handlers
 * when the whole move rolled back?), and nothing on the request can produce
 * one, so it is injected. Every call delegates to the real implementation;
 * `failAfter` arms a throw on the next call past that count and is disarmed
 * again after each test.
 */
const auditControl = vi.hoisted(() => ({ failAfter: null as number | null, calls: 0 }));

vi.mock("../services/activity-log.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/activity-log.js")>();
  return {
    ...actual,
    logActivity: async (...args: Parameters<typeof actual.logActivity>) => {
      auditControl.calls += 1;
      if (auditControl.failAfter !== null && auditControl.calls > auditControl.failAfter) {
        throw new Error("activity_log insert failed");
      }
      return actual.logActivity(...args);
    },
  };
});

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

// PC-007 AC6/AC7: the evidence-link write path. Exercised against the real
// routes, the real service, and real embedded Postgres -- the whole point of
// this table is that its rows are durable evidence the PC-001 gate counts, so
// a mocked store would prove nothing.
if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres evidence link tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("issue evidence links (PC-007)", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db: ReturnType<typeof createDb>;
  let svc: ReturnType<typeof issueService>;
  let evidenceSvc: ReturnType<typeof issueEvidenceLinkService>;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-issue-evidence-links-");
    db = createDb(tempDb.connectionString);
    svc = issueService(db);
    evidenceSvc = issueEvidenceLinkService(db);
  }, 30_000);

  afterEach(async () => {
    auditControl.failAfter = null;
    auditControl.calls = 0;
    await db.delete(issueEvidenceLinks);
    await db.delete(issueAttachments);
    await db.delete(externalObjectMentions);
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(assets);
    await db.delete(externalObjects);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  let issueCounter = 0;

  async function seedCompany(overrides: Partial<typeof companies.$inferInsert> = {}) {
    const companyId = randomUUID();
    const prefix = `EL${companyId.replaceAll("-", "").slice(0, 6).toUpperCase()}`;
    await db.insert(companies).values({
      id: companyId,
      name: "Evidence Link Co",
      issuePrefix: prefix,
      requireBoardApprovalForNewAgents: false,
      ...overrides,
    });
    return { companyId, prefix };
  }

  async function seedIssue(
    companyId: string,
    prefix: string,
    overrides: Partial<typeof issues.$inferInsert> = {},
  ) {
    issueCounter += 1;
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: `Evidence link issue ${issueCounter}`,
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

  async function seedExternalObject(
    companyId: string,
    overrides: Partial<typeof externalObjects.$inferInsert> = {},
  ) {
    const id = randomUUID();
    await db.insert(externalObjects).values({
      id,
      companyId,
      providerKey: "github",
      objectType: "pull_request",
      externalId: randomUUID(),
      ...overrides,
    });
    return id;
  }

  function createApp(actor: any = { type: "board", source: "local_implicit" }) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).actor = actor;
      next();
    });
    app.use("/api", issueRoutes(db, {} as any, {}));
    app.use(errorHandler);
    return app;
  }

  function agentActor(agentId: string, companyId: string) {
    return { type: "agent", agentId, companyId, runId: null, source: "agent_jwt" };
  }

  async function readObject(id: string) {
    const [row] = await db.select().from(externalObjects).where(eq(externalObjects.id, id));
    return row;
  }

  async function readActivity(issueId: string, action: string) {
    return db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.entityId, issueId), eq(activityLog.action, action)));
  }

  /**
   * The service demands an audit writer on every write path so a mutation can
   * never commit without its `activity_log` entry. Service-level tests that are
   * not asserting on the audit itself pass this no-op.
   */
  const noAudit = async () => {};

  // -- Linking: the two pilot providers named by PC-007 AC3/AC4.

  it("links a Teable row URL as evidence (provider teable)", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    const app = createApp();

    const res = await request(app).post(`/api/issues/${issueId}/evidence-links`).send({
      providerKey: "teable",
      objectType: "row",
      externalId: "tbl9x2/recQZ71",
      url: "https://teable.t3.local/base/bseA/tbl9x2/recQZ71",
      displayTitle: "Bang nghiem thu ket qua do",
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      issueId,
      companyId,
      providerKey: "teable",
      objectType: "row",
      externalId: "tbl9x2/recQZ71",
      sanitizedCanonicalUrl: "https://teable.t3.local/base/bseA/tbl9x2/recQZ71",
      source: "manual",
    });

    const [link] = await db.select().from(issueEvidenceLinks).where(eq(issueEvidenceLinks.issueId, issueId));
    expect(link).toBeDefined();
  });

  it("links a NAS confidential path as a path reference only -- no bytes, no asset row (AD-021/C16)", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    const app = createApp();

    const res = await request(app).post(`/api/issues/${issueId}/evidence-links`).send({
      providerKey: "nas",
      objectType: "path",
      externalId: "//nas-t3/hosoky/2026/PC-142/bien-ban-nghiem-thu.pdf",
      displayTitle: "Bien ban nghiem thu (NAS)",
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      providerKey: "nas",
      objectType: "path",
      externalId: "//nas-t3/hosoky/2026/PC-142/bien-ban-nghiem-thu.pdf",
      // A path reference carries no URL and no bytes: nothing is fetched, and
      // no asset/attachment row is created for it.
      sanitizedCanonicalUrl: null,
    });
    const storedAssets = await db.select().from(assets);
    const storedAttachments = await db.select().from(issueAttachments);
    expect(storedAssets).toHaveLength(0);
    expect(storedAttachments).toHaveLength(0);
  });

  it("links an external object that already exists, by id", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    const externalObjectId = await seedExternalObject(companyId);
    const app = createApp();

    const res = await request(app)
      .post(`/api/issues/${issueId}/evidence-links`)
      .send({ externalObjectId });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ externalObjectId, providerKey: "github" });
  });

  it("refuses to link another company's external object with the same 404 as a missing one", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    const other = await seedCompany();
    const foreignObjectId = await seedExternalObject(other.companyId);
    const app = createApp();

    const foreign = await request(app)
      .post(`/api/issues/${issueId}/evidence-links`)
      .send({ externalObjectId: foreignObjectId });
    const missing = await request(app)
      .post(`/api/issues/${issueId}/evidence-links`)
      .send({ externalObjectId: randomUUID() });

    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreign.body.error).toBe(missing.body.error);
    expect(await db.select().from(issueEvidenceLinks)).toHaveLength(0);
  });

  it("re-filing the same evidence is idempotent: one row, 200 instead of 201", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    const app = createApp();
    const body = { providerKey: "teable", objectType: "row", externalId: "tbl1/rec1" };

    const first = await request(app).post(`/api/issues/${issueId}/evidence-links`).send(body);
    const second = await request(app).post(`/api/issues/${issueId}/evidence-links`).send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(await db.select().from(issueEvidenceLinks)).toHaveLength(1);
    expect(await db.select().from(externalObjects)).toHaveLength(1);
    // Only the act that actually filed evidence is logged.
    expect(await readActivity(issueId, "issue.evidence_linked")).toHaveLength(1);
  });

  it("two concurrent filings of the same artifact produce ONE row and two successful responses", async () => {
    // The regression test for the check-then-insert race. Single filing is now
    // enforced by the unique index on (issue_id, external_object_id), not by
    // an application-level read, so both racers may reach the insert: exactly
    // one creates the row and the other reports the survivor. Neither may
    // fail -- a retried chat message must not error at the caller -- and
    // neither may produce a second row, which would inflate both the PC-001
    // gate count and the PC-011 wedge ratio from one artifact.
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    const externalObjectId = await seedExternalObject(companyId);

    const [first, second] = await Promise.all([
      evidenceSvc.link(issueId, { externalObjectId }, "bot", noAudit),
      evidenceSvc.link(issueId, { externalObjectId }, "bot", noAudit),
    ]);

    expect(await db.select().from(issueEvidenceLinks)).toHaveLength(1);
    expect(first.link.id).toBe(second.link.id);
    // One filing act, so exactly one `created: true`.
    expect([first.created, second.created].filter(Boolean)).toHaveLength(1);
    expect(await evidenceSvc.countForIssue(issueId)).toBe(1);
  });

  it("two concurrent filings of the same descriptor create one object and one link", async () => {
    // Same race, entered through the descriptor branch, which must also
    // find-or-create the external_objects row exactly once.
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    const target = { providerKey: "teable", objectType: "row", externalId: "tbl9x2/recQZ71" };

    const results = await Promise.all([
      evidenceSvc.link(issueId, target, "manual", noAudit),
      evidenceSvc.link(issueId, target, "manual", noAudit),
    ]);

    expect(await db.select().from(externalObjects)).toHaveLength(1);
    expect(await db.select().from(issueEvidenceLinks)).toHaveLength(1);
    expect(new Set(results.map((result) => result.link.id)).size).toBe(1);
    expect(results.filter((result) => result.created)).toHaveLength(1);
  });

  it("a duplicate filing returns the existing row and leaves its provenance alone", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    const externalObjectId = await seedExternalObject(companyId);

    const first = await evidenceSvc.link(issueId, { externalObjectId }, "manual", noAudit);
    // The conflict does NOTHING to the surviving row: a second filing claiming
    // `bot` must not rewrite the recorded provenance of the act that actually
    // filed the evidence (PC-011 AC1 -- never over-count `bot`).
    const second = await evidenceSvc.link(issueId, { externalObjectId }, "bot", noAudit);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.link.id).toBe(first.link.id);
    expect(second.link.source).toBe("manual");
    const rows = await db.select().from(issueEvidenceLinks);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.source).toBe("manual");
  });

  // -- PC-011 AC2 provenance, derived from the actor rather than the body.

  it("a UI/API caller files evidence with source=manual", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    const app = createApp();

    const res = await request(app)
      .post(`/api/issues/${issueId}/evidence-links`)
      .send({ providerKey: "teable", objectType: "row", externalId: "tbl1/rec1" });

    expect(res.status).toBe(201);
    const [link] = await db.select().from(issueEvidenceLinks).where(eq(issueEvidenceLinks.issueId, issueId));
    expect(link?.source).toBe("manual");
    const [log] = await readActivity(issueId, "issue.evidence_linked");
    expect(log).toMatchObject({ details: { source: "manual", providerKey: "teable" } });
  });

  it("an agent-authenticated API caller does NOT count as the chat bot", async () => {
    // PC-011 AC2 scopes `bot` to the WP-0 chat path, not to automation in
    // general. `actorType === 'agent'` is true of every agent key -- including
    // PC-007 AC2's commit auto-linker -- so deriving `bot` from it would let an
    // engineer who never sent a chat message read as high bot adoption and
    // falsely pass the pilot band. Under-counting is the safe direction.
    const { companyId, prefix } = await seedCompany();
    const agentId = await seedAgent(companyId);
    const issueId = await seedIssue(companyId, prefix);
    const app = createApp(agentActor(agentId, companyId));

    const res = await request(app)
      .post(`/api/issues/${issueId}/evidence-links`)
      .send({ providerKey: "nas", objectType: "path", externalId: "//nas-t3/a.pdf" });

    expect(res.status).toBe(201);
    const [link] = await db.select().from(issueEvidenceLinks).where(eq(issueEvidenceLinks.issueId, issueId));
    expect(link?.source).toBe("manual");
    const [log] = await readActivity(issueId, "issue.evidence_linked");
    expect(log).toMatchObject({ actorType: "agent", details: { source: "manual" } });
  });

  it("source=bot is written only by a producer that states it at the service call", async () => {
    // The WP-0 chat path (PC-007 AC1/AC2) does not exist yet; this is the
    // contract it must use. `bot` is an explicit argument, never inherited from
    // authentication, so the metric can only be inflated on purpose.
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);

    const { link } = await evidenceSvc.link(
      issueId,
      { providerKey: "minio", objectType: "object", externalId: "evidence/2026/09/a.jpg" },
      "bot",
      noAudit,
    );

    expect(link.source).toBe("bot");
    const [row] = await db.select().from(issueEvidenceLinks).where(eq(issueEvidenceLinks.issueId, issueId));
    expect(row?.source).toBe("bot");
  });

  it("an uploaded attachment records its own provenance (PC-011 AC1, both filing tables)", async () => {
    // `createAttachment` used to omit `source` entirely, so the DB default made
    // every attachment 'manual' and `bot` was unwritable on this table -- a
    // structural bias in the wedge metric's denominator no real adoption could
    // correct. The column is now a required input on the filing act.
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    const base = {
      issueId,
      provider: "local",
      contentType: "image/jpeg",
      byteSize: 12,
      sha256: "b".repeat(64),
      originalFilename: "bien-ban.jpg",
    };

    const manual = await svc.createAttachment({ ...base, objectKey: "k-manual", source: "manual" });
    const bot = await svc.createAttachment({ ...base, objectKey: "k-bot", source: "bot" });

    expect(manual.source).toBe("manual");
    expect(bot.source).toBe("bot");
    const rows = await db.select().from(issueAttachments).where(eq(issueAttachments.issueId, issueId));
    expect(rows.map((row) => row.source).sort()).toEqual(["bot", "manual"]);
  });

  it("the request body cannot set its own provenance", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    const app = createApp();

    const res = await request(app).post(`/api/issues/${issueId}/evidence-links`).send({
      providerKey: "teable",
      objectType: "row",
      externalId: "tbl1/rec1",
      source: "bot",
    });

    expect(res.status).toBe(400);
    expect(await db.select().from(issueEvidenceLinks)).toHaveLength(0);
  });

  it("lists the evidence filed against an issue", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    const app = createApp();
    await request(app)
      .post(`/api/issues/${issueId}/evidence-links`)
      .send({ providerKey: "teable", objectType: "row", externalId: "tbl1/rec1" });

    const res = await request(app).get(`/api/issues/${issueId}/evidence-links`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ providerKey: "teable", source: "manual" });
  });

  // -- AC6 correction path: never a silent deletion.

  it("unlinking mis-filed evidence writes an activity_log entry", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    const app = createApp();
    const created = await request(app)
      .post(`/api/issues/${issueId}/evidence-links`)
      .send({ providerKey: "teable", objectType: "row", externalId: "tbl1/rec1" });

    const res = await request(app).delete(`/api/issues/${issueId}/evidence-links/${created.body.id}`);

    expect(res.status).toBe(200);
    expect(await db.select().from(issueEvidenceLinks)).toHaveLength(0);
    const [log] = await readActivity(issueId, "issue.evidence_unlinked");
    expect(log).toMatchObject({
      companyId,
      entityType: "issue",
      details: {
        evidenceLinkId: created.body.id,
        externalObjectId: created.body.externalObjectId,
        providerKey: "teable",
        source: "manual",
      },
    });
  });

  it("moving mis-filed evidence records where it went, on both cards", async () => {
    const { companyId, prefix } = await seedCompany();
    const fromIssueId = await seedIssue(companyId, prefix);
    const toIssueId = await seedIssue(companyId, prefix);
    const app = createApp();
    const created = await request(app)
      .post(`/api/issues/${fromIssueId}/evidence-links`)
      .send({ providerKey: "teable", objectType: "row", externalId: "tbl1/rec1" });

    const res = await request(app)
      .post(`/api/issues/${fromIssueId}/evidence-links/${created.body.id}/move`)
      .send({ toIssueId });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: created.body.id, issueId: toIssueId });
    // The filing act keeps its original provenance -- only the card changed.
    expect(res.body.source).toBe("manual");

    const [movedOut] = await readActivity(fromIssueId, "issue.evidence_moved");
    expect(movedOut).toMatchObject({
      details: { evidenceLinkId: created.body.id, toIssueId, merged: false },
    });
    const linkedIn = await readActivity(toIssueId, "issue.evidence_linked");
    expect(linkedIn).toHaveLength(1);
    expect(linkedIn[0]).toMatchObject({ details: { fromIssueId } });

    const links = await db.select().from(issueEvidenceLinks);
    expect(links).toHaveLength(1);
    expect(links[0]?.issueId).toBe(toIssueId);
  });

  it("a move onto a card that already carries the same evidence folds the rows and still logs the move", async () => {
    const { companyId, prefix } = await seedCompany();
    const fromIssueId = await seedIssue(companyId, prefix);
    const toIssueId = await seedIssue(companyId, prefix);
    const app = createApp();
    const body = { providerKey: "teable", objectType: "row", externalId: "tbl1/rec1" };
    const created = await request(app).post(`/api/issues/${fromIssueId}/evidence-links`).send(body);
    await request(app).post(`/api/issues/${toIssueId}/evidence-links`).send(body);

    const res = await request(app)
      .post(`/api/issues/${fromIssueId}/evidence-links/${created.body.id}/move`)
      .send({ toIssueId });

    expect(res.status).toBe(200);
    const links = await db.select().from(issueEvidenceLinks);
    expect(links).toHaveLength(1);
    expect(links[0]?.issueId).toBe(toIssueId);
    const [movedOut] = await readActivity(fromIssueId, "issue.evidence_moved");
    expect(movedOut).toMatchObject({ details: { merged: true, toIssueId } });
  });

  it("a merge keeps the weaker provenance and reports both sources on the audit entry", async () => {
    // The bot filed object X on card A; a PM had already filed the same X on
    // card B by hand. Folding the rows destroys one filing act, so the ratio
    // moves whatever we do -- and the direction is a decision. It is settled
    // the same way as HTTP_EVIDENCE_SOURCE and `otherCount`: never over-count
    // `bot`. The survivor therefore keeps the WEAKER provenance ('manual'
    // here), so the merge lowers the ratio rather than raising it. The audit
    // entry still names both, or PC-002's dossier correction line would state
    // the wrong provenance for the row that moved.
    const { companyId, prefix } = await seedCompany();
    const fromIssueId = await seedIssue(companyId, prefix);
    const toIssueId = await seedIssue(companyId, prefix);
    const target = { providerKey: "minio" as const, objectType: "object", externalId: "evidence/x.jpg" };
    const app = createApp();

    const botFiled = await evidenceSvc.link(fromIssueId, target, "bot", noAudit);
    await request(app).post(`/api/issues/${toIssueId}/evidence-links`).send(target);

    const res = await request(app)
      .post(`/api/issues/${fromIssueId}/evidence-links/${botFiled.link.id}/move`)
      .send({ toIssueId });

    expect(res.status).toBe(200);
    const links = await db.select().from(issueEvidenceLinks);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ issueId: toIssueId, source: "manual" });
    expect(res.body.source).toBe("manual");

    const [movedOut] = await readActivity(fromIssueId, "issue.evidence_moved");
    expect(movedOut).toMatchObject({
      details: { merged: true, movedSource: "bot", source: "manual" },
    });
  });

  it("a merge writes a bot-filed destination down to the absorbed manual act", async () => {
    // The mirror of the case above, and the one that makes the rule an actual
    // rule rather than "whichever row happened to survive": moving a manual
    // filing onto a bot-filed row must NOT leave a lone 'bot' row behind, which
    // would take {bot 1, manual 1, n 2, ratio 0.5} to {bot 1, n 1, ratio 1.0}
    // -- a routine AC6 correction pushing the PC-011 band toward `pass`.
    const { companyId, prefix } = await seedCompany();
    const fromIssueId = await seedIssue(companyId, prefix);
    const toIssueId = await seedIssue(companyId, prefix);
    const target = { providerKey: "minio" as const, objectType: "object", externalId: "evidence/y.jpg" };
    const app = createApp();

    const manualFiled = await request(app)
      .post(`/api/issues/${fromIssueId}/evidence-links`)
      .send(target);
    await evidenceSvc.link(toIssueId, target, "bot", noAudit);

    const res = await request(app)
      .post(`/api/issues/${fromIssueId}/evidence-links/${manualFiled.body.id}/move`)
      .send({ toIssueId });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("manual");
    const links = await db.select().from(issueEvidenceLinks);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ issueId: toIssueId, source: "manual" });
    const [movedOut] = await readActivity(fromIssueId, "issue.evidence_moved");
    expect(movedOut).toMatchObject({ details: { merged: true, movedSource: "manual", source: "manual" } });
  });

  it("a merge of two bot filings keeps the survivor bot", async () => {
    // The rule only ever writes DOWN: with nothing weaker to absorb, the
    // survivor is untouched and the ratio is unchanged (n and botCount both
    // drop by 1).
    const { companyId, prefix } = await seedCompany();
    const fromIssueId = await seedIssue(companyId, prefix);
    const toIssueId = await seedIssue(companyId, prefix);
    const target = { providerKey: "minio" as const, objectType: "object", externalId: "evidence/z.jpg" };
    const app = createApp();

    const botFiled = await evidenceSvc.link(fromIssueId, target, "bot", noAudit);
    await evidenceSvc.link(toIssueId, target, "bot", noAudit);

    const res = await request(app)
      .post(`/api/issues/${fromIssueId}/evidence-links/${botFiled.link.id}/move`)
      .send({ toIssueId });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("bot");
    const links = await db.select().from(issueEvidenceLinks);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ issueId: toIssueId, source: "bot" });
  });

  // -- The audit entry is transactional; its ANNOUNCEMENT is not. `logActivity`
  // publishes synchronously to the company's SSE subscribers and to
  // out-of-process plugin handlers, and neither can be rolled back. Called from
  // inside the write transaction it would announce a mutation that has not
  // committed and may still abort. Each test below stands a real subscriber up
  // and, at the instant the event lands, reads the table on a DIFFERENT
  // connection: uncommitted work is invisible there, so seeing the finished
  // state proves the publication was drained after commit.

  function recordEvidenceEvents(companyId: string) {
    const seen: string[] = [];
    const unsubscribe = subscribeCompanyLiveEvents(companyId, (event) => {
      const action = (event.payload as { action?: string } | undefined)?.action;
      if (typeof action === "string" && action.startsWith("issue.evidence_")) seen.push(action);
    });
    return { seen, unsubscribe };
  }

  it("a rolled-back move announces nothing to live subscribers", async () => {
    const { companyId, prefix } = await seedCompany();
    const fromIssueId = await seedIssue(companyId, prefix);
    const toIssueId = await seedIssue(companyId, prefix);
    const app = createApp();
    const created = await request(app)
      .post(`/api/issues/${fromIssueId}/evidence-links`)
      .send({ providerKey: "teable", objectType: "row", externalId: "tbl1/rec1" });

    const { seen, unsubscribe } = recordEvidenceEvents(companyId);
    auditControl.calls = 0;
    // The card's own entry is written; the destination card's entry throws.
    auditControl.failAfter = 1;
    try {
      const res = await request(app)
        .post(`/api/issues/${fromIssueId}/evidence-links/${created.body.id}/move`)
        .send({ toIssueId });
      expect(res.status).toBeGreaterThanOrEqual(500);
    } finally {
      auditControl.failAfter = null;
      unsubscribe();
    }

    // The move rolled back: the link is still on the original card and neither
    // audit entry survives.
    const [row] = await db.select().from(issueEvidenceLinks);
    expect(row?.issueId).toBe(fromIssueId);
    expect(await readActivity(fromIssueId, "issue.evidence_moved")).toHaveLength(0);
    // So nothing may have been announced either. `publishActivity` fans out to
    // the company's SSE stream and to out-of-process plugin handlers, and
    // neither can be rolled back: a UI that has already rendered the move, or a
    // plugin that has already acted on it, cannot be taken back.
    expect(seen).toEqual([]);
  });

  it("a committed link, unlink and move are each still announced", async () => {
    // The other half of the invariant: holding the publications back until the
    // transaction returns must not drop them.
    const { companyId, prefix } = await seedCompany();
    const fromIssueId = await seedIssue(companyId, prefix);
    const toIssueId = await seedIssue(companyId, prefix);
    const app = createApp();
    const body = { providerKey: "teable" as const, objectType: "row", externalId: "tbl1/rec1" };

    const { seen, unsubscribe } = recordEvidenceEvents(companyId);
    try {
      const created = await request(app).post(`/api/issues/${fromIssueId}/evidence-links`).send(body);
      expect(created.status).toBe(201);
      const moved = await request(app)
        .post(`/api/issues/${fromIssueId}/evidence-links/${created.body.id}/move`)
        .send({ toIssueId });
      expect(moved.status).toBe(200);
      const removed = await request(app)
        .delete(`/api/issues/${toIssueId}/evidence-links/${created.body.id}`);
      expect(removed.status).toBe(200);
    } finally {
      unsubscribe();
    }

    expect(seen).toEqual([
      "issue.evidence_linked",
      // The move logs on both cards: the correction on the source, the arrival
      // on the destination.
      "issue.evidence_moved",
      "issue.evidence_linked",
      "issue.evidence_unlinked",
    ]);
  });

  // -- AC6 structurally: the audit entry commits with the mutation or not at
  // all. `logActivity` really can fail (it inserts `runId`, an FK to
  // heartbeat_runs that retention prunes, and makes two other DB round trips),
  // and after the commit that failure would leave evidence deleted with no
  // record of the deletion -- the exact silent deletion AC6 forbids.

  it("a failed audit write rolls the unlink back rather than deleting evidence silently", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    const { link } = await evidenceSvc.link(
      issueId,
      { providerKey: "teable", objectType: "row", externalId: "tbl1/rec1" },
      "manual",
      noAudit,
    );

    await expect(
      evidenceSvc.unlink(issueId, link.id, async () => {
        throw new Error("activity_log insert failed");
      }),
    ).rejects.toThrow("activity_log insert failed");

    const rows = await db.select().from(issueEvidenceLinks);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(link.id);
  });

  it("a failed audit write rolls the link back rather than filing unlogged evidence", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);

    await expect(
      evidenceSvc.link(
        issueId,
        { providerKey: "teable", objectType: "row", externalId: "tbl1/rec1" },
        "manual",
        async () => {
          throw new Error("activity_log insert failed");
        },
      ),
    ).rejects.toThrow("activity_log insert failed");

    // Neither the filing act nor the object it would have pointed at survives,
    // so a retry cannot hit the idempotent path and skip the audit entry.
    expect(await db.select().from(issueEvidenceLinks)).toHaveLength(0);
    expect(await db.select().from(externalObjects)).toHaveLength(0);
  });

  it("a failed audit write rolls the move back on both cards", async () => {
    const { companyId, prefix } = await seedCompany();
    const fromIssueId = await seedIssue(companyId, prefix);
    const toIssueId = await seedIssue(companyId, prefix);
    const { link } = await evidenceSvc.link(
      fromIssueId,
      { providerKey: "teable", objectType: "row", externalId: "tbl1/rec1" },
      "manual",
      noAudit,
    );

    await expect(
      evidenceSvc.move(fromIssueId, link.id, toIssueId, async () => {
        throw new Error("activity_log insert failed");
      }),
    ).rejects.toThrow("activity_log insert failed");

    const [row] = await db.select().from(issueEvidenceLinks);
    expect(row?.issueId).toBe(fromIssueId);
  });

  it("counts the same evidence the PC-001 gate counts, attachments included", async () => {
    // `countForIssue` promised gate parity but queried only the link table, so
    // a card whose sole evidence is an uploaded photo -- a card the gate closes
    // happily -- reported zero to any PC-011 AC4 consumer built on it.
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    await svc.createAttachment({
      issueId,
      provider: "local",
      objectKey: "k-1",
      contentType: "image/jpeg",
      byteSize: 12,
      sha256: "c".repeat(64),
      source: "manual",
    });

    expect(await evidenceSvc.countForIssue(issueId)).toBe(1);

    await evidenceSvc.link(
      issueId,
      { providerKey: "teable", objectType: "row", externalId: "tbl1/rec1" },
      "manual",
      noAudit,
    );

    expect(await evidenceSvc.countForIssue(issueId)).toBe(2);
  });

  // -- The shared evidence predicate. Five consumers read it (the gate, the
  // wedge ratio, the re-brief verb, the PM digest, the WP-close export), so its
  // numbers must be the gate's numbers, not merely close to them.

  it("countEvidenceForIssue reports both filing tables separately and summed", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);

    expect(await countEvidenceForIssue(db, { companyId, issueId })).toEqual({
      attachmentCount: 0,
      evidenceLinkCount: 0,
      total: 0,
    });

    await svc.createAttachment({
      issueId,
      provider: "local",
      objectKey: "k-count-1",
      contentType: "image/jpeg",
      byteSize: 12,
      sha256: "d".repeat(64),
      source: "manual",
    });
    await evidenceSvc.link(
      issueId,
      { providerKey: "teable", objectType: "row", externalId: "tbl1/rec1" },
      "manual",
      noAudit,
    );

    expect(await countEvidenceForIssue(db, { companyId, issueId })).toEqual({
      attachmentCount: 1,
      evidenceLinkCount: 1,
      total: 2,
    });
  });

  it("countEvidenceForIssue is company-scoped", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    const other = await seedCompany();
    await evidenceSvc.link(
      issueId,
      { providerKey: "teable", objectType: "row", externalId: "tbl1/rec1" },
      "manual",
      noAudit,
    );

    // An issue id alone must never let one company's rows be counted under
    // another company's scope -- the gate scopes both counts, and so does this.
    expect(await countEvidenceForIssue(db, { companyId: other.companyId, issueId })).toEqual({
      attachmentCount: 0,
      evidenceLinkCount: 0,
      total: 0,
    });
  });

  it("countEvidenceForIssue returns the same total the PC-001 gate records", async () => {
    const { companyId, prefix } = await seedCompany({ evidenceGateEnabled: true });
    const issueId = await seedIssue(companyId, prefix);
    await svc.createAttachment({
      issueId,
      provider: "local",
      objectKey: "k-count-2",
      contentType: "image/jpeg",
      byteSize: 12,
      sha256: "e".repeat(64),
      source: "manual",
    });
    await evidenceSvc.link(
      issueId,
      { providerKey: "teable", objectType: "row", externalId: "tbl1/rec1" },
      "manual",
      noAudit,
    );

    const counts = await countEvidenceForIssue(db, { companyId, issueId });
    // The gate stamps the count it computed onto its own receipt, so the two
    // numbers can be compared directly rather than by re-deriving one of them.
    await svc.update(issueId, { status: "done" });
    const [log] = await readActivity(issueId, "issue.evidence_gate.closed");

    expect(counts.total).toBe(2);
    expect(log).toMatchObject({ details: { evidenceCount: counts.total } });
  });

  it("countEvidenceForIssue runs inside a caller's open transaction", async () => {
    // The gate counts under the same FOR UPDATE lock as the status write, so
    // the helper has to be usable on a caller's `tx`, not just the pool.
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    await evidenceSvc.link(
      issueId,
      { providerKey: "teable", objectType: "row", externalId: "tbl1/rec1" },
      "manual",
      noAudit,
    );

    const inTransaction = await db.transaction(async (tx) => {
      await tx.select().from(issues).where(eq(issues.id, issueId)).for("update");
      return countEvidenceForIssue(tx, { companyId, issueId });
    });

    expect(inTransaction).toEqual({ attachmentCount: 0, evidenceLinkCount: 1, total: 1 });
  });

  it("evidence cannot be moved across a company boundary", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    const other = await seedCompany();
    const otherIssueId = await seedIssue(other.companyId, other.prefix);
    const app = createApp();
    const created = await request(app)
      .post(`/api/issues/${issueId}/evidence-links`)
      .send({ providerKey: "teable", objectType: "row", externalId: "tbl1/rec1" });

    const res = await request(app)
      .post(`/api/issues/${issueId}/evidence-links/${created.body.id}/move`)
      .send({ toIssueId: otherIssueId });

    expect(res.status).toBe(422);
    const [link] = await db.select().from(issueEvidenceLinks);
    expect(link?.issueId).toBe(issueId);
  });

  // -- AC7: a static evidence row sits cleanly in the refresh machinery.

  it("a static evidence row is created with liveness=unknown and is never due for refresh", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);

    const { link } = await evidenceSvc.link(
      issueId,
      { providerKey: "nas", objectType: "path", externalId: "//nas-t3/bien-ban.pdf" },
      "bot",
      noAudit,
    );

    const object = await readObject(link.externalObjectId);
    expect(object).toMatchObject({
      liveness: "unknown",
      // `nextRefreshAt: null` is the whole exclusion. `isTerminal` stays false:
      // it is a permanent, company-wide flag and this insert must not claim it
      // (see the regression below).
      nextRefreshAt: null,
      isTerminal: false,
      lastErrorAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
    });
  });

  it("filing a resolver-owned artifact as evidence does not remove it from refresh forever", async () => {
    // Regression: the descriptor branch can claim an identity a real detector
    // also produces -- GitHub external ids are reproducible ("acme/app#pull/42"
    // from `externalIdFor`) and the route validates providerKey only against a
    // lowercase-slug regex. When this insert set `isTerminal: true`, a later
    // paste of the same URL took `upsertObjectFromDetection`'s ON CONFLICT
    // branch, which re-arms `nextRefreshAt` but never clears `isTerminal`, and
    // nothing else clears it either -- so `refreshDueObjectsUnchecked`'s
    // `is_terminal = false` filter excluded that PR from status refresh on
    // every card in the company, permanently and silently.
    const { companyId, prefix } = await seedCompany();
    const evidenceIssueId = await seedIssue(companyId, prefix);
    const app = createApp();

    const filed = await request(app).post(`/api/issues/${evidenceIssueId}/evidence-links`).send({
      providerKey: "github",
      objectType: "pull_request",
      externalId: "acme/app#pull/42",
    });
    expect(filed.status).toBe(201);

    // Someone later pastes the same PR into another card's description.
    const mentionIssueId = await seedIssue(companyId, prefix, {
      description: "See https://github.com/acme/app/pull/42 for the fix.",
    });
    await externalObjectService(db, { enabled: true }).syncIssue(mentionIssueId);

    // The detector recognised the artifact the evidence filing had already
    // created, so there is still exactly one row -- and it is due for refresh.
    const objects = await db.select().from(externalObjects);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.id).toBe(filed.body.externalObjectId);
    expect(objects[0]?.isTerminal).toBe(false);
    expect(objects[0]?.nextRefreshAt).not.toBeNull();
    expect(objects[0]!.nextRefreshAt!.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("the refresh sweeper never selects a static evidence row and never spams a resolver error", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    const { link } = await evidenceSvc.link(
      issueId,
      { providerKey: "teable", objectType: "row", externalId: "tbl1/rec1" },
      "manual",
      noAudit,
    );
    // `enabled: true` overrides the instance experimental flag, so this is the
    // sweeper at its most eager -- there is no resolver registered for
    // `teable`, so a row that were due would take the `no_resolver` branch and
    // get re-armed with a nextRefreshAt.
    const objects = externalObjectService(db, { enabled: true, github: false });

    const results = await objects.refreshDueObjects(companyId);

    expect(results).toHaveLength(0);
    expect(await readObject(link.externalObjectId)).toMatchObject({
      liveness: "unknown",
      isTerminal: false,
      nextRefreshAt: null,
      lastErrorAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      refreshStartedAt: null,
    });
  });

  // -- PC-001 gate interaction. The gate counts issue_evidence_links rows and
  // attachments, and never mention rows.

  it("linking evidence unblocks the done transition", async () => {
    const { companyId, prefix } = await seedCompany({ evidenceGateEnabled: true });
    const issueId = await seedIssue(companyId, prefix);
    const app = createApp();

    const blocked = await request(app).patch(`/api/issues/${issueId}`).send({ status: "done" });
    expect(blocked.status).toBe(422);
    expect(blocked.body.details).toMatchObject({ evidenceCount: 0 });

    const linked = await request(app)
      .post(`/api/issues/${issueId}/evidence-links`)
      .send({ providerKey: "teable", objectType: "row", externalId: "tbl1/rec1" });
    expect(linked.status).toBe(201);

    const closed = await request(app).patch(`/api/issues/${issueId}`).send({ status: "done" });
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe("done");
  });

  it("unlinking the last evidence re-blocks the close on the reopen path", async () => {
    const { companyId, prefix } = await seedCompany({ evidenceGateEnabled: true });
    const issueId = await seedIssue(companyId, prefix);
    const app = createApp();
    const created = await request(app)
      .post(`/api/issues/${issueId}/evidence-links`)
      .send({ providerKey: "teable", objectType: "row", externalId: "tbl1/rec1" });
    expect((await request(app).patch(`/api/issues/${issueId}`).send({ status: "done" })).status).toBe(200);

    // The correction path (AC6) runs against a closed card, then the card is
    // reopened -- the re-close must be blocked again, from a freshly read
    // count.
    const unlinked = await request(app).delete(`/api/issues/${issueId}/evidence-links/${created.body.id}`);
    expect(unlinked.status).toBe(200);
    expect((await request(app).patch(`/api/issues/${issueId}`).send({ status: "todo" })).status).toBe(200);

    const reclose = await request(app).patch(`/api/issues/${issueId}`).send({ status: "done" });

    expect(reclose.status).toBe(422);
    expect(reclose.body.details).toMatchObject({ evidenceCount: 0 });
    const [row] = await db.select().from(issues).where(eq(issues.id, issueId));
    expect(row?.status).toBe("todo");
  });

  it("an external_object_mentions row alone does NOT satisfy the gate", async () => {
    const { companyId, prefix } = await seedCompany({ evidenceGateEnabled: true });
    const issueId = await seedIssue(companyId, prefix);
    const externalObjectId = await seedExternalObject(companyId);
    // A text-detected mention: the exact row shape the detector writes, and the
    // one this story explicitly refused to count. It is wholesale deleted and
    // re-inserted on every text sync and its object_id is SET NULL on object
    // delete, so it can dangle -- evidence it is not.
    await db.insert(externalObjectMentions).values({
      companyId,
      sourceIssueId: issueId,
      sourceKind: "description",
      objectId: externalObjectId,
      providerKey: "github",
      objectType: "pull_request",
    });

    await expect(svc.update(issueId, { status: "done" })).rejects.toMatchObject({
      status: 422,
      details: { evidenceCount: 0 },
    });
    const [row] = await db.select().from(issues).where(eq(issues.id, issueId));
    expect(row?.status).toBe("todo");
  });

  it("a mention row plus a real evidence link counts exactly one artifact", async () => {
    const { companyId, prefix } = await seedCompany({ evidenceGateEnabled: true });
    const issueId = await seedIssue(companyId, prefix);
    const externalObjectId = await seedExternalObject(companyId);
    await db.insert(externalObjectMentions).values({
      companyId,
      sourceIssueId: issueId,
      sourceKind: "description",
      objectId: externalObjectId,
      providerKey: "github",
      objectType: "pull_request",
    });
    await evidenceSvc.link(issueId, { externalObjectId }, "bot", noAudit);

    const updated = await svc.update(issueId, { status: "done" });

    expect(updated).toMatchObject({ id: issueId, status: "done" });
    const [log] = await readActivity(issueId, "issue.evidence_gate.closed");
    expect(log).toMatchObject({ details: { evidenceCount: 1 } });
  });
});
