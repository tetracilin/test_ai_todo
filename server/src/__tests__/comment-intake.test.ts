import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
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
import { commentIntakeDedupeKey } from "../services/comment-intake-text.js";
import { developmentCommentIntakeRoutes } from "../routes/development-comment-intakes.js";
import { errorHandler } from "../middleware/index.js";

// Wrap the real issue service in a controllable mock so a single tick can be
// forced to fail mid-transaction (the "kill mid-run" recovery scenario) while
// every other test keeps the real create path (vi.fn calls through to the
// actual implementation by default).
vi.mock("../services/issues.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/issues.js")>();
  return { ...actual, issueService: vi.fn(actual.issueService) };
});

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres comment intake integration tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

const BASE_NOW = new Date("2026-08-30T12:00:00.000Z");
const SIX_MINUTES_MS = 6 * 60 * 1000;

describeEmbeddedPostgres("comment intake end-to-end (real Postgres)", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-comment-intake-e2e-");
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

  async function seedAgent(companyId: string) {
    const agentId = randomUUID();
    await db.insert(agents).values({ id: agentId, companyId, name: "Agent" });
    return agentId;
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

  async function seedIssue(
    companyId: string,
    overrides: Partial<{ id: string; title: string; status: string; identifier: string }> = {},
  ) {
    const issueId = overrides.id ?? randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: overrides.title ?? "Source issue",
      description: "Seed issue",
      status: overrides.status ?? "backlog",
      priority: "medium",
      identifier: overrides.identifier,
    });
    return issueId;
  }

  async function seedSource(companyId: string, overrides: Partial<{ enabled: boolean; tag: string }> = {}) {
    const sourceId = randomUUID();
    await db.insert(commentIntakeSources).values({
      id: sourceId,
      companyId,
      providerKey: "paperclip",
      objectType: "issue_comment",
      sourceScopeId: companyId,
      enabled: overrides.enabled ?? true,
      tag: overrides.tag ?? "@dev",
    });
    return sourceId;
  }

  async function seedComment(
    companyId: string,
    issueId: string,
    overrides: Partial<{
      id: string;
      body: string;
      authorUserId: string;
      authorAgentId: string;
      deletedAt: Date;
      createdAt: Date;
      updatedAt: Date;
    }> = {},
  ) {
    const commentId = overrides.id ?? randomUUID();
    const commentCreatedAt = overrides.createdAt ?? new Date(BASE_NOW.getTime() - 60_000);
    const [comment] = await db.insert(issueComments).values({
      id: commentId,
      companyId,
      issueId,
      authorUserId: overrides.authorUserId ?? null,
      authorAgentId: overrides.authorAgentId ?? null,
      body: overrides.body ?? "@dev complaint: the export button is broken",
      deletedAt: overrides.deletedAt ?? null,
      createdAt: commentCreatedAt,
      updatedAt: overrides.updatedAt ?? commentCreatedAt,
    }).returning();
    return comment!;
  }

  async function sourceRow(sourceId: string) {
    const [row] = await db.select().from(commentIntakeSources).where(eq(commentIntakeSources.id, sourceId));
    return row!;
  }

  async function countBacklogIssues(companyId: string) {
    return db.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.originKind, "comment_intake")));
  }

  async function seedIntakeForQuery(
    companyId: string,
    sourceId: string,
    overrides: Partial<{
      sourceCommentId: string;
      kind: string;
      intakeStatus: string;
      sourceCreatedAt: Date;
      sourceUpdatedAt: Date;
      dedupeKey: string;
      backlogIssueId: string | null;
    }> = {},
  ) {
    const sourceCreatedAt = overrides.sourceCreatedAt ?? new Date("2026-08-30T10:00:00.000Z");
    const sourceUpdatedAt = overrides.sourceUpdatedAt ?? sourceCreatedAt;
    await db.insert(developmentCommentIntakes).values({
      companyId,
      sourceId,
      sourceCommentId: overrides.sourceCommentId ?? randomUUID(),
      sourceIssueId: null,
      sourceCreatedAt,
      sourceUpdatedAt,
      sourceUrl: null,
      tag: "@dev",
      kind: overrides.kind ?? "complaint",
      subject: "Seed subject",
      requestBody: "@dev complaint: Seed subject",
      contentFingerprint: randomUUID(),
      dedupeKey: overrides.dedupeKey ?? randomUUID(),
      intakeStatus: overrides.intakeStatus ?? "new",
      backlogIssueId: overrides.backlogIssueId ?? null,
    });
  }

  // ---- Requirement 1: tagged @dev comments ingest and create backlog items ----

  it("ingests a tagged @dev comment and creates a backlog issue with a persisted checkpoint", async () => {
    const companyId = await seedCompany("REQ1");
    const userId = await seedUser();
    const issueId = await seedIssue(companyId);
    const sourceId = await seedSource(companyId);
    const comment = await seedComment(companyId, issueId, {
      authorUserId: userId,
      body: "@dev complaint: the export button is broken",
    });

    const result = await commentIntakeService(db).runSource(await sourceRow(sourceId), BASE_NOW);

    expect(result).toMatchObject({
      sourceId,
      status: "succeeded",
      candidateCount: 1,
      createdCount: 1,
      duplicateCount: 0,
      rejectedCount: 0,
    });

    // Backlog item created.
    const [intake] = await db.select().from(developmentCommentIntakes);
    expect(intake).toMatchObject({
      companyId,
      sourceId,
      kind: "complaint",
      intakeStatus: "backlog_created",
      subject: "the export button is broken",
      requestBody: "@dev complaint: the export button is broken",
      sourceCommentId: comment.id,
      sourceAuthorUserId: userId,
      backlogIssueId: expect.any(String),
    });
    expect(intake!.dedupeKey).toBe(commentIntakeDedupeKey({
      companyId,
      providerKey: "paperclip",
      objectType: "issue_comment",
      sourceScopeId: companyId,
      sourceCommentId: comment.id,
    }));

    const [backlog] = await countBacklogIssues(companyId);
    expect(backlog).toMatchObject({
      title: "[complaint] the export button is broken",
      status: "backlog",
      originKind: "comment_intake",
      originId: intake!.id,
    });

    // Checkpoint advanced to the processed comment.
    const [checkpoint] = await db.select().from(commentIntakeCheckpoints);
    expect(checkpoint).toMatchObject({
      sourceId,
      highWatermarkId: comment.id,
      consecutiveFailureCount: 0,
      lastErrorCode: null,
    });
    expect(checkpoint!.highWatermarkOccurredAt).not.toBeNull();
    expect(checkpoint!.lastSuccessAt).not.toBeNull();

    // Run row recorded.
    const [run] = await db.select().from(commentIntakeRuns);
    expect(run).toMatchObject({ status: "succeeded", candidateCount: 1, createdCount: 1, duplicateCount: 0, rejectedCount: 0 });
  });

  it("classifies suggestion and needs_triage kinds into backlog issues", async () => {
    const companyId = await seedCompany("REQ1B");
    const userId = await seedUser();
    const issueId = await seedIssue(companyId);
    const sourceId = await seedSource(companyId);
    await seedComment(companyId, issueId, { authorUserId: userId, body: "@dev suggestion: add dark mode" });
    await seedComment(companyId, issueId, { authorUserId: userId, body: "@dev" });

    const result = await commentIntakeService(db).runSource(await sourceRow(sourceId), BASE_NOW);

    expect(result).toMatchObject({ createdCount: 2 });

    const intakes = await db.select().from(developmentCommentIntakes);
    const kinds = intakes.map((row) => row.kind).sort();
    expect(kinds).toEqual(["needs_triage", "suggestion"]);
    expect(await countBacklogIssues(companyId)).toHaveLength(2);
  });

  // ---- Requirement 2: re-run does not duplicate ----

  it("re-running ingestion does not create duplicate backlog items", async () => {
    const companyId = await seedCompany("REQ2");
    const userId = await seedUser();
    const issueId = await seedIssue(companyId);
    const sourceId = await seedSource(companyId);
    const comment = await seedComment(companyId, issueId, { authorUserId: userId, body: "@dev complaint: duplicate me" });

    const service = commentIntakeService(db);
    const first = await service.runSource(await sourceRow(sourceId), BASE_NOW);
    expect(first).toMatchObject({ status: "succeeded", createdCount: 1 });

    // Second tick past the 5-minute poll gate exercises the replay/dedupe path.
    const second = await service.runSource(await sourceRow(sourceId), new Date(BASE_NOW.getTime() + SIX_MINUTES_MS));
    // The overlap replay re-reads the already-processed source, recognizes it
    // as an existing intake (duplicateCount 1), and creates no new work.
    expect(second).toMatchObject({ status: "succeeded", createdCount: 0, duplicateCount: 1 });

    const intakes = await db.select().from(developmentCommentIntakes);
    expect(intakes).toHaveLength(1);
    expect(intakes[0]!.sourceCommentId).toBe(comment.id);
    expect(await countBacklogIssues(companyId)).toHaveLength(1);
  });

  // ---- Requirement 3: untagged comments excluded ----

  it("excludes untagged, code-fenced, and lookalike comments", async () => {
    const companyId = await seedCompany("REQ3");
    const userId = await seedUser();
    const issueId = await seedIssue(companyId);
    const sourceId = await seedSource(companyId);
    await seedComment(companyId, issueId, { authorUserId: userId, body: "just a normal comment" });
    await seedComment(companyId, issueId, { authorUserId: userId, body: "```\n@dev complaint: inside a fence\n```" });
    await seedComment(companyId, issueId, { authorUserId: userId, body: "user@dev.example @developer @dev-team" });

    const result = await commentIntakeService(db).runSource(await sourceRow(sourceId), BASE_NOW);

    expect(result).toMatchObject({ candidateCount: 0, createdCount: 0 });
    expect(await db.select().from(developmentCommentIntakes)).toHaveLength(0);
    expect(await countBacklogIssues(companyId)).toHaveLength(0);
  });

  it("excludes agent-authored and soft-deleted comments", async () => {
    const companyId = await seedCompany("REQ3B");
    const userId = await seedUser();
    const agentId = await seedAgent(companyId);
    const issueId = await seedIssue(companyId);
    const sourceId = await seedSource(companyId);
    await seedComment(companyId, issueId, {
      authorUserId: userId,
      authorAgentId: agentId,
      body: "@dev complaint: agent authored",
    });
    await seedComment(companyId, issueId, {
      authorUserId: userId,
      body: "@dev complaint: soft deleted",
      deletedAt: new Date("2026-08-29T00:00:00.000Z"),
    });

    const result = await commentIntakeService(db).runSource(await sourceRow(sourceId), BASE_NOW);

    expect(result).toMatchObject({ candidateCount: 0, createdCount: 0 });
    expect(await db.select().from(developmentCommentIntakes)).toHaveLength(0);
    expect(await countBacklogIssues(companyId)).toHaveLength(0);
  });

  // ---- Requirement 4: query endpoint filters and paginates ----

  it("filters by kind/status/tag and paginates with a filter-bound cursor (no dup, no gap)", async () => {
    const companyId = await seedCompany("REQ4");
    const sourceId = await seedSource(companyId);
    const timestamps = [
      "2026-08-01T00:00:00.000Z",
      "2026-08-02T00:00:00.000Z",
      "2026-08-03T00:00:00.000Z",
      "2026-08-04T00:00:00.000Z",
      "2026-08-05T00:00:00.000Z",
    ];
    for (const [index, timestamp] of timestamps.entries()) {
      await seedIntakeForQuery(companyId, sourceId, {
        sourceCommentId: `c-${index}`,
        kind: index % 2 === 0 ? "suggestion" : "complaint",
        sourceCreatedAt: new Date(timestamp),
        sourceUpdatedAt: new Date(timestamp),
        dedupeKey: `k-${index}`,
      });
    }

    const service = (await import("../services/development-comment-intakes.js")).developmentCommentIntakeService(db);

    // Filter by kind: 3 suggestions.
    const suggestions = await service.list(companyId, {
      tag: undefined, source: undefined, kind: "suggestion", status: [], backlogStatus: [],
      createdAfter: undefined, createdBefore: undefined, limit: 50, cursor: undefined,
    });
    expect(suggestions.items.map((item) => item.source.commentId)).toEqual(["c-4", "c-2", "c-0"]);

    // Paginate the full set with limit 2 -> 3 pages, correct DESC order, no dup.
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await service.list(companyId, {
        tag: undefined, source: undefined, kind: undefined, status: [], backlogStatus: [],
        createdAfter: undefined, createdBefore: undefined, limit: 2, cursor: cursor ?? undefined,
      });
      for (const item of page.items) seen.push(item.source.commentId);
      cursor = page.nextCursor;
      pages += 1;
      expect(page.items.length).toBeLessThanOrEqual(2);
    } while (cursor !== null && pages < 10);

    expect(pages).toBe(3);
    expect(seen).toEqual(["c-4", "c-3", "c-2", "c-1", "c-0"]);
    expect(new Set(seen).size).toBe(seen.length);

    // A cursor minted under a different filter set is rejected with 400.
    const firstPage = await service.list(companyId, {
      tag: undefined, source: undefined, kind: "suggestion", status: [], backlogStatus: [],
      createdAfter: undefined, createdBefore: undefined, limit: 2, cursor: undefined,
    });
    const suggestionCursor = firstPage.nextCursor;
    expect(suggestionCursor).not.toBeNull();
    await expect(
      service.list(companyId, {
        tag: undefined, source: undefined, kind: "complaint", status: [], backlogStatus: [],
        createdAfter: undefined, createdBefore: undefined, limit: 2, cursor: suggestionCursor,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("serves the query endpoint over HTTP with filtering and pagination", async () => {
    const companyId = await seedCompany("REQ4B");
    const sourceId = await seedSource(companyId);
    for (const [index, timestamp] of ["2026-08-01T00:00:00.000Z", "2026-08-02T00:00:00.000Z", "2026-08-03T00:00:00.000Z"].entries()) {
      await seedIntakeForQuery(companyId, sourceId, {
        sourceCommentId: `h-${index}`,
        kind: "complaint",
        sourceCreatedAt: new Date(timestamp),
        sourceUpdatedAt: new Date(timestamp),
        dedupeKey: `hk-${index}`,
      });
    }

    const app = createApp(db, {
      type: "agent", agentId: "agent-1", companyId, source: "agent_key",
    });

    const list = await request(app).get(`/api/companies/${companyId}/development-comment-intakes?kind=complaint&limit=2`);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(2);
    expect(list.body.items.map((item: { source: { commentId: string } }) => item.source.commentId)).toEqual(["h-2", "h-1"]);
    expect(list.body.nextCursor).not.toBeNull();

    const second = await request(app).get(
      `/api/companies/${companyId}/development-comment-intakes?kind=complaint&limit=2&cursor=${encodeURIComponent(list.body.nextCursor)}`,
    );
    expect(second.status).toBe(200);
    expect(second.body.items.map((item: { source: { commentId: string } }) => item.source.commentId)).toEqual(["h-0"]);
    expect(second.body.nextCursor).toBeNull();
  });

  it("rejects unauthorized and cross-company access to the query endpoint", async () => {
    const companyId = await seedCompany("REQ5");
    const otherCompanyId = "33333333-3333-4333-8333-333333333333";
    const sourceId = await seedSource(companyId);
    await seedIntakeForQuery(companyId, sourceId, { sourceCommentId: "c-auth", dedupeKey: "k-auth" });

    // 401 unauthenticated.
    const unauthenticated = createApp(db, { type: "none" });
    const res401 = await request(unauthenticated).get(`/api/companies/${companyId}/development-comment-intakes`);
    expect(res401.status).toBe(401);

    // 403 cross-company agent key.
    const crossCompany = createApp(db, { type: "agent", agentId: "agent-2", companyId: otherCompanyId, source: "agent_key" });
    const res403Agent = await request(crossCompany).get(`/api/companies/${companyId}/development-comment-intakes`);
    expect(res403Agent.status).toBe(403);

    // 403 board user without company access.
    const noAccessBoard = createApp(db, { type: "board", userId: "b-1", companyIds: [otherCompanyId], source: "session", isInstanceAdmin: false });
    const res403Board = await request(noAccessBoard).get(`/api/companies/${companyId}/development-comment-intakes`);
    expect(res403Board.status).toBe(403);

    // 404 indistinguishable for cross-company intake detail.
    const inCompany = createApp(db, { type: "board", userId: "b-2", companyIds: [companyId], source: "session", isInstanceAdmin: false });
    const intakes = await db.select().from(developmentCommentIntakes);
    const res404 = await request(inCompany).get(`/api/companies/${companyId}/development-comment-intakes/${intakes[0]!.id}`);
    expect(res404.status).toBe(200); // in-company board can read its own intake
  });

  // ---- Requirement 6: checkpoint recovery works ----

  it("recovers from a killed mid-run tick: atomic rollback leaves no partial state", async () => {
    const companyId = await seedCompany("REQ6A");
    const userId = await seedUser();
    const issueId = await seedIssue(companyId);
    const sourceId = await seedSource(companyId);
    const comment = await seedComment(companyId, issueId, { authorUserId: userId, body: "@dev complaint: crash recovery" });

    // A process killed mid-tick leaves behind an orphaned "running" run row
    // (the run insert happens outside the ingest transaction), but the intake
    // + backlog + checkpoint inserts are all in one transaction and roll back,
    // so no partial work survives.
    await db.insert(commentIntakeRuns).values({
      companyId,
      sourceId,
      status: "running",
      startedAt: new Date(BASE_NOW.getTime() - 60_000),
    });

    const result = await commentIntakeService(db).runSource(await sourceRow(sourceId), BASE_NOW);
    expect(result).toMatchObject({ status: "succeeded", createdCount: 1 });

    const [intake] = await db.select().from(developmentCommentIntakes);
    expect(intake!.intakeStatus).toBe("backlog_created");
    expect(intake!.backlogIssueId).not.toBeNull();
    expect(await countBacklogIssues(companyId)).toHaveLength(1);

    // The orphaned run row does not block recovery, and a re-run still does
    // not create a second issue.
    const second = await commentIntakeService(db).runSource(await sourceRow(sourceId), new Date(BASE_NOW.getTime() + SIX_MINUTES_MS));
    expect(second).toMatchObject({ createdCount: 0 });
    expect(await countBacklogIssues(companyId)).toHaveLength(1);
  });

  it("records a failed mid-run tick without advancing the watermark, then retries cleanly", async () => {
    const companyId = await seedCompany("REQ6B");
    const userId = await seedUser();
    const issueId = await seedIssue(companyId);
    const sourceId = await seedSource(companyId);
    await seedComment(companyId, issueId, { authorUserId: userId, body: "@dev complaint: retry me" });

    const service = commentIntakeService(db);
    const issuesModule = await import("../services/issues.js");
    const issueServiceMock = vi.mocked(issuesModule.issueService);
    issueServiceMock.mockClear();
    issueServiceMock.mockImplementationOnce(() => {
      throw Object.assign(new Error("connection reset"), { code: "database_error" });
    });

    const failed = await service.runSource(await sourceRow(sourceId), BASE_NOW);
    expect(failed).toMatchObject({ sourceId, failed: true, errorCode: "database_error" });

    // Run row failed with a sanitized error; nothing persisted, watermark not advanced.
    const [run] = await db.select().from(commentIntakeRuns);
    expect(run).toMatchObject({ status: "failed", errorCode: "database_error" });
    expect(await db.select().from(developmentCommentIntakes)).toHaveLength(0);
    expect(await countBacklogIssues(companyId)).toHaveLength(0);
    const [checkpoint] = await db.select().from(commentIntakeCheckpoints);
    expect(checkpoint!.highWatermarkOccurredAt).toBeNull();
    expect(checkpoint!.consecutiveFailureCount).toBe(1);
    expect(checkpoint!.lastErrorCode).toBe("database_error");

    // Next tick reprocesses the same window and succeeds exactly once.
    issueServiceMock.mockRestore();
    const retried = await service.runSource(await sourceRow(sourceId), new Date(BASE_NOW.getTime() + SIX_MINUTES_MS));
    expect(retried).toMatchObject({ status: "succeeded", createdCount: 1 });

    const [checkpointAfter] = await db.select().from(commentIntakeCheckpoints);
    expect(checkpointAfter!.consecutiveFailureCount).toBe(0);
    expect(checkpointAfter!.lastErrorCode).toBeNull();
    expect(await db.select().from(developmentCommentIntakes)).toHaveLength(1);
    expect(await countBacklogIssues(companyId)).toHaveLength(1);
  });
});

function createApp(db: ReturnType<typeof createDb>, actor: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { actor: unknown }).actor = {
      ...actor,
      companyIds: Array.isArray(actor.companyIds) ? [...(actor.companyIds as unknown[])] : actor.companyIds,
    };
    next();
  });
  app.use("/api", developmentCommentIntakeRoutes(db));
  app.use(errorHandler);
  return app;
}
