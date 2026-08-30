import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
import { parseCommentIntakeText } from "../services/comment-intake-text.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping independent QA comment intake tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

const BASE_NOW = new Date("2026-08-30T12:00:00.000Z");
const SIX_MINUTES_MS = 6 * 60 * 1000;

describeEmbeddedPostgres("independent QA: tagged-comment intake", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-qa-independent-");
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
    await db.insert(authUsers).values({
      id: userId,
      name: "Human",
      email: `${userId}@example.com`,
      emailVerified: true,
      createdAt: BASE_NOW,
      updatedAt: BASE_NOW,
    });
    return userId;
  }

  async function seedIssue(companyId: string) {
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Source issue",
      description: "Seed",
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

  async function seedComment(companyId: string, issueId: string, body: string, authorUserId: string) {
    await db.insert(issueComments).values({
      id: randomUUID(),
      companyId,
      issueId,
      authorUserId,
      authorAgentId: null,
      body,
      deletedAt: null,
      createdAt: new Date(BASE_NOW.getTime() - 60_000),
      updatedAt: new Date(BASE_NOW.getTime() - 60_000),
    });
  }

  async function sourceRow(sourceId: string) {
    const [row] = await db.select().from(commentIntakeSources).where(eq(commentIntakeSources.id, sourceId));
    return row!;
  }

  it("matches @dev only at exact token boundaries (case-insensitive), rejects lookalikes", () => {
    // Positive: visible @dev in various separators.
    expect(parseCommentIntakeText("(@DEV): please fix")).toMatchObject({ kind: "needs_triage" });
    expect(parseCommentIntakeText("@dev complaint: broken")).toMatchObject({ kind: "complaint" });
    expect(parseCommentIntakeText("@DEV suggestion - add it")).toMatchObject({ kind: "suggestion" });
    expect(parseCommentIntakeText("hi @dev issue the thing")).toMatchObject({ kind: "complaint" });
    // Negative: adjacent alphanumeric/_/- chars defeat the tag.
    expect(parseCommentIntakeText("user@dev.example")).toBeNull();
    expect(parseCommentIntakeText("@developer")).toBeNull();
    expect(parseCommentIntakeText("@dev-team")).toBeNull();
    expect(parseCommentIntakeText("foo@dev bar")).toBeNull();
    expect(parseCommentIntakeText("@dev0 thing")).toBeNull();
    // Code spans are not visible prose.
    expect(parseCommentIntakeText("`@dev complaint`")).toBeNull();
    expect(parseCommentIntakeText("```\n@dev complaint\n```")).toBeNull();
  });

  it("concurrent scheduler ticks create exactly one intake and one backlog issue", async () => {
    const companyId = await seedCompany("CONC");
    const userId = await seedUser();
    const issueId = await seedIssue(companyId);
    const sourceId = await seedSource(companyId);
    await seedComment(companyId, issueId, "@dev complaint: concurrency check", userId);

    const service = commentIntakeService(db);
    // Fire overlapping ticks from different clock instants so the not_due gate
    // does not serialize them; the advisory lock + idempotency key must absorb
    // the overlap and prevent double backlog creation.
    const results = await Promise.all([
      service.runSource(await sourceRow(sourceId), BASE_NOW),
      service.runSource(await sourceRow(sourceId), new Date(BASE_NOW.getTime() + 1)),
      service.runSource(await sourceRow(sourceId), new Date(BASE_NOW.getTime() + 2)),
    ]);

    const created = results.filter((r) => "createdCount" in r && (r as { createdCount: number }).createdCount > 0);
    expect(created.length).toBeLessThanOrEqual(1);

    const intakes = await db.select().from(developmentCommentIntakes);
    expect(intakes).toHaveLength(1);
    expect(intakes[0]!.intakeStatus).toBe("backlog_created");

    const backlogs = await db.select().from(issues).where(and(
      eq(issues.companyId, companyId),
      eq(issues.originKind, "comment_intake"),
    ));
    expect(backlogs).toHaveLength(1);
  });

  it("repeated processing of the same source creates one backlog item only", async () => {
    const companyId = await seedCompany("DUP2");
    const userId = await seedUser();
    const issueId = await seedIssue(companyId);
    const sourceId = await seedSource(companyId);
    await seedComment(companyId, issueId, "@dev suggestion: dedupe me", userId);

    const service = commentIntakeService(db);
    await service.runSource(await sourceRow(sourceId), BASE_NOW);
    // RunDue twice: the first should skip as not_due, then a later tick replays.
    const due1 = await service.runDue(BASE_NOW);
    expect(due1).toHaveLength(1);
    const due2 = await service.runDue(new Date(BASE_NOW.getTime() + SIX_MINUTES_MS));

    const intakes = await db.select().from(developmentCommentIntakes);
    expect(intakes).toHaveLength(1);
    const backlogs = await db.select().from(issues).where(and(
      eq(issues.companyId, companyId),
      eq(issues.originKind, "comment_intake"),
    ));
    expect(backlogs).toHaveLength(1);
    expect(due2.length).toBe(1);
  });

  it("leaves unrelated comments untouched and stores no secret-bearing rows", async () => {
    const companyId = await seedCompany("SEC2");
    const userId = await seedUser();
    const issueId = await seedIssue(companyId);
    const sourceId = await seedSource(companyId);
    await seedComment(companyId, issueId, "no tag here, just chatter", userId);
    // A comment that looks like a credential in its body.
    await seedComment(companyId, issueId, "@dev complaint: my token is sk-abcdef1234567890 and password=hunter2", userId);

    const service = commentIntakeService(db);
    const result = await service.runSource(await sourceRow(sourceId), BASE_NOW);

    // The secret-bearing comment is rejected/redacted; the untagged comment is ignored.
    expect(result).toMatchObject({ candidateCount: 1, createdCount: 0, rejectedCount: 1, status: "partial" });

    const intakes = await db.select().from(developmentCommentIntakes);
    expect(intakes).toHaveLength(1);
    const intake = intakes[0]!;
    expect(intake.intakeStatus).toBe("redacted");
    expect(intake.dismissedReasonCode).toBe("secret_detected");
    expect(intake.requestBody).toBeNull();
    expect(intake.backlogIssueId).toBeNull();

    // No backlog issue created for the redacted comment.
    const backlogs = await db.select().from(issues).where(and(
      eq(issues.companyId, companyId),
      eq(issues.originKind, "comment_intake"),
    ));
    expect(backlogs).toHaveLength(0);

    // The run row must never store the secret text.
    const runs = await db.select().from(commentIntakeRuns);
    for (const run of runs) {
      const detail = run.errorDetail ?? "";
      expect(detail).not.toContain("sk-abcdef");
      expect(detail).not.toContain("hunter2");
    }

    // The checkpoint must never store body text either.
    const checkpoints = await db.select().from(commentIntakeCheckpoints);
    for (const cp of checkpoints) {
      expect(JSON.stringify(cp)).not.toContain("sk-abcdef");
      expect(JSON.stringify(cp)).not.toContain("hunter2");
    }
  });
});
