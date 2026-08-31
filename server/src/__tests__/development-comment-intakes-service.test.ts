import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  commentIntakeCheckpoints,
  commentIntakeRuns,
  commentIntakeSources,
  companies,
  createDb,
  developmentCommentIntakes,
  issues,
} from "@paperclipai/db";
import type { DevelopmentCommentIntakeListQuery } from "@paperclipai/shared";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { HttpError } from "../errors.js";
import { developmentCommentIntakeService } from "../services/development-comment-intakes.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres development comment intake service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

type SeedIntakeOverrides = Partial<{
  id: string;
  companyId: string;
  sourceId: string;
  sourceCommentId: string;
  sourceIssueId: string | null;
  sourceCreatedAt: Date;
  sourceUpdatedAt: Date;
  sourceUrl: string | null;
  tag: string;
  kind: string;
  subject: string;
  requestBody: string | null;
  contentFingerprint: string;
  dedupeKey: string;
  intakeStatus: string;
  backlogIssueId: string | null;
  backlogStatusSnapshot: string | null;
}>;

/**
 * Build a full query object with every key present (the repo compiles with
 * `exactOptionalPropertyTypes`, so partial literals are not assignable to the
 * zod-inferred query type).
 */
function query(overrides: Partial<DevelopmentCommentIntakeListQuery> = {}): DevelopmentCommentIntakeListQuery {
  return {
    tag: overrides.tag,
    source: overrides.source,
    kind: overrides.kind,
    status: overrides.status ?? [],
    backlogStatus: overrides.backlogStatus ?? [],
    createdAfter: overrides.createdAfter,
    createdBefore: overrides.createdBefore,
    limit: overrides.limit ?? 50,
    cursor: overrides.cursor,
  };
}

describeEmbeddedPostgres("development comment intake service", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-comment-intake-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    await db.delete(developmentCommentIntakes);
    await db.delete(commentIntakeRuns);
    await db.delete(commentIntakeCheckpoints);
    await db.delete(commentIntakeSources);
    await db.delete(issues);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
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

  async function seedIssue(
    companyId: string,
    overrides: Partial<{ id: string; title: string; status: string; identifier: string }> = {},
  ) {
    const issueId = overrides.id ?? randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: overrides.title ?? "Backlog issue",
      description: "Seed issue",
      status: overrides.status ?? "backlog",
      priority: "medium",
      identifier: overrides.identifier,
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

  async function seedIntake(companyId: string, sourceId: string, overrides: SeedIntakeOverrides = {}) {
    const sourceIssueId = overrides.sourceIssueId ?? null;
    const backlogIssueId = overrides.backlogIssueId ?? null;
    const row = {
      companyId,
      sourceId,
      sourceCommentId: overrides.sourceCommentId ?? randomUUID(),
      sourceIssueId,
      sourceCreatedAt: overrides.sourceCreatedAt ?? new Date("2026-08-30T10:00:00.000Z"),
      sourceUpdatedAt: overrides.sourceUpdatedAt ?? new Date("2026-08-30T10:00:00.000Z"),
      sourceUrl: overrides.sourceUrl ?? `/ORG/issues/ORG-123`,
      tag: overrides.tag ?? "@dev",
      kind: overrides.kind ?? "complaint",
      subject: overrides.subject ?? "Seed subject",
      requestBody: overrides.requestBody ?? "@dev complaint: Seed subject",
      contentFingerprint: overrides.contentFingerprint ?? randomUUID(),
      dedupeKey: overrides.dedupeKey ?? randomUUID(),
      intakeStatus: overrides.intakeStatus ?? "new",
      backlogIssueId,
      backlogStatusSnapshot: overrides.backlogStatusSnapshot ?? null,
    };
    const inserted = await db.insert(developmentCommentIntakes).values(row).returning();
    return inserted[0]!;
  }

  it("returns items in fixed sourceCreatedAt DESC, id DESC order", async () => {
    const companyId = await seedCompany("ORD");
    const sourceId = await seedSource(companyId);

    const equalTime1 = randomUUID();
    const equalTime2 = randomUUID();
    await seedIntake(companyId, sourceId, {
      sourceCommentId: "c-oldest",
      sourceCreatedAt: new Date("2026-08-01T00:00:00.000Z"),
      dedupeKey: "k-oldest",
    });
    await seedIntake(companyId, sourceId, {
      sourceCommentId: "c-newest",
      sourceCreatedAt: new Date("2026-08-30T00:00:00.000Z"),
      dedupeKey: "k-newest",
    });
    await seedIntake(companyId, sourceId, {
      sourceCommentId: "c-mid",
      sourceCreatedAt: new Date("2026-08-15T00:00:00.000Z"),
      dedupeKey: "k-mid",
    });
    // Two rows share the same source time so the id tie-breaker is exercised.
    await seedIntake(companyId, sourceId, {
      sourceCommentId: "c-t1-a",
      sourceCreatedAt: new Date("2026-08-10T00:00:00.000Z"),
      id: equalTime1,
      dedupeKey: "k-t1-a",
    });
    await seedIntake(companyId, sourceId, {
      sourceCommentId: "c-t1-b",
      sourceCreatedAt: new Date("2026-08-10T00:00:00.000Z"),
      id: equalTime2,
      dedupeKey: "k-t1-b",
    });

    const service = developmentCommentIntakeService(db);
    const result = await service.list(companyId, query());

    expect(result.items.map((item) => item.source.commentId)).toEqual([
      "c-newest",
      "c-mid",
      equalTime2 > equalTime1 ? "c-t1-b" : "c-t1-a",
      "c-oldest",
    ]);
    expect(result.nextCursor).toBeNull();
  });

  it("filters by kind, status, tag, source, and time bounds", async () => {
    const companyId = await seedCompany("FTR");
    const sourceId = await seedSource(companyId);

    await seedIntake(companyId, sourceId, {
      sourceCommentId: "c-complaint-new",
      kind: "complaint",
      intakeStatus: "new",
      sourceCreatedAt: new Date("2026-08-10T00:00:00.000Z"),
      sourceUpdatedAt: new Date("2026-08-10T00:00:00.000Z"),
      dedupeKey: "k-1",
    });
    await seedIntake(companyId, sourceId, {
      sourceCommentId: "c-suggestion-triaged",
      kind: "suggestion",
      intakeStatus: "triaged",
      sourceCreatedAt: new Date("2026-08-20T00:00:00.000Z"),
      sourceUpdatedAt: new Date("2026-08-20T00:00:00.000Z"),
      dedupeKey: "k-2",
    });
    await seedIntake(companyId, sourceId, {
      sourceCommentId: "c-needed",
      kind: "needs_triage",
      intakeStatus: "dismissed",
      sourceCreatedAt: new Date("2026-08-25T00:00:00.000Z"),
      sourceUpdatedAt: new Date("2026-08-25T00:00:00.000Z"),
      dedupeKey: "k-3",
    });

    const service = developmentCommentIntakeService(db);

    const byKind = await service.list(companyId, query({ kind: "suggestion" }));
    expect(byKind.items.map((item) => item.source.commentId)).toEqual(["c-suggestion-triaged"]);

    const byStatus = await service.list(companyId, query({ status: ["dismissed", "new"] }));
    expect(byStatus.items.map((item) => item.source.commentId).sort()).toEqual([
      "c-complaint-new",
      "c-needed",
    ]);

    const byTag = await service.list(companyId, query({ tag: "@dev" }));
    expect(byTag.items).toHaveLength(3);

    const bySource = await service.list(companyId, query({ source: "paperclip" }));
    expect(bySource.items).toHaveLength(3);
    expect(bySource.items[0]!.source.provider).toBe("paperclip");

    const byTime = await service.list(companyId, query({ createdAfter: "2026-08-19T00:00:00.000Z", createdBefore: "2026-08-24T00:00:00.000Z" }));
    expect(byTime.items.map((item) => item.source.commentId)).toEqual(["c-suggestion-triaged"]);
  });

  it("filters backlogStatus none and canonical linked statuses", async () => {
    const companyId = await seedCompany("BST");
    const sourceId = await seedSource(companyId);
    const linkedIssueId = await seedIssue(companyId, { status: "todo", identifier: "BST-1" });

    await seedIntake(companyId, sourceId, {
      sourceCommentId: "c-linked",
      sourceIssueId: linkedIssueId,
      backlogIssueId: linkedIssueId,
      backlogStatusSnapshot: "backlog",
      dedupeKey: "k-link",
    });
    await seedIntake(companyId, sourceId, {
      sourceCommentId: "c-unlinked",
      dedupeKey: "k-unlink",
    });
    await seedIntake(companyId, sourceId, {
      sourceCommentId: "c-done-link",
      backlogIssueId: await seedIssue(companyId, { status: "done", identifier: "BST-2" }),
      backlogStatusSnapshot: "done",
      dedupeKey: "k-done",
    });

    const service = developmentCommentIntakeService(db);

    const none = await service.list(companyId, query({ backlogStatus: ["none"] }));
    expect(none.items.map((item) => item.source.commentId)).toEqual(["c-unlinked"]);
    expect(none.items[0]!.backlog).toBeNull();

    const todo = await service.list(companyId, query({ backlogStatus: ["todo"] }));
    expect(todo.items.map((item) => item.source.commentId)).toEqual(["c-linked"]);
    expect(todo.items[0]!.backlog).toMatchObject({ issueId: linkedIssueId, identifier: "BST-1", status: "todo" });

    const done = await service.list(companyId, query({ backlogStatus: ["done"] }));
    expect(done.items.map((item) => item.source.commentId)).toEqual(["c-done-link"]);

    const mixed = await service.list(companyId, query({ backlogStatus: ["none", "done"] }));
    expect(mixed.items.map((item) => item.source.commentId).sort()).toEqual(["c-done-link", "c-unlinked"]);
  });

  it("resolves backlog status from the canonical issue at read time, not the stored snapshot", async () => {
    const companyId = await seedCompany("CSN");
    const sourceId = await seedSource(companyId);
    const linkedIssueId = await seedIssue(companyId, { status: "todo", identifier: "CSN-1" });

    const intake = await seedIntake(companyId, sourceId, {
      sourceCommentId: "c-stale-snapshot",
      sourceIssueId: linkedIssueId,
      backlogIssueId: linkedIssueId,
      // Deliberately stale sidecar value — the API must never return it.
      backlogStatusSnapshot: "backlog",
      dedupeKey: "k-stale",
    });

    await db
      .update(issues)
      .set({ status: "in_progress" })
      .where(eq(issues.id, linkedIssueId));

    const service = developmentCommentIntakeService(db);
    const item = await service.getById(companyId, intake.id);

    expect(item?.backlog).toMatchObject({
      issueId: linkedIssueId,
      identifier: "CSN-1",
      status: "in_progress",
    });
  });

  it("paginates with a filter-bound opaque cursor without duplicates", async () => {
    const companyId = await seedCompany("PAG");
    const sourceId = await seedSource(companyId);
    const timestamps = [
      "2026-08-01T00:00:00.000Z",
      "2026-08-02T00:00:00.000Z",
      "2026-08-03T00:00:00.000Z",
      "2026-08-04T00:00:00.000Z",
      "2026-08-05T00:00:00.000Z",
    ];
    for (const [index, timestamp] of timestamps.entries()) {
      await seedIntake(companyId, sourceId, {
        sourceCommentId: `c-page-${index}`,
        sourceCreatedAt: new Date(timestamp),
        sourceUpdatedAt: new Date(timestamp),
        dedupeKey: `k-page-${index}`,
        kind: "suggestion",
      });
    }

    const service = developmentCommentIntakeService(db);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await service.list(companyId, query({ limit: 2, kind: "suggestion", cursor: cursor ?? undefined }));
      for (const item of page.items) seen.push(item.source.commentId);
      cursor = page.nextCursor;
      pages += 1;
      expect(page.items.length).toBeLessThanOrEqual(2);
    } while (cursor !== null && pages < 10);

    expect(pages).toBe(3);
    expect(seen).toEqual(["c-page-4", "c-page-3", "c-page-2", "c-page-1", "c-page-0"]);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("rejects a cursor minted under a different filter set with 400", async () => {
    const companyId = await seedCompany("CUR");
    const sourceId = await seedSource(companyId);
    await seedIntake(companyId, sourceId, {
      sourceCommentId: "c-a",
      kind: "suggestion",
      sourceCreatedAt: new Date("2026-08-05T00:00:00.000Z"),
      sourceUpdatedAt: new Date("2026-08-05T00:00:00.000Z"),
      dedupeKey: "k-cur-1",
    });
    await seedIntake(companyId, sourceId, {
      sourceCommentId: "c-b",
      kind: "complaint",
      sourceCreatedAt: new Date("2026-08-04T00:00:00.000Z"),
      sourceUpdatedAt: new Date("2026-08-04T00:00:00.000Z"),
      dedupeKey: "k-cur-2",
    });

    const service = developmentCommentIntakeService(db);
    const firstPage = await service.list(companyId, query({ limit: 1, kind: "suggestion" }));
    const cursor = firstPage.nextCursor;
    expect(cursor).not.toBeNull();

    try {
      await service.list(companyId, query({ limit: 1, kind: "complaint", cursor: cursor ?? undefined }));
      expect.unreachable("expected a 400 HttpError");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(400);
    }
  });

  it("scopes all reads to the company", async () => {
    const companyA = await seedCompany("SCA");
    const companyB = await seedCompany("SCB");
    const sourceA = await seedSource(companyA);
    const sourceB = await seedSource(companyB);

    await seedIntake(companyA, sourceA, { sourceCommentId: "c-a", dedupeKey: "k-a" });
    const intakeB = await seedIntake(companyB, sourceB, { sourceCommentId: "c-b", dedupeKey: "k-b" });

    const service = developmentCommentIntakeService(db);

    const listA = await service.list(companyA, query());
    expect(listA.items.map((item) => item.source.commentId)).toEqual(["c-a"]);

    const missingCrossCompany = await service.getById(companyA, intakeB.id);
    expect(missingCrossCompany).toBeNull();
  });

  it("never returns redacted or archived request bodies", async () => {
    const companyId = await seedCompany("RED");
    const sourceId = await seedSource(companyId);

    const redacted = await seedIntake(companyId, sourceId, {
      sourceCommentId: "c-redacted",
      requestBody: "secret from a comment",
      intakeStatus: "redacted",
      dedupeKey: "k-red",
    });
    const archived = await seedIntake(companyId, sourceId, {
      sourceCommentId: "c-archived",
      requestBody: "expired body",
      intakeStatus: "archived",
      dedupeKey: "k-arch",
    });
    const live = await seedIntake(companyId, sourceId, {
      sourceCommentId: "c-live",
      requestBody: "visible body",
      dedupeKey: "k-live",
    });

    const service = developmentCommentIntakeService(db);

    const redactedItem = await service.getById(companyId, redacted.id);
    expect(redactedItem?.requestBody).toBeNull();

    const archivedItem = await service.getById(companyId, archived.id);
    expect(archivedItem?.requestBody).toBeNull();
    expect(archivedItem?.archivedAt).not.toBeNull();

    const liveItem = await service.getById(companyId, live.id);
    expect(liveItem?.requestBody).toBe("visible body");
  });

  it("returns a stable full item shape for the detail endpoint", async () => {
    const companyId = await seedCompany("SHP");
    const sourceId = await seedSource(companyId);
    const linkedIssueId = await seedIssue(companyId, { status: "backlog", identifier: "SHP-9" });

    const intake = await seedIntake(companyId, sourceId, {
      sourceCommentId: "c-shape",
      sourceIssueId: linkedIssueId,
      sourceUrl: "/ORG/issues/SHP-9",
      kind: "complaint",
      subject: "Export fails for CSV files",
      requestBody: "@dev complaint: Export fails for CSV files.",
      intakeStatus: "backlog_created",
      backlogIssueId: linkedIssueId,
      dedupeKey: "k-shape",
    });

    const service = developmentCommentIntakeService(db);
    const item = await service.getById(companyId, intake.id);

    expect(item).toMatchObject({
      id: intake.id,
      source: {
        provider: "paperclip",
        commentId: "c-shape",
        issueId: linkedIssueId,
        url: "/ORG/issues/SHP-9",
        createdAt: "2026-08-30T10:00:00.000Z",
      },
      tag: "@dev",
      kind: "complaint",
      subject: "Export fails for CSV files",
      requestBody: "@dev complaint: Export fails for CSV files.",
      intakeStatus: "backlog_created",
      backlog: {
        issueId: linkedIssueId,
        identifier: "SHP-9",
        status: "backlog",
      },
      redactedAt: null,
      archivedAt: null,
    });
    expect(Object.keys(item!)).toEqual([
      "id",
      "source",
      "tag",
      "kind",
      "subject",
      "requestBody",
      "intakeStatus",
      "backlog",
      "redactedAt",
      "archivedAt",
    ]);
  });
});