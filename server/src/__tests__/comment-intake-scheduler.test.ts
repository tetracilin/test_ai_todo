import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  agents,
  authUsers,
  commentIntakeCheckpoints,
  commentIntakeRuns,
  commentIntakeSources,
  companies,
  createDb,
  developmentCommentIntakes,
  issueComments,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { commentIntakeService } from "../services/comment-intake.js";

// Same controllable issue-service mock the poller suite uses: default calls
// through to the real implementation, individual tests can force failures.
vi.mock("../services/issues.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/issues.js")>();
  return { ...actual, issueService: vi.fn(actual.issueService) };
});

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres comment intake scheduler tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

const BASE_NOW = new Date("2026-08-30T12:00:00.000Z");
const SIX_MINUTES_MS = 6 * 60 * 1000;

describeEmbeddedPostgres("comment intake scheduler guards and policy", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-comment-intake-scheduler-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  beforeEach(async () => {
    await db.delete(developmentCommentIntakes);
    await db.delete(commentIntakeRuns);
    await db.delete(commentIntakeCheckpoints);
    await db.delete(commentIntakeSources);
    await db.delete(issueComments);
    await db.delete(agents);
    await db.delete(issues);
    await db.delete(authUsers);
    await db.delete(companies);
  });

  async function seedCompany(prefix: string) {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: `${prefix} Company`,
      issuePrefix: prefix,
      requireBoardApprovalForNewAgents: false,
    });
    return companyId;
  }

  async function seedUser(userId = randomUUID()) {
    const createdAt = new Date("2026-08-01T00:00:00.000Z");
    await db.insert(authUsers).values({
      id: userId,
      name: "Verified Human",
      email: `${userId}@example.com`,
      emailVerified: true,
      createdAt,
      updatedAt: createdAt,
    });
    return userId;
  }

  async function seedIssue(companyId: string) {
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Source issue",
      description: "Seed issue",
      status: "backlog",
      priority: "medium",
    });
    return issueId;
  }

  async function seedSource(companyId: string) {
    const sourceId = randomUUID();
    await db.insert(commentIntakeSources).values({
      id: sourceId,
      companyId,
      providerKey: "paperclip",
      objectType: "issue_comment",
      sourceScopeId: companyId,
      enabled: true,
      tag: "@dev",
    });
    return sourceId;
  }

  async function seedComment(companyId: string, issueId: string, authorUserId: string) {
    await db.insert(issueComments).values({
      id: randomUUID(),
      companyId,
      issueId,
      authorUserId,
      authorAgentId: null,
      body: "@dev complaint: scheduler feedback",
      deletedAt: null,
      createdAt: new Date(BASE_NOW.getTime() - 60_000),
      updatedAt: new Date(BASE_NOW.getTime() - 60_000),
    });
  }

  async function sourceRow(sourceId: string) {
    const [row] = await db.select().from(commentIntakeSources).where(eq(commentIntakeSources.id, sourceId));
    return row!;
  }

  async function seedRunningRun(companyId: string, sourceId: string, startedAt: Date) {
    const [run] = await db.insert(commentIntakeRuns).values({
      companyId,
      sourceId,
      status: "running",
      startedAt,
    }).returning();
    return run!;
  }

  it("skips a source while a previous run is still active (single-run guard)", async () => {
    const companyId = await seedCompany("GRD");
    const userId = await seedUser();
    const issueId = await seedIssue(companyId);
    const sourceId = await seedSource(companyId);
    await seedComment(companyId, issueId, userId);
    await seedRunningRun(companyId, sourceId, new Date(BASE_NOW.getTime() - 60_000));

    const result = await commentIntakeService(db).runSource(await sourceRow(sourceId), BASE_NOW);

    expect(result).toEqual({ sourceId, skipped: "already_running" });
    const runs = await db.select().from(commentIntakeRuns);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("running");
    expect(await db.select().from(developmentCommentIntakes)).toHaveLength(0);
  });

  it("reaps a stale running run past the run timeout, then proceeds", async () => {
    const companyId = await seedCompany("REAP");
    const userId = await seedUser();
    const issueId = await seedIssue(companyId);
    const sourceId = await seedSource(companyId);
    await seedComment(companyId, issueId, userId);
    // Started 10 minutes ago; default run timeout is 5 minutes.
    await seedRunningRun(companyId, sourceId, new Date(BASE_NOW.getTime() - 10 * 60_000));

    const result = await commentIntakeService(db).runSource(await sourceRow(sourceId), BASE_NOW);

    expect(result).toMatchObject({ sourceId, status: "succeeded", createdCount: 1 });
    const runs = await db.select().from(commentIntakeRuns).orderBy(commentIntakeRuns.startedAt);
    expect(runs).toHaveLength(2);
    const reaped = runs[0]!;
    expect(reaped.status).toBe("failed");
    expect(reaped.errorCode).toBe("timeout");
    expect(reaped.errorDetail).toBe("run exceeded configured timeout");
    expect(runs[1]!.status).toBe("succeeded");
    expect(await db.select().from(developmentCommentIntakes)).toHaveLength(1);
  });

  it("auto-disables a source after the configured number of consecutive failures", async () => {
    const companyId = await seedCompany("AUTO");
    const userId = await seedUser();
    const issueId = await seedIssue(companyId);
    const sourceId = await seedSource(companyId);
    await seedComment(companyId, issueId, userId);

    const service = commentIntakeService(db, { maxConsecutiveFailures: 2 });
    const issuesModule = await import("../services/issues.js");
    const issueServiceMock = vi.mocked(issuesModule.issueService);
    issueServiceMock.mockClear();
    issueServiceMock.mockImplementation(() => {
      throw Object.assign(new Error("connection reset"), { code: "database_error" });
    });

    const first = await service.runSource(await sourceRow(sourceId), BASE_NOW);
    expect(first).toMatchObject({ failed: true, errorCode: "database_error" });
    let [sourceAfterFirst] = await db.select().from(commentIntakeSources).where(eq(commentIntakeSources.id, sourceId));
    expect(sourceAfterFirst!.enabled).toBe(true);

    const second = await service.runSource(
      await sourceRow(sourceId),
      new Date(BASE_NOW.getTime() + SIX_MINUTES_MS),
    );
    expect(second).toMatchObject({ failed: true, errorCode: "database_error" });

    const [sourceAfterSecond] = await db.select().from(commentIntakeSources).where(eq(commentIntakeSources.id, sourceId));
    expect(sourceAfterSecond!.enabled).toBe(false);
    const [checkpoint] = await db.select().from(commentIntakeCheckpoints);
    expect(checkpoint!.consecutiveFailureCount).toBe(2);
    expect(checkpoint!.lastErrorCode).toBe("database_error");

    // A disabled source is ignored by runDue.
    issueServiceMock.mockRestore();
    const due = await service.runDue(new Date(BASE_NOW.getTime() + 2 * SIX_MINUTES_MS));
    expect(due).toEqual([]);
  });

  it("respects the configured poll interval for the not-due gate", async () => {
    const companyId = await seedCompany("IVL");
    const userId = await seedUser();
    const issueId = await seedIssue(companyId);
    const sourceId = await seedSource(companyId);
    await seedComment(companyId, issueId, userId);

    const service = commentIntakeService(db, { pollIntervalMs: 60_000 });
    const first = await service.runSource(await sourceRow(sourceId), BASE_NOW);
    expect(first).toMatchObject({ status: "succeeded", createdCount: 1 });

    // 30s later: inside the 60s interval -> not due.
    const early = await service.runSource(await sourceRow(sourceId), new Date(BASE_NOW.getTime() + 30_000));
    expect(early).toEqual({ sourceId, skipped: "not_due" });

    // 90s later: past the interval -> due again.
    const later = await service.runSource(await sourceRow(sourceId), new Date(BASE_NOW.getTime() + 90_000));
    expect(later).toMatchObject({ status: "succeeded" });
  });

  it("does no work when the scheduler is disabled", async () => {
    const companyId = await seedCompany("OFF");
    const userId = await seedUser();
    const issueId = await seedIssue(companyId);
    const sourceId = await seedSource(companyId);
    await seedComment(companyId, issueId, userId);

    const service = commentIntakeService(db, { enabled: false });
    const results = await service.runDue(BASE_NOW);

    expect(results).toEqual([{ skipped: "disabled" }]);
    expect(await db.select().from(commentIntakeRuns)).toHaveLength(0);
    expect(await db.select().from(developmentCommentIntakes)).toHaveLength(0);
  });

  it("honors the configured batch size across ticks", async () => {
    const companyId = await seedCompany("BAT");
    const userId = await seedUser();
    const issueId = await seedIssue(companyId);
    const sourceId = await seedSource(companyId);
    for (let index = 0; index < 2; index += 1) {
      const createdAt = new Date(BASE_NOW.getTime() - 120_000 + index * 60_000);
      await db.insert(issueComments).values({
        id: randomUUID(),
        companyId,
        issueId,
        authorUserId: userId,
        authorAgentId: null,
        body: `@dev complaint: batch feedback ${index}`,
        deletedAt: null,
        createdAt,
        updatedAt: createdAt,
      });
    }

    const service = commentIntakeService(db, { batchSize: 1 });
    const first = await service.runSource(await sourceRow(sourceId), BASE_NOW);
    expect(first).toMatchObject({ status: "succeeded", createdCount: 1 });

    const second = await service.runSource(
      await sourceRow(sourceId),
      new Date(BASE_NOW.getTime() + SIX_MINUTES_MS),
    );
    expect(second).toMatchObject({ status: "succeeded", createdCount: 1 });

    const intakes = await db.select().from(developmentCommentIntakes);
    expect(intakes).toHaveLength(2);
    expect(new Set(intakes.map((row) => row.dedupeKey)).size).toBe(2);
  });
});
