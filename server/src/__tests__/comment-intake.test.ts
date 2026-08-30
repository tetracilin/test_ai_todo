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
import { commentIntakeDedupeKey } from "../services/comment-intake-text.js";

// Wrap the real issue service in a controllable mock so a single tick can be
// forced to fail mid-transaction while every other test keeps the real create
// path (vi.fn calls through to `actual.issueService` by default).
vi.mock("../services/issues.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/issues.js")>();
  return { ...actual, issueService: vi.fn(actual.issueService) };
});

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres comment intake poller tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

const BASE_NOW = new Date("2026-08-30T12:00:00.000Z");
const SIX_MINUTES_MS = 6 * 60 * 1000;

describeEmbeddedPostgres("comment intake poller", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-comment-intake-poller-");
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
    const rows = await db.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.originKind, "comment_intake")));
    return rows;
  }

  it("creates a complaint backlog issue from a verified human comment", async () => {
    const companyId = await seedCompany("HPC");
    const userId = await seedUser();
    const issueId = await seedIssue(companyId);
    const sourceId = await seedSource(companyId);
    await seedComment(companyId, issueId, { authorUserId: userId, body: "@dev complaint: the export button is broken" });

    const result = await commentIntakeService(db).runSource(await sourceRow(sourceId), BASE_NOW);

    expect(result).toMatchObject({ sourceId, status: "succeeded", candidateCount: 1, createdCount: 1, duplicateCount: 0, rejectedCount: 0 });

    const [intake] = await db.select().from(developmentCommentIntakes);
    expect(intake).toMatchObject({
      companyId,
      sourceId,
      kind: "complaint",
      intakeStatus: "backlog_created",
      subject: "the export button is broken",
      requestBody: "@dev complaint: the export button is broken",
      sourceCommentId: expect.any(String),
      sourceAuthorUserId: userId,
      backlogIssueId: expect.any(String),
    });
    expect(intake.dedupeKey).toBe(commentIntakeDedupeKey({
      companyId,
      providerKey: "paperclip",
      objectType: "issue_comment",
      sourceScopeId: companyId,
      sourceCommentId: intake.sourceCommentId,
    }));

    const [backlog] = await countBacklogIssues(companyId);
    expect(backlog).toMatchObject({
      title: "[complaint] the export button is broken",
      status: "backlog",
      originKind: "comment_intake",
      originId: intake.id,
    });
    expect(backlog.description).toContain("Source issue ID:");
    expect(backlog.description).toContain("Category: complaint");
    expect(backlog.description).toContain("@dev complaint: the export button is broken");
  });

  it("creates a suggestion backlog issue", async () => {
    const companyId = await seedCompany("HPS");
    const userId = await seedUser();
    const issueId = await seedIssue(companyId);
    const sourceId = await seedSource(companyId);
    await seedComment(companyId, issueId, { authorUserId: userId, body: "@dev suggestion: add dark mode" });

    const result = await commentIntakeService(db).runSource(await sourceRow(sourceId), BASE_NOW);

    expect(result).toMatchObject({ status: "succeeded", createdCount: 1 });
    const [intake] = await db.select().from(developmentCommentIntakes);
    expect(intake).toMatchObject({ kind: "suggestion", intakeStatus: "backlog_created", subject: "add dark mode" });
    const [backlog] = await countBacklogIssues(companyId);
    expect(backlog!.title).toBe("[suggestion] add dark mode");
  });

  it("skips comments with no @dev tag and tags inside code fences", async () => {
    const companyId = await seedCompany("EXC");
    const userId = await seedUser();
    const issueId = await seedIssue(companyId);
    const sourceId = await seedSource(companyId);
    await seedComment(companyId, issueId, { authorUserId: userId, body: "just a normal comment" });
    await seedComment(companyId, issueId, { authorUserId: userId, body: "```\n@dev complaint: inside a fence\n```" });
    await seedComment(companyId, issueId, { authorUserId: userId, body: "user@dev.example @developer" });

    const result = await commentIntakeService(db).runSource(await sourceRow(sourceId), BASE_NOW);

    expect(result).toMatchObject({ candidateCount: 0, createdCount: 0 });
    const intakes = await db.select().from(developmentCommentIntakes);
    expect(intakes).toHaveLength(0);
    expect(await countBacklogIssues(companyId)).toHaveLength(0);
  });

  it("excludes agent-authored comments", async () => {
    const companyId = await seedCompany("AGA");
    const userId = await seedUser();
    const agentId = await seedAgent(companyId);
    const issueId = await seedIssue(companyId);
    const sourceId = await seedSource(companyId);
    await seedComment(companyId, issueId, {
      authorUserId: userId,
      authorAgentId: agentId,
      body: "@dev complaint: agent says the export is broken",
    });

    const result = await commentIntakeService(db).runSource(await sourceRow(sourceId), BASE_NOW);

    expect(result).toMatchObject({ candidateCount: 0, createdCount: 0 });
    expect(await db.select().from(developmentCommentIntakes)).toHaveLength(0);
  });

  it("excludes comments from authors not present in auth_users", async () => {
    const companyId = await seedCompany("AUT");
    const issueId = await seedIssue(companyId);
    const sourceId = await seedSource(companyId);
    // Author id does not correspond to any auth_users row.
    await seedComment(companyId, issueId, { authorUserId: "ghost-user", body: "@dev complaint: unverified author" });

    const result = await commentIntakeService(db).runSource(await sourceRow(sourceId), BASE_NOW);

    expect(result).toMatchObject({ candidateCount: 0, createdCount: 0 });
    expect(await db.select().from(developmentCommentIntakes)).toHaveLength(0);
  });

  it("excludes soft-deleted comments", async () => {
    const companyId = await seedCompany("DEL");
    const userId = await seedUser();
    const issueId = await seedIssue(companyId);
    const sourceId = await seedSource(companyId);
    await seedComment(companyId, issueId, {
      authorUserId: userId,
      body: "@dev complaint: deleted feedback",
      deletedAt: new Date("2026-08-29T00:00:00.000Z"),
    });

    const result = await commentIntakeService(db).runSource(await sourceRow(sourceId), BASE_NOW);

    expect(result).toMatchObject({ candidateCount: 0, createdCount: 0 });
    expect(await db.select().from(developmentCommentIntakes)).toHaveLength(0);
  });

  it("excludes comments whose issue belongs to another company", async () => {
    const companyId = await seedCompany("CRO");
    const otherCompanyId = await seedCompany("CRO2");
    const userId = await seedUser();
    const otherIssueId = await seedIssue(otherCompanyId);
    const sourceId = await seedSource(companyId);
    await seedComment(companyId, otherIssueId, { authorUserId: userId, body: "@dev complaint: wrong company issue" });

    const result = await commentIntakeService(db).runSource(await sourceRow(sourceId), BASE_NOW);

    expect(result).toMatchObject({ candidateCount: 0, createdCount: 0 });
    expect(await db.select().from(developmentCommentIntakes)).toHaveLength(0);
  });

  it("deduplicates reruns including overlap replay: one intake, one backlog", async () => {
    const companyId = await seedCompany("DED");
    const userId = await seedUser();
    const issueId = await seedIssue(companyId);
    const sourceId = await seedSource(companyId);
    const comment = await seedComment(companyId, issueId, { authorUserId: userId, body: "@dev complaint: duplicate me" });

    const service = commentIntakeService(db);
    const first = await service.runSource(await sourceRow(sourceId), BASE_NOW);
    expect(first).toMatchObject({ status: "succeeded", createdCount: 1 });

    // Second tick inside the 5-minute poll gate would be skipped as not_due;
    // use a later timestamp to exercise the actual replay path.
    const second = await service.runSource(await sourceRow(sourceId), new Date(BASE_NOW.getTime() + SIX_MINUTES_MS));
    expect(second).toMatchObject({ status: "succeeded", createdCount: 0 });

    const intakes = await db.select().from(developmentCommentIntakes);
    expect(intakes).toHaveLength(1);
    expect(intakes[0]!.sourceCommentId).toBe(comment.id);
    expect(await countBacklogIssues(companyId)).toHaveLength(1);
  });

  it("resumes a stalled new intake after a crash between insert and backlog create", async () => {
    const companyId = await seedCompany("RSM");
    const userId = await seedUser();
    const issueId = await seedIssue(companyId);
    const sourceId = await seedSource(companyId);
    const comment = await seedComment(companyId, issueId, { authorUserId: userId, body: "@dev complaint: crash recovery" });

    // Simulate the previous tick having inserted the intake then crashed
    // before the backlog issue create completed.
    const dedupeKey = commentIntakeDedupeKey({
      companyId,
      providerKey: "paperclip",
      objectType: "issue_comment",
      sourceScopeId: companyId,
      sourceCommentId: comment.id,
    });
    const [stalled] = await db.insert(developmentCommentIntakes).values({
      companyId,
      sourceId,
      sourceCommentId: comment.id,
      sourceIssueId: issueId,
      sourceAuthorUserId: userId,
      sourceCreatedAt: comment.createdAt,
      sourceUpdatedAt: comment.updatedAt,
      sourceUrl: null,
      tag: "@dev",
      tagPositions: [{ start: 0, end: 4 }],
      kind: "complaint",
      subject: "crash recovery",
      requestBody: "@dev complaint: crash recovery",
      contentFingerprint: "fingerprint",
      dedupeKey,
      intakeStatus: "new",
      backlogIssueId: null,
    }).returning();
    expect(stalled).toBeDefined();

    const result = await commentIntakeService(db).runSource(await sourceRow(sourceId), BASE_NOW);

    expect(result).toMatchObject({ status: "succeeded", createdCount: 1, duplicateCount: 0 });
    const [intake] = await db.select().from(developmentCommentIntakes);
    expect(intake!.intakeStatus).toBe("backlog_created");
    expect(intake!.backlogIssueId).not.toBeNull();
    const [backlog] = await countBacklogIssues(companyId);
    expect(backlog!.originId).toBe(intake!.id);

    // Rerun must not create a second issue (idempotency key path).
    const second = await commentIntakeService(db).runSource(await sourceRow(sourceId), new Date(BASE_NOW.getTime() + SIX_MINUTES_MS));
    expect(second).toMatchObject({ createdCount: 0 });
    expect(await countBacklogIssues(companyId)).toHaveLength(1);
  });

  it("redacts secrets: intake redacted, no backlog, partial failure tolerated", async () => {
    const companyId = await seedCompany("SEC");
    const userId = await seedUser();
    const issueId = await seedIssue(companyId);
    const sourceId = await seedSource(companyId);
    await seedComment(companyId, issueId, { authorUserId: userId, body: "@dev complaint: token is sk-abc123secret" });
    await seedComment(companyId, issueId, { authorUserId: userId, body: "@dev suggestion: also add a clean one" });

    const result = await commentIntakeService(db).runSource(await sourceRow(sourceId), BASE_NOW);

    // One rejected (redacted), one created → partial success.
    expect(result).toMatchObject({ status: "partial", createdCount: 1, rejectedCount: 1 });

    const intakes = await db.select().from(developmentCommentIntakes).orderBy(developmentCommentIntakes.kind);
    const redacted = intakes.find((row) => row.intakeStatus === "redacted");
    const created = intakes.find((row) => row.intakeStatus === "backlog_created");
    expect(redacted).toMatchObject({
      dismissedReasonCode: "secret_detected",
      requestBody: null,
      backlogIssueId: null,
    });
    expect(redacted!.redactedAt).not.toBeNull();
    expect(created).toMatchObject({ kind: "suggestion", intakeStatus: "backlog_created" });
    expect(await countBacklogIssues(companyId)).toHaveLength(1);
  });

  it("marks an edited source intake as triaged and leaves the backlog untouched", async () => {
    const companyId = await seedCompany("TRI");
    const userId = await seedUser();
    const issueId = await seedIssue(companyId);
    const sourceId = await seedSource(companyId);
    const comment = await seedComment(companyId, issueId, {
      authorUserId: userId,
      body: "@dev complaint: original wording",
      createdAt: new Date("2026-08-20T00:00:00.000Z"),
      updatedAt: new Date("2026-08-20T00:00:00.000Z"),
    });

    const service = commentIntakeService(db);
    const first = await service.runSource(await sourceRow(sourceId), BASE_NOW);
    expect(first).toMatchObject({ createdCount: 1 });
    const [backlogBefore] = await countBacklogIssues(companyId);

    // Edit the source comment after the backlog issue was created.
    await db.update(issueComments).set({
      body: "@dev complaint: edited wording",
      updatedAt: new Date("2026-08-21T00:00:00.000Z"),
    }).where(eq(issueComments.id, comment.id));

    const second = await service.runSource(await sourceRow(sourceId), new Date(BASE_NOW.getTime() + SIX_MINUTES_MS));
    expect(second).toMatchObject({ status: "succeeded", updatedCount: 1 });

    const [intake] = await db.select().from(developmentCommentIntakes);
    expect(intake!.intakeStatus).toBe("triaged");

    const [backlogAfter] = await countBacklogIssues(companyId);
    expect(backlogAfter!.id).toBe(backlogBefore!.id);
    expect(backlogAfter!.title).toBe("[complaint] original wording");
  });

  it("paginates: processes 100 candidates per tick and resumes without gap or duplicate", async () => {
    const companyId = await seedCompany("PAG");
    const userId = await seedUser();
    const issueId = await seedIssue(companyId);
    const sourceId = await seedSource(companyId);

    const TOTAL = 105;
    const baseTime = new Date("2026-08-01T00:00:00.000Z");
    for (let index = 0; index < TOTAL; index += 1) {
      await seedComment(companyId, issueId, {
        authorUserId: userId,
        body: `@dev complaint: paginated feedback ${index}`,
        createdAt: new Date(baseTime.getTime() + index * 60_000),
        updatedAt: new Date(baseTime.getTime() + index * 60_000),
      });
    }

    const service = commentIntakeService(db);
    const first = await service.runSource(await sourceRow(sourceId), BASE_NOW);
    expect(first).toMatchObject({ status: "succeeded", pageCount: 1, createdCount: 100 });

    const [checkpoint] = await db.select().from(commentIntakeCheckpoints);
    expect(checkpoint!.consecutiveFailureCount).toBe(0);
    expect(checkpoint!.highWatermarkOccurredAt).not.toBeNull();
    expect(checkpoint!.highWatermarkId).not.toBeNull();

    // Second tick drains the remaining 5 fresh candidates (the replay window
    // re-reads a few already-processed rows, which are no-ops).
    const second = await service.runSource(await sourceRow(sourceId), new Date(BASE_NOW.getTime() + SIX_MINUTES_MS));
    expect(second).toMatchObject({ status: "succeeded", createdCount: 5 });

    const third = await service.runSource(await sourceRow(sourceId), new Date(BASE_NOW.getTime() + 2 * SIX_MINUTES_MS));
    expect(third).toMatchObject({ status: "succeeded", createdCount: 0 });

    const intakes = await db.select().from(developmentCommentIntakes);
    expect(intakes).toHaveLength(TOTAL);
    expect(new Set(intakes.map((row) => row.dedupeKey)).size).toBe(TOTAL);
    expect(await countBacklogIssues(companyId)).toHaveLength(TOTAL);
  });

  it("records a failed run with a sanitized error code, does not advance the watermark, and retries cleanly", async () => {
    const companyId = await seedCompany("RET");
    const userId = await seedUser();
    const issueId = await seedIssue(companyId);
    const sourceId = await seedSource(companyId);
    await seedComment(companyId, issueId, { authorUserId: userId, body: "@dev complaint: retry me" });

    const service = commentIntakeService(db);
    const issuesModule = await import("../services/issues.js");
    const issueServiceMock = vi.mocked(issuesModule.issueService);
    issueServiceMock.mockClear();

    // Force the backlog create to throw inside the poller transaction. The
    // error carries a database driver-style code so the sanitizer keeps it.
    issueServiceMock.mockImplementationOnce(() => {
      throw Object.assign(new Error("connection reset"), { code: "database_error" });
    });

    const failed = await service.runSource(await sourceRow(sourceId), BASE_NOW);
    expect(failed).toMatchObject({ sourceId, failed: true, errorCode: "database_error" });

    // Run row is failed with a sanitized error code and no raw payload.
    const [run] = await db.select().from(commentIntakeRuns);
    expect(run).toMatchObject({ status: "failed", errorCode: "database_error" });
    expect(run!.errorDetail).toBe("Error");
    expect(run!.errorDetail!.length).toBeLessThanOrEqual(120);

    // No intake was persisted (the transaction rolled back), the high
    // watermark was not advanced, and the failure counter incremented.
    expect(await db.select().from(developmentCommentIntakes)).toHaveLength(0);
    const [checkpoint] = await db.select().from(commentIntakeCheckpoints);
    expect(checkpoint!.highWatermarkOccurredAt).toBeNull();
    expect(checkpoint!.consecutiveFailureCount).toBe(1);
    expect(checkpoint!.lastErrorCode).toBe("database_error");
    expect(await countBacklogIssues(companyId)).toHaveLength(0);

    // The next tick reprocesses the same window and succeeds exactly once.
    issueServiceMock.mockRestore();
    const retried = await service.runSource(await sourceRow(sourceId), new Date(BASE_NOW.getTime() + SIX_MINUTES_MS));
    expect(retried).toMatchObject({ status: "succeeded", createdCount: 1 });

    const [checkpointAfter] = await db.select().from(commentIntakeCheckpoints);
    expect(checkpointAfter!.consecutiveFailureCount).toBe(0);
    expect(checkpointAfter!.lastErrorCode).toBeNull();
    expect(await db.select().from(developmentCommentIntakes)).toHaveLength(1);
    expect(await countBacklogIssues(companyId)).toHaveLength(1);
  });

  it("collapses non-database error codes to unexpected_error", async () => {
    const companyId = await seedCompany("SANE");
    const userId = await seedUser();
    const issueId = await seedIssue(companyId);
    const sourceId = await seedSource(companyId);
    await seedComment(companyId, issueId, { authorUserId: userId, body: "@dev complaint: sanitize codes" });

    const service = commentIntakeService(db);
    const issuesModule = await import("../services/issues.js");
    const issueServiceMock = vi.mocked(issuesModule.issueService);
    issueServiceMock.mockClear();
    issueServiceMock.mockImplementationOnce(() => {
      throw new Error("boom");
    });

    const failed = await service.runSource(await sourceRow(sourceId), BASE_NOW);
    expect(failed).toMatchObject({ failed: true, errorCode: "unexpected_error" });

    const [run] = await db.select().from(commentIntakeRuns);
    expect(run!.status).toBe("failed");
    expect(run!.errorCode).toBe("unexpected_error");
    expect(run!.errorDetail).toBe("Error");
  });

  it("skips sources that are not due and reports unsupported sources", async () => {
    const companyId = await seedCompany("SKP");
    const userId = await seedUser();
    const issueId = await seedIssue(companyId);
    const sourceId = await seedSource(companyId);
    await seedComment(companyId, issueId, { authorUserId: userId, body: "@dev complaint: skip checks" });

    const service = commentIntakeService(db);
    await service.runSource(await sourceRow(sourceId), BASE_NOW);

    // Second call inside the 5-minute poll gate is skipped as not_due.
    const early = await service.runSource(await sourceRow(sourceId), new Date(BASE_NOW.getTime() + 60_000));
    expect(early).toMatchObject({ sourceId, skipped: "not_due" });

    // A source with an unsupported provider/scope is skipped.
    const [unsupported] = await db.insert(commentIntakeSources).values({
      id: randomUUID(),
      companyId,
      providerKey: "github",
      objectType: "issue_comment",
      sourceScopeId: "external",
      enabled: true,
      tag: "@dev",
    }).returning();
    const unsupportedResult = await service.runSource(unsupported!, new Date(BASE_NOW.getTime() + SIX_MINUTES_MS));
    expect(unsupportedResult).toMatchObject({ sourceId: unsupported!.id, skipped: "unsupported_source" });
  });
});