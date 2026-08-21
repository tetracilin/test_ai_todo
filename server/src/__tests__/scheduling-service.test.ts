import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agents,
  companies,
  createDb,
  executionWorkspaces,
  issueScheduling,
  issues,
  projectWorkspaces,
  projects,
  schedulingRoutines,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { issueService } from "../services/issues.js";
import { schedulingService } from "../services/scheduling.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres scheduling service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("scheduling service", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-scheduling-service-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(issueScheduling);
    await db.delete(schedulingRoutines);
    await db.delete(issues);
    await db.delete(executionWorkspaces);
    await db.delete(projectWorkspaces);
    await db.delete(projects);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedFixture() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const defaultResponsibleUserId = randomUUID();
    const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

    await db.insert(companies).values({
      id: companyId,
      name: "Scheduling Co",
      issuePrefix,
      defaultResponsibleUserId,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "SchedulerAgent",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    const issueSvc = issueService(db);
    const svc = schedulingService(db);
    return { companyId, agentId, issueSvc, svc };
  }

  it("upserts, reads, and clears scheduling fields on an issue", async () => {
    const { companyId, issueSvc, svc } = await seedFixture();
    const issue = await issueSvc.create(companyId, {
      title: "Write report",
      status: "todo",
      priority: "medium",
    });

    expect(await svc.getIssueScheduling(companyId, issue.id)).toBeNull();

    const scheduledAt = new Date("2026-08-20T14:00:00.000Z");
    const upserted = await svc.upsertIssueScheduling(companyId, issue.id, {
      scheduledAt,
      scheduledDurationMinutes: 30,
    });
    expect(upserted.scheduledAt).toBe(scheduledAt.toISOString());
    expect(upserted.scheduledDurationMinutes).toBe(30);
    expect(upserted.deferUntil).toBeNull();

    const partialUpdate = await svc.upsertIssueScheduling(companyId, issue.id, {
      scheduledDurationMinutes: 45,
    });
    expect(partialUpdate.scheduledAt).toBe(scheduledAt.toISOString());
    expect(partialUpdate.scheduledDurationMinutes).toBe(45);

    const listed = await svc.listScheduledIssues(companyId, {});
    expect(listed).toHaveLength(1);
    expect(listed[0]!.issueId).toBe(issue.id);

    const cleared = await svc.clearIssueScheduling(companyId, issue.id);
    expect(cleared).toBe(true);
    expect(await svc.getIssueScheduling(companyId, issue.id)).toBeNull();
  });

  it("rejects scheduling lookups for an issue in a different company", async () => {
    const { issueSvc, svc } = await seedFixture();
    const other = await seedFixture();
    const issue = await issueSvc.create(other.companyId, {
      title: "Cross-tenant issue",
      status: "todo",
      priority: "medium",
    });

    await expect(svc.getIssueScheduling(other.companyId, issue.id)).resolves.toBeNull();
    const wrongCompanyId = randomUUID();
    await expect(svc.getIssueScheduling(wrongCompanyId, issue.id)).rejects.toThrow();
  });

  it("creates, updates, and deletes a scheduling routine", async () => {
    const { companyId, agentId, svc } = await seedFixture();
    const routine = await svc.createRoutine(
      companyId,
      {
        title: "Daily standup notes",
        assigneeAgentId: agentId,
        recurrenceRule: { kind: "daily" },
        scheduledTime: "09:00",
        estimateMinutes: 15,
      },
      { agentId: null, userId: "creator-user" },
    );
    expect(routine.status).toBe("active");
    expect(routine.createdByUserId).toBe("creator-user");

    const updated = await svc.updateRoutine(companyId, routine.id, { status: "paused", estimateMinutes: 20 });
    expect(updated.status).toBe("paused");
    expect(updated.estimateMinutes).toBe(20);

    const list = await svc.listRoutines(companyId);
    expect(list.map((r) => r.id)).toContain(routine.id);

    const deleted = await svc.deleteRoutine(companyId, routine.id);
    expect(deleted).toBe(true);
    await expect(svc.getRoutine(companyId, routine.id)).rejects.toThrow();
  });

  it("materializes issues for a weekly routine going forward, is idempotent, and catches up after a gap", async () => {
    const { companyId, agentId, svc } = await seedFixture();
    const routine = await svc.createRoutine(
      companyId,
      {
        title: "Weekly planning",
        assigneeAgentId: agentId,
        recurrenceRule: { kind: "weekly", daysOfWeek: [3] }, // Wednesday
        estimateMinutes: 30,
      },
      { agentId: null, userId: null },
    );

    // A fresh routine (no lastGeneratedForDate) only generates for `asOf` itself, not a backfill.
    const firstAsOf = new Date("2026-08-19T12:00:00.000Z"); // Wednesday
    const first = await svc.generateDueIssuesForRoutine(companyId, routine.id, { asOf: firstAsOf, maxDays: 14 });
    expect(first.createdIssueIds).toHaveLength(1);
    expect(first.lastGeneratedForDate).toBe("2026-08-19");

    const scheduled = await svc.listScheduledIssues(companyId, {});
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]!.scheduledDurationMinutes).toBe(30);
    expect(scheduled[0]!.assigneeAgentId).toBe(agentId);

    // Re-running for the same date is a no-op.
    const repeat = await svc.generateDueIssuesForRoutine(companyId, routine.id, { asOf: firstAsOf, maxDays: 14 });
    expect(repeat.createdIssueIds).toHaveLength(0);
    expect(repeat.lastGeneratedForDate).toBe("2026-08-19");

    // Two weeks pass with no ticks; catching up should backfill the Wednesdays within the lookback window.
    const laterAsOf = new Date("2026-09-02T12:00:00.000Z"); // Wednesday, two weeks later
    const caughtUp = await svc.generateDueIssuesForRoutine(companyId, routine.id, { asOf: laterAsOf, maxDays: 14 });
    expect(caughtUp.createdIssueIds).toHaveLength(2); // 2026-08-26 and 2026-09-02
    expect(caughtUp.lastGeneratedForDate).toBe("2026-09-02");

    const allScheduled = await svc.listScheduledIssues(companyId, {});
    expect(allScheduled).toHaveLength(3);
  });

  it("does not generate issues for a paused routine", async () => {
    const { companyId, svc } = await seedFixture();
    const routine = await svc.createRoutine(
      companyId,
      { title: "Paused task", recurrenceRule: { kind: "daily" } },
      { agentId: null, userId: null },
    );
    await svc.updateRoutine(companyId, routine.id, { status: "paused" });

    const result = await svc.generateDueIssuesForRoutine(companyId, routine.id, {
      asOf: new Date("2026-08-19T12:00:00.000Z"),
    });
    expect(result.createdIssueIds).toHaveLength(0);
  });
});
