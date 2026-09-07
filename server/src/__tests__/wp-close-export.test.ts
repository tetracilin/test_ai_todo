import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agents,
  assets,
  companies,
  createDb,
  documentRevisions,
  documents,
  externalObjects,
  issueAttachments,
  issueDocuments,
  issueEvidenceLinks,
  issueLabels,
  issues,
  labels,
} from "@paperclipai/db";
import { WORK_PACKAGE_LABEL_NAME } from "@paperclipai/shared";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { issueDossierService } from "../services/issue-dossier.js";
import { issueEvidenceLinkService } from "../services/issue-evidence-links.js";
import { issueService } from "../services/issues.js";
import {
  WP_CLOSE_EXPORT_DOCUMENT_KEY,
  wpCloseExportService,
} from "../services/wp-close-export.js";
import { documentService } from "../services/documents.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;
if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres WP-close export tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

// PC-006 AC1: closing a parent issue labelled "WP" (K6 domain map -- a WP is a
// parent issue via `issues.parent_id`, no `work_packages` table) generates the
// close-export bundle and refuses while any direct child is neither done nor
// cancelled. Exercises the real gate inside issueService(db).update()'s
// row-locked transaction (F-402-1's precedent: same commit-point choke as the
// PC-001 evidence gate), and the real generator, not mocks.
describeEmbeddedPostgres("WP-close export (PC-006 F-006-1)", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db: ReturnType<typeof createDb>;
  let svc: ReturnType<typeof issueService>;
  let dossierSvc: ReturnType<typeof issueDossierService>;
  let evidenceLinkSvc: ReturnType<typeof issueEvidenceLinkService>;
  let exportSvc: ReturnType<typeof wpCloseExportService>;
  let documentsSvc: ReturnType<typeof documentService>;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-wp-close-export-");
    db = createDb(tempDb.connectionString);
    svc = issueService(db);
    dossierSvc = issueDossierService(db);
    evidenceLinkSvc = issueEvidenceLinkService(db);
    exportSvc = wpCloseExportService(db);
    documentsSvc = documentService(db);
  }, 30_000);

  afterEach(async () => {
    await db.delete(issueEvidenceLinks);
    await db.delete(issueAttachments);
    await db.delete(documentRevisions);
    await db.delete(issueDocuments);
    await db.delete(documents);
    await db.delete(issueLabels);
    await db.delete(labels);
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(externalObjects);
    await db.delete(assets);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  let issueCounter = 0;

  async function seedCompany(overrides: Partial<typeof companies.$inferInsert> = {}) {
    const companyId = randomUUID();
    const prefix = `WP${companyId.replaceAll("-", "").slice(0, 6).toUpperCase()}`;
    await db.insert(companies).values({
      id: companyId,
      name: "WP Co",
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
      title: `WP-close issue ${issueCounter}`,
      status: "todo",
      priority: "medium",
      issueNumber: issueCounter,
      identifier: `${prefix}-${issueCounter}`,
      ...overrides,
    });
    return issueId;
  }

  async function seedWpLabel(companyId: string) {
    const id = randomUUID();
    await db.insert(labels).values({ id, companyId, name: WORK_PACKAGE_LABEL_NAME, color: "#00ff00" });
    return id;
  }

  async function attachLabel(issueId: string, companyId: string, labelId: string) {
    await db.insert(issueLabels).values({ issueId, labelId, companyId });
  }

  async function seedExternalObject(companyId: string, providerKey = "git") {
    const id = randomUUID();
    await db.insert(externalObjects).values({
      id,
      companyId,
      providerKey,
      objectType: "commit",
      externalId: randomUUID(),
    });
    return id;
  }

  async function seedEvidenceLink(
    companyId: string,
    issueId: string,
    source: "bot" | "manual" | "system" = "manual",
  ) {
    const externalObjectId = await seedExternalObject(companyId);
    const id = randomUUID();
    await db.insert(issueEvidenceLinks).values({ id, companyId, issueId, externalObjectId, source });
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
      sha256: "b".repeat(64),
      originalFilename: "test-report.pdf",
    });
    return id;
  }

  async function seedAttachment(companyId: string, issueId: string, source: "bot" | "manual" | "system" = "bot") {
    const assetId = await seedAsset(companyId);
    const id = randomUUID();
    await db.insert(issueAttachments).values({ id, companyId, issueId, assetId, source });
    return id;
  }

  async function seedWorkPackage(
    companyId: string,
    prefix: string,
    childStatuses: string[],
  ): Promise<{ wpId: string; childIds: string[] }> {
    const wpId = await seedIssue(companyId, prefix);
    const labelId = await seedWpLabel(companyId);
    await attachLabel(wpId, companyId, labelId);
    const childIds: string[] = [];
    for (const status of childStatuses) {
      const childId = await seedIssue(companyId, prefix, { parentId: wpId, status });
      childIds.push(childId);
    }
    return { wpId, childIds };
  }

  // -- Gate

  it("refuses to close a WP while a child is still open", async () => {
    const { companyId, prefix } = await seedCompany();
    const { wpId } = await seedWorkPackage(companyId, prefix, ["todo"]);

    await expect(svc.update(wpId, { status: "done" })).rejects.toMatchObject({
      status: 422,
      details: { code: "wp_close_incomplete_children" },
    });

    const [row] = await db.select().from(issues).where(eq(issues.id, wpId));
    expect(row?.status).toBe("todo");
  });

  it("allows closing a WP once every child is done or cancelled", async () => {
    const { companyId, prefix } = await seedCompany();
    const { wpId } = await seedWorkPackage(companyId, prefix, ["done", "cancelled"]);

    const updated = await svc.update(wpId, { status: "done" });

    expect(updated).toMatchObject({ id: wpId, status: "done" });
  });

  it("does not gate a plain parent issue with no WP label, regardless of its children", async () => {
    const { companyId, prefix } = await seedCompany();
    const wpId = await seedIssue(companyId, prefix);
    await seedIssue(companyId, prefix, { parentId: wpId, status: "todo" });

    const updated = await svc.update(wpId, { status: "done" });

    expect(updated).toMatchObject({ id: wpId, status: "done" });
  });

  it("gates a request that attaches the WP label in the same PATCH that closes it", async () => {
    const { companyId, prefix } = await seedCompany();
    const wpId = await seedIssue(companyId, prefix);
    await seedIssue(companyId, prefix, { parentId: wpId, status: "todo" });
    const labelId = await seedWpLabel(companyId);

    await expect(svc.update(wpId, { status: "done", labelIds: [labelId] })).rejects.toMatchObject({
      status: 422,
      details: { code: "wp_close_incomplete_children" },
    });
  });

  it("re-closing an already-done WP does not re-trigger the gate", async () => {
    const { companyId, prefix } = await seedCompany();
    const { wpId } = await seedWorkPackage(companyId, prefix, ["done"]);
    await svc.update(wpId, { status: "done" });

    // A later child regresses to todo, then an unrelated PATCH on the (already
    // done) WP must not re-trigger the gate -- mirrors PC-001's own
    // "already-done issue, unrelated field" test.
    const [childId] = (await db.select({ id: issues.id }).from(issues).where(eq(issues.parentId, wpId))).map(
      (row) => row.id,
    );
    await db.update(issues).set({ status: "todo" }).where(eq(issues.id, childId));

    const updated = await svc.update(wpId, { title: "Renamed WP" });
    expect(updated).toMatchObject({ id: wpId, status: "done", title: "Renamed WP" });
  });

  // -- Bundle generation on close

  it("persists a wp-close-export document on the WP issue once it closes", async () => {
    const { companyId, prefix } = await seedCompany();
    const { wpId, childIds } = await seedWorkPackage(companyId, prefix, ["done"]);
    const [childId] = childIds;
    await evidenceLinkSvc.link(childId, { providerKey: "git", objectType: "commit", externalId: "abc123" }, "bot", async () => {});
    await dossierSvc.appendScopeChange(childId, { at: "2026-09-01T00:00:00Z", note: "Scope widened" }, {});

    await svc.update(wpId, { status: "done" });

    // Best-effort and post-commit -- give the generator's own queries a turn.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const doc = await documentsSvc.getIssueDocumentByKey(wpId, WP_CLOSE_EXPORT_DOCUMENT_KEY);
    expect(doc).not.toBeNull();
    expect(doc!.body).toContain(`${prefix}-`);
    expect(doc!.body).toContain("Scope widened");
    expect(doc!.body).toContain("git");
  });

  // -- Generator (direct, so bundle content can be asserted without racing the
  // best-effort post-commit hook above)

  it("generate() assembles evidence, scope changes and the wedge ratio per child", async () => {
    const { companyId, prefix } = await seedCompany();
    const { wpId, childIds } = await seedWorkPackage(companyId, prefix, ["done", "cancelled"]);
    const [botChildId, manualChildId] = childIds;

    await evidenceLinkSvc.link(
      botChildId,
      { providerKey: "git", objectType: "commit", externalId: "deadbeef" },
      "bot",
      async () => {},
    );
    await seedAttachment(companyId, manualChildId, "manual");
    await dossierSvc.appendScopeChange(botChildId, { at: "2026-09-01T01:00:00Z", note: "Added a sensor" }, {});
    await dossierSvc.appendScopeChange(manualChildId, { at: "2026-09-02T02:00:00Z", note: "Dropped a sensor" }, {});

    const bundle = await exportSvc.generate(companyId, wpId);

    expect(bundle.children).toHaveLength(2);
    const botChild = bundle.children.find((child) => child.issueId === botChildId)!;
    expect(botChild.evidenceCounts).toEqual({ attachmentCount: 0, evidenceLinkCount: 1, total: 1 });
    expect(botChild.evidence[0]).toMatchObject({ kind: "link", source: "bot", providerKey: "git" });
    expect(botChild.scopeChanges).toEqual([{ at: "2026-09-01T01:00:00Z", note: "Added a sensor" }]);

    const manualChild = bundle.children.find((child) => child.issueId === manualChildId)!;
    expect(manualChild.evidenceCounts).toEqual({ attachmentCount: 1, evidenceLinkCount: 0, total: 1 });
    expect(manualChild.evidence[0]).toMatchObject({ kind: "attachment", source: "manual" });

    // bot=1, manual=1 -> below the n=15 minimum sample, so the band call is
    // "extend_window" rather than a pass/iterate/abort verdict (PC-011 AC3).
    expect(bundle.wedge.groupBy).toBe("work_package");
    expect(bundle.wedge.botCount).toBe(1);
    expect(bundle.wedge.manualCount).toBe(1);
    expect(bundle.wedge.band).toBe("extend_window");

    // The scope-change timeline is aggregated across children, sorted by time.
    const timelineOrder = bundle.markdown
      .split("## Scope-change timeline")[1]!
      .split("## Cards")[0]!;
    expect(timelineOrder.indexOf("Added a sensor")).toBeLessThan(timelineOrder.indexOf("Dropped a sensor"));
  });

  it("scopes children and evidence to the WP's own company", async () => {
    const { companyId: companyA, prefix: prefixA } = await seedCompany();
    const { companyId: companyB, prefix: prefixB } = await seedCompany();
    const { wpId } = await seedWorkPackage(companyA, prefixA, ["done"]);
    // A same-shaped WP in another company must never leak into company A's bundle.
    await seedWorkPackage(companyB, prefixB, ["done"]);

    const bundle = await exportSvc.generate(companyA, wpId);

    expect(bundle.children).toHaveLength(1);
  });

  it("throws not-found for an issue outside the given company", async () => {
    const { companyId: companyA } = await seedCompany();
    const { companyId: companyB, prefix: prefixB } = await seedCompany();
    const { wpId } = await seedWorkPackage(companyB, prefixB, ["done"]);

    await expect(exportSvc.generate(companyA, wpId)).rejects.toMatchObject({ status: 404 });
  });

  it("generateAndPersist regenerates without a baseRevisionId conflict", async () => {
    const { companyId, prefix } = await seedCompany();
    const { wpId } = await seedWorkPackage(companyId, prefix, ["done"]);

    const first = await exportSvc.generateAndPersist(companyId, wpId, {});
    const second = await exportSvc.generateAndPersist(companyId, wpId, {});

    expect(first.markdown).toBe(second.markdown);
    const revisions = await documentsSvc.listIssueDocumentRevisions(wpId, WP_CLOSE_EXPORT_DOCUMENT_KEY);
    expect(revisions).toHaveLength(2);
  });

});

// PC-006 AC3 (F-006-3): one checked-in example bundle, generated from the same
// pump card as `dossier-example.md` (PC-002 AC5) plus a second, cancelled
// card -- the shape PC-502's CTO retrieval test runs against. `.gitattributes`
// already pins `server/src/__tests__/fixtures/** text eol=lf`.
describe("WP-close export example fixture", () => {
  const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
  const fixturePath = path.join(fixturesDir, "wp-close-export-example.md");
  const fixture = readFileSync(fixturePath, "utf8");

  it("is stored on disk with LF line endings", () => {
    const raw = readFileSync(fixturePath);
    expect(raw.includes(0x0d)).toBe(false);
    expect(raw.includes(0x0a)).toBe(true);
  });

  it("carries the sections a CTO reads a WP-close export for, in order", () => {
    // Nested dossiers (rendered inside each card's own <details> block) carry
    // "## " headings of their own -- stop at "## Cards", the point past which
    // every "## " belongs to a child's embedded dossier, not the bundle itself.
    const bundleLevelBody = fixture.split("\n## Cards")[0]!;
    const headings = bundleLevelBody
      .split("\n")
      .filter((line) => line.startsWith("## "))
      .map((line) => line.slice(3));
    expect(headings).toEqual(["WWTP Bình Dương — pump replacement work package", "Bot/manual evidence ratio", "Scope-change timeline"]);
    expect(fixture).toContain("\n## Cards\n");
  });

  it("embeds each closed/cancelled card's own dossier verbatim", () => {
    expect(fixture).toContain("### T3-142 — Replace NaOH dosing pump #2, Bình Dương wastewater plant");
    expect(fixture).toContain("### T3-143 — Calibrate pH sensor, Bình Dương wastewater plant");
    // The nested dossier is the real PC-002 fixture, byte-identical -- these two
    // examples are not allowed to drift into two different pump-card stories.
    const dossierFixture = readFileSync(path.join(fixturesDir, "dossier-example.md"), "utf8");
    expect(fixture).toContain(dossierFixture.trimEnd());
  });

  it("aggregates the scope-change timeline across cards in timestamp order", () => {
    const timelineBlock = fixture.split("## Scope-change timeline")[1]!.split("## Cards")[0]!;
    const entries = timelineBlock.split("\n").filter((line) => line.startsWith("- "));
    expect(entries).toHaveLength(3);
    expect(entries[0]).toContain("T3-142");
    expect(entries[2]).toContain("T3-143");
    const timestamps = entries.map((line) => Date.parse(line.slice(2, line.indexOf(" — "))));
    expect(timestamps.every((value) => Number.isFinite(value))).toBe(true);
    expect([...timestamps].sort((a, b) => a - b)).toEqual(timestamps);
  });

  it("carries a machine-readable evidence index per card, one row per filing act", () => {
    expect(fixture).toContain("[bot] git:");
    expect(fixture).toContain("[manual] minio:");
    expect(fixture).toContain("[manual] attachment: test-report.pdf");
  });
});
