import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  commentIntakeSources,
  companies,
  createDb,
  developmentCommentIntakes,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("independent QA: backlog issue deletion", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-qa-delete-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  beforeEach(async () => {
    await db.delete(developmentCommentIntakes);
    await db.delete(commentIntakeSources);
    await db.delete(issues);
    await db.delete(companies);
  });

  it("deleting a backlog-linked issue does not error and nulls the intake link", async () => {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "DEL Company",
      issuePrefix: "DEL",
      requireBoardApprovalForNewAgents: false,
    });
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Backlog issue",
      description: "Seed",
      status: "backlog",
      priority: "medium",
    });
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
    await db.insert(developmentCommentIntakes).values({
      companyId,
      sourceId,
      sourceCommentId: "c-1",
      sourceIssueId: issueId,
      sourceAuthorUserId: "u-1",
      sourceCreatedAt: new Date("2026-08-30T00:00:00.000Z"),
      sourceUpdatedAt: new Date("2026-08-30T00:00:00.000Z"),
      sourceUrl: null,
      tag: "@dev",
      tagPositions: [],
      kind: "complaint",
      subject: "subject",
      requestBody: "body",
      contentFingerprint: "fp",
      dedupeKey: "k-1",
      intakeStatus: "backlog_created",
      backlogIssueId: issueId,
    });

    let deletionError: unknown = null;
    try {
      await db.delete(issues).where(eq(issues.id, issueId));
    } catch (error) {
      deletionError = error;
    }

    expect(deletionError).toBeNull();

    const [intake] = await db.select().from(developmentCommentIntakes);
    expect(intake!.backlogIssueId).toBeNull();
  });
});
