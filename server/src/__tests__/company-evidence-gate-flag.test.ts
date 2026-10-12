import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agents,
  companies,
  createDb,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { companyRoutes } from "../routes/companies.js";
import { issueRoutes } from "../routes/issues.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

// PC-001 (AD-032): `companies.evidence_gate_enabled` is the evidence gate's
// pilot on-switch and its documented rollback path ("disable the flag restores
// the old done transition without a redeploy"). Before this unit the column had
// no writer at all, so both directions meant hand-written SQL against
// production. The switch rides the existing company settings PATCH rather than
// a bespoke endpoint, so it inherits that route's company scoping and
// authorization unchanged.
//
// The point of this suite is the last pair of tests: flipping the flag through
// the real route must actually arm and disarm the gate on the real `done`
// transition -- not merely persist a boolean.
const EVIDENCE_GATE_REJECTION_FRAGMENT = "Issue cannot be marked done without linked evidence";

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres evidence gate flag tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("company evidence gate flag (PC-001 operator switch)", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-company-evidence-gate-flag-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  let issueCounter = 0;

  async function seedCompany(overrides: Partial<typeof companies.$inferInsert> = {}) {
    const companyId = randomUUID();
    const prefix = `EG${companyId.replaceAll("-", "").slice(0, 6).toUpperCase()}`;
    await db.insert(companies).values({
      id: companyId,
      name: "Evidence Co",
      issuePrefix: prefix,
      ...overrides,
    });
    return { companyId, prefix };
  }

  async function seedIssue(companyId: string, prefix: string) {
    issueCounter += 1;
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: `Evidence gate flag issue ${issueCounter}`,
      status: "todo",
      priority: "medium",
      issueNumber: issueCounter,
      identifier: `${prefix}-${issueCounter}`,
    });
    return issueId;
  }

  async function seedAgent(companyId: string, role: string) {
    const id = randomUUID();
    await db.insert(agents).values({
      id,
      companyId,
      name: `Agent ${role}`,
      role,
      status: "idle",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    return id;
  }

  const boardActor = (userId = "operator-1") => ({
    type: "board",
    source: "local_implicit",
    userId,
  });

  function createApp(actor: any = boardActor()) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).actor = actor;
      next();
    });
    app.use("/api/companies", companyRoutes(db));
    app.use("/api", issueRoutes(db, {} as any, {}));
    app.use(errorHandler);
    return app;
  }

  async function readFlag(companyId: string) {
    const [row] = await db
      .select({ evidenceGateEnabled: companies.evidenceGateEnabled })
      .from(companies)
      .where(eq(companies.id, companyId));
    return row?.evidenceGateEnabled ?? null;
  }

  function gateActivityRows(companyId: string) {
    return db
      .select()
      .from(activityLog)
      .where(and(
        eq(activityLog.companyId, companyId),
        eq(activityLog.action, "company.evidence_gate_updated"),
      ));
  }

  it("enabling and disabling the flag round-trips through the company settings PATCH", async () => {
    const { companyId } = await seedCompany();
    const app = createApp();

    const enabled = await request(app)
      .patch(`/api/companies/${companyId}`)
      .send({ evidenceGateEnabled: true });

    expect(enabled.status).toBe(200);
    expect(enabled.body.evidenceGateEnabled).toBe(true);
    expect(await readFlag(companyId)).toBe(true);

    const disabled = await request(app)
      .patch(`/api/companies/${companyId}`)
      .send({ evidenceGateEnabled: false });

    expect(disabled.status).toBe(200);
    expect(disabled.body.evidenceGateEnabled).toBe(false);
    expect(await readFlag(companyId)).toBe(false);
  });

  it("GET /api/companies/:companyId reads the current value back so an operator can confirm it", async () => {
    const { companyId } = await seedCompany({ evidenceGateEnabled: true });
    const app = createApp();

    const res = await request(app).get(`/api/companies/${companyId}`);

    expect(res.status).toBe(200);
    expect(res.body.evidenceGateEnabled).toBe(true);
  });

  it("records who flipped the flag and in which direction", async () => {
    const { companyId } = await seedCompany();
    const app = createApp(boardActor("operator-42"));

    await request(app).patch(`/api/companies/${companyId}`).send({ evidenceGateEnabled: true });

    const [enabledRow] = await gateActivityRows(companyId);
    expect(enabledRow).toMatchObject({
      companyId,
      actorType: "user",
      actorId: "operator-42",
      entityType: "company",
      entityId: companyId,
      details: { evidenceGateEnabled: true, previousEvidenceGateEnabled: false },
    });

    await request(app).patch(`/api/companies/${companyId}`).send({ evidenceGateEnabled: false });

    const rows = await gateActivityRows(companyId);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.details)).toContainEqual({
      evidenceGateEnabled: false,
      previousEvidenceGateEnabled: true,
    });
  });

  it("does not log a flip when the PATCH re-sends the value the company already has", async () => {
    const { companyId } = await seedCompany({ evidenceGateEnabled: true });
    const app = createApp();

    const res = await request(app)
      .patch(`/api/companies/${companyId}`)
      .send({ evidenceGateEnabled: true });

    expect(res.status).toBe(200);
    expect(await gateActivityRows(companyId)).toHaveLength(0);
  });

  it("logs the flip even when the same PATCH also drives a lifecycle transition", async () => {
    // A status transition makes the service emit its own lifecycle activity and
    // suppresses the generic `company.updated` entry -- the flag audit must not
    // disappear with it.
    const { companyId } = await seedCompany({ status: "archived" });
    const app = createApp();

    const res = await request(app)
      .patch(`/api/companies/${companyId}`)
      .send({ status: "active", evidenceGateEnabled: true });

    expect(res.status).toBe(200);
    expect(await readFlag(companyId)).toBe(true);
    expect(await gateActivityRows(companyId)).toHaveLength(1);
  });

  it("refuses a board caller scoped to another company, without revealing the target exists", async () => {
    const { companyId } = await seedCompany();
    const otherCompanyId = randomUUID();
    const app = createApp({
      type: "board",
      source: "board_key",
      userId: "outsider-1",
      companyIds: [otherCompanyId],
      isInstanceAdmin: false,
      memberships: [{ companyId: otherCompanyId, status: "active", membershipRole: "admin" }],
    });

    const res = await request(app)
      .patch(`/api/companies/${companyId}`)
      .send({ evidenceGateEnabled: true });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("User does not have access to this company");
    expect(await readFlag(companyId)).toBe(false);

    // The same 403 answers an id that does not exist at all, so a caller cannot
    // tell a foreign company apart from a missing one.
    const missing = await request(app)
      .patch(`/api/companies/${randomUUID()}`)
      .send({ evidenceGateEnabled: true });
    expect(missing.status).toBe(403);
    expect(missing.body.error).toBe("User does not have access to this company");
  });

  it("refuses a non-CEO agent of the same company", async () => {
    const { companyId } = await seedCompany();
    const agentId = await seedAgent(companyId, "engineer");
    const app = createApp({
      type: "agent",
      source: "agent_key",
      agentId,
      companyId,
    });

    const res = await request(app)
      .patch(`/api/companies/${companyId}`)
      .send({ evidenceGateEnabled: true });

    expect(res.status).toBe(403);
    expect(await readFlag(companyId)).toBe(false);
  });

  it("refuses a CEO agent: the gate switch is an operator control, not an agent one", async () => {
    const { companyId } = await seedCompany();
    const agentId = await seedAgent(companyId, "ceo");
    const app = createApp({
      type: "agent",
      source: "agent_key",
      agentId,
      companyId,
    });

    // A CEO agent reaches the route but is held to the branding-only patch
    // schema, which rejects the field outright.
    const res = await request(app)
      .patch(`/api/companies/${companyId}`)
      .send({ evidenceGateEnabled: true });

    expect(res.status).toBe(400);
    expect(await readFlag(companyId)).toBe(false);
  });

  it("flipping the flag on arms the done gate, and flipping it off restores the old transition", async () => {
    const { companyId, prefix } = await seedCompany();
    const app = createApp();

    // Baseline: flag off (the shipped default), the done transition is open.
    const beforeIssueId = await seedIssue(companyId, prefix);
    const beforeGate = await request(app)
      .patch(`/api/issues/${beforeIssueId}`)
      .send({ status: "done" });
    expect(beforeGate.status).toBe(200);

    // Operator turns the pilot on.
    const enable = await request(app)
      .patch(`/api/companies/${companyId}`)
      .send({ evidenceGateEnabled: true });
    expect(enable.status).toBe(200);

    const gatedIssueId = await seedIssue(companyId, prefix);
    const blocked = await request(app)
      .patch(`/api/issues/${gatedIssueId}`)
      .send({ status: "done" });
    expect(blocked.status).toBe(422);
    expect(blocked.body.error).toContain(EVIDENCE_GATE_REJECTION_FRAGMENT);
    const [stillOpen] = await db.select().from(issues).where(eq(issues.id, gatedIssueId));
    expect(stillOpen?.status).toBe("todo");

    // Documented rollback: disabling the flag restores the old transition with
    // no redeploy and no data change to the issue.
    const disable = await request(app)
      .patch(`/api/companies/${companyId}`)
      .send({ evidenceGateEnabled: false });
    expect(disable.status).toBe(200);

    const unblocked = await request(app)
      .patch(`/api/issues/${gatedIssueId}`)
      .send({ status: "done" });
    expect(unblocked.status).toBe(200);
    expect(unblocked.body.status).toBe("done");
  });
});
