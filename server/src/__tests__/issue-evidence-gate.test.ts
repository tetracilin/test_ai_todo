import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agents,
  assets,
  companies,
  createDb,
  externalObjects,
  issueAttachments,
  issueEvidenceLinks,
  issueRecoveryActions,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { HttpError } from "../errors.js";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";
import { issueRecoveryActionService } from "../services/issue-recovery-actions.js";
import { issueService } from "../services/issues.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

// PC-001 (AD-032): the done transition is blocked unless the issue has >=1
// linked evidence artifact (an issue_attachments row or an
// issue_evidence_links row), when the per-company evidence_gate_enabled flag
// is on. This exercises the real gate inside issueService(db).update()'s
// row-locked transaction -- not a mocked service -- since the gate's whole
// point is transactional/race correctness.
const EXPECTED_REJECTION_MESSAGE =
  "Issue cannot be marked done without linked evidence. Accepted evidence: a file " +
  "attached to this issue, or an evidence link to an external object. Attach a " +
  "file to this issue or link evidence via the API before marking it done.";

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres evidence gate tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("issue evidence gate (PC-001)", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db: ReturnType<typeof createDb>;
  let svc: ReturnType<typeof issueService>;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-issue-evidence-gate-");
    db = createDb(tempDb.connectionString);
    svc = issueService(db);
  }, 30_000);

  afterEach(async () => {
    await db.delete(issueEvidenceLinks);
    await db.delete(issueAttachments);
    await db.delete(issueRecoveryActions);
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
    const prefix = `EV${companyId.replaceAll("-", "").slice(0, 6).toUpperCase()}`;
    await db.insert(companies).values({
      id: companyId,
      name: "Evidence Co",
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
      title: `Evidence gate issue ${issueCounter}`,
      status: "todo",
      priority: "medium",
      issueNumber: issueCounter,
      identifier: `${prefix}-${issueCounter}`,
      ...overrides,
    });
    return issueId;
  }

  async function seedExternalObject(companyId: string) {
    const id = randomUUID();
    await db.insert(externalObjects).values({
      id,
      companyId,
      providerKey: "test-provider",
      objectType: "test-object",
      externalId: randomUUID(),
    });
    return id;
  }

  async function seedEvidenceLink(companyId: string, issueId: string) {
    const externalObjectId = await seedExternalObject(companyId);
    const id = randomUUID();
    await db.insert(issueEvidenceLinks).values({ id, companyId, issueId, externalObjectId });
    return id;
  }

  async function seedAsset(companyId: string) {
    const id = randomUUID();
    await db.insert(assets).values({
      id,
      companyId,
      provider: "test",
      objectKey: `key-${id}`,
      contentType: "text/plain",
      byteSize: 10,
      sha256: "a".repeat(64),
    });
    return id;
  }

  async function seedAgent(companyId: string) {
    const id = randomUUID();
    await db.insert(agents).values({
      id,
      companyId,
      name: "Manager",
      role: "manager",
      status: "idle",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    return id;
  }

  async function seedAttachment(companyId: string, issueId: string) {
    const assetId = await seedAsset(companyId);
    const id = randomUUID();
    await db.insert(issueAttachments).values({ id, companyId, issueId, assetId });
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

  it("flag off (default): closing an issue with zero evidence succeeds", async () => {
    const { companyId, prefix } = await seedCompany({ evidenceGateEnabled: false });
    const issueId = await seedIssue(companyId, prefix);

    const updated = await svc.update(issueId, { status: "done" });

    expect(updated).toMatchObject({ id: issueId, status: "done" });
  });

  it("flag on, zero evidence: closing is rejected with the actionable evidence message", async () => {
    const { companyId, prefix } = await seedCompany({ evidenceGateEnabled: true });
    const issueId = await seedIssue(companyId, prefix);

    await expect(svc.update(issueId, { status: "done" })).rejects.toMatchObject({
      status: 422,
      message: EXPECTED_REJECTION_MESSAGE,
      details: { evidenceCount: 0 },
    });

    const [row] = await db.select().from(issues).where(eq(issues.id, issueId));
    expect(row?.status).toBe("todo");
  });

  it("flag on, >=1 issue_evidence_links row: closing succeeds", async () => {
    const { companyId, prefix } = await seedCompany({ evidenceGateEnabled: true });
    const issueId = await seedIssue(companyId, prefix);
    await seedEvidenceLink(companyId, issueId);

    const updated = await svc.update(issueId, { status: "done" });

    expect(updated).toMatchObject({ id: issueId, status: "done" });
  });

  it("flag on, >=1 issue_attachments row (no evidence link): closing succeeds", async () => {
    const { companyId, prefix } = await seedCompany({ evidenceGateEnabled: true });
    const issueId = await seedIssue(companyId, prefix);
    await seedAttachment(companyId, issueId);

    const updated = await svc.update(issueId, { status: "done" });

    expect(updated).toMatchObject({ id: issueId, status: "done" });
  });

  it("flag on: a transition to cancelled is never blocked, regardless of evidence", async () => {
    const { companyId, prefix } = await seedCompany({ evidenceGateEnabled: true });
    const issueId = await seedIssue(companyId, prefix);

    const updated = await svc.update(issueId, { status: "cancelled" });

    expect(updated).toMatchObject({ id: issueId, status: "cancelled" });
  });

  it("flag on: patching an already-done issue for an unrelated field does not re-trigger the gate", async () => {
    const { companyId, prefix } = await seedCompany({ evidenceGateEnabled: true });
    // Seeded directly as already "done" with zero evidence -- a naive
    // re-check on every write to a done issue would incorrectly block this.
    const issueId = await seedIssue(companyId, prefix, { status: "done" });

    const updated = await svc.update(issueId, { priority: "high" });

    expect(updated).toMatchObject({ id: issueId, status: "done", priority: "high" });
    const gateLogRows = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.entityId, issueId), eq(activityLog.action, "issue.evidence_gate.closed")));
    expect(gateLogRows).toHaveLength(0);
  });

  it("race/reopen: a close is re-blocked after its evidence is removed and the issue is reopened", async () => {
    const { companyId, prefix } = await seedCompany({ evidenceGateEnabled: true });
    const issueId = await seedIssue(companyId, prefix);
    const evidenceLinkId = await seedEvidenceLink(companyId, issueId);

    const closed = await svc.update(issueId, { status: "done" });
    expect(closed?.status).toBe("done");

    // Evidence removed out from under the closed issue, then reopened.
    await db.delete(issueEvidenceLinks).where(eq(issueEvidenceLinks.id, evidenceLinkId));
    const reopened = await svc.update(issueId, { status: "todo" });
    expect(reopened?.status).toBe("todo");

    // The count must be read fresh (not cached from the first close), so the
    // re-close attempt is blocked again.
    await expect(svc.update(issueId, { status: "done" })).rejects.toMatchObject({
      status: 422,
      details: { evidenceCount: 0 },
    });
    const [row] = await db.select().from(issues).where(eq(issues.id, issueId));
    expect(row?.status).toBe("todo");
  });

  it("records an activity_log entry with the evidence count on every successful close into done", async () => {
    const { companyId, prefix } = await seedCompany({ evidenceGateEnabled: true });
    const issueId = await seedIssue(companyId, prefix);
    await seedEvidenceLink(companyId, issueId);
    await seedAttachment(companyId, issueId);

    await svc.update(issueId, { status: "done" });

    const [logRow] = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.entityId, issueId), eq(activityLog.action, "issue.evidence_gate.closed")));
    expect(logRow).toMatchObject({
      companyId,
      entityType: "issue",
      entityId: issueId,
      details: { evidenceCount: 2 },
    });
  });

  it("records the activity_log entry even while the flag is off (count stays queryable)", async () => {
    const { companyId, prefix } = await seedCompany({ evidenceGateEnabled: false });
    const issueId = await seedIssue(companyId, prefix);

    await svc.update(issueId, { status: "done" });

    const [logRow] = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.entityId, issueId), eq(activityLog.action, "issue.evidence_gate.closed")));
    expect(logRow).toMatchObject({ details: { evidenceCount: 0 } });
  });

  // -- Route-level defense-in-depth: proves the gate is actually reached
  // through real HTTP entry points, not only through a direct service call.
  // Internals (flag branches, race safety, activity log) are covered above;
  // these only prove wiring.

  it("PATCH /api/issues/:id surfaces the 422 evidence-gate rejection", async () => {
    const { companyId, prefix } = await seedCompany({ evidenceGateEnabled: true });
    const issueId = await seedIssue(companyId, prefix);
    const app = createApp();

    const res = await request(app).patch(`/api/issues/${issueId}`).send({ status: "done" });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe(EXPECTED_REJECTION_MESSAGE);
    expect(res.body.details).toMatchObject({ evidenceCount: 0 });
    const [row] = await db.select().from(issues).where(eq(issues.id, issueId));
    expect(row?.status).toBe("todo");
  });

  it("PATCH /api/issues/:id allows the done transition once evidence is linked", async () => {
    const { companyId, prefix } = await seedCompany({ evidenceGateEnabled: true });
    const issueId = await seedIssue(companyId, prefix);
    await seedEvidenceLink(companyId, issueId);
    const app = createApp();

    const res = await request(app).patch(`/api/issues/${issueId}`).send({ status: "done" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("done");
  });

  it("POST /api/issues/:id/recovery-actions/resolve surfaces the same 422 evidence-gate rejection", async () => {
    const { companyId, prefix } = await seedCompany({ evidenceGateEnabled: true });
    const issueId = await seedIssue(companyId, prefix, { status: "blocked" });
    const ownerAgentId = await seedAgent(companyId);
    const action = await issueRecoveryActionService(db).upsertSourceScoped({
      companyId,
      sourceIssueId: issueId,
      kind: "missing_disposition",
      ownerType: "agent",
      ownerAgentId,
      cause: "successful_run_missing_issue_disposition",
      fingerprint: "missing-disposition:evidence-gate-test",
      nextAction: "Choose a valid issue disposition.",
    });
    const app = createApp();

    const res = await request(app)
      .post(`/api/issues/${issueId}/recovery-actions/resolve`)
      .send({
        actionId: action.id,
        outcome: "restored",
        sourceIssueStatus: "done",
        resolutionNote: "Attempting to close without evidence.",
      });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe(EXPECTED_REJECTION_MESSAGE);
    const [row] = await db.select().from(issues).where(eq(issues.id, issueId));
    expect(row?.status).toBe("blocked");
  });
});

// Sanity check on the error shape assumed above -- HttpError carries status,
// message, and details the way this suite asserts on.
describe("evidence gate rejection shape sanity", () => {
  it("unprocessable() throws an HttpError with a 422 status", () => {
    const err = new HttpError(422, EXPECTED_REJECTION_MESSAGE, { evidenceCount: 0 });
    expect(err.status).toBe(422);
    expect(err.details).toEqual({ evidenceCount: 0 });
  });
});
