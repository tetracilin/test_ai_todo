import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  assets,
  companies,
  createDb,
  externalObjects,
  issueAttachments,
  issueEvidenceLinks,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import {
  EVIDENCE_WEDGE_MINIMUM_SAMPLE,
  callEvidenceWedgeBand,
  evidenceProvenanceService,
} from "../services/evidence-provenance.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

// PC-011 (design-record OV-5): evidence provenance is stored per filing act on
// both `issue_evidence_links` and `issue_attachments`, and the wedge metric
// `wp0_evidence_via_bot` is read from those real columns. These tests run the
// real service against real Postgres -- the point of the story is that the
// number is queried from the system, so a mocked query would prove nothing.

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres evidence provenance tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

// The band call is a pure function so the mechanical thresholds can be pinned
// exactly at their boundaries without seeding a database per boundary.
describe("evidence wedge band call (PC-011 AC3)", () => {
  it("calls each band at its boundary with a sufficient sample", () => {
    // n = 100 so every listed percentage is exactly representable.
    expect(callEvidenceWedgeBand(0, 100)).toEqual({ sampleSize: 100, ratio: 0, band: "abort" });
    expect(callEvidenceWedgeBand(49, 51)).toEqual({ sampleSize: 100, ratio: 0.49, band: "abort" });
    expect(callEvidenceWedgeBand(50, 50)).toEqual({ sampleSize: 100, ratio: 0.5, band: "iterate" });
    expect(callEvidenceWedgeBand(79, 21)).toEqual({ sampleSize: 100, ratio: 0.79, band: "iterate" });
    expect(callEvidenceWedgeBand(80, 20)).toEqual({ sampleSize: 100, ratio: 0.8, band: "pass" });
    expect(callEvidenceWedgeBand(100, 0)).toEqual({ sampleSize: 100, ratio: 1, band: "pass" });
  });

  it("does not call the band below the minimum sample", () => {
    expect(EVIDENCE_WEDGE_MINIMUM_SAMPLE).toBe(15);
    // 14 filings at a perfect 100% is still "extend the window", not "pass".
    expect(callEvidenceWedgeBand(14, 0)).toEqual({ sampleSize: 14, ratio: 1, band: "extend_window" });
    expect(callEvidenceWedgeBand(0, 14)).toEqual({ sampleSize: 14, ratio: 0, band: "extend_window" });
    // The 15th filing is the first that gets a band.
    expect(callEvidenceWedgeBand(15, 0).band).toBe("pass");
    expect(callEvidenceWedgeBand(12, 3).band).toBe("pass");
    expect(callEvidenceWedgeBand(0, 15).band).toBe("abort");
  });

  it("reports a null ratio when nothing was filed", () => {
    expect(callEvidenceWedgeBand(0, 0)).toEqual({ sampleSize: 0, ratio: null, band: "extend_window" });
  });

  it("keeps out-of-union filings in the denominator", () => {
    // 12 bot + 3 rows with a third `source` value. Dropping those three would
    // report n=12 (< the minimum sample) at a perfect ratio, withholding a band
    // that should have been called. Counted honestly it is 15 filings at 80%.
    expect(callEvidenceWedgeBand(12, 0, 3)).toEqual({ sampleSize: 15, ratio: 0.8, band: "pass" });
    // And an unknown source can only drag the ratio down, never inflate it.
    expect(callEvidenceWedgeBand(12, 0, 12).band).toBe("iterate");
    expect(callEvidenceWedgeBand(12, 3, 0).band).toBe("pass");
  });

  it("has no parameter a `system` tally could be passed through (gate UC-1)", () => {
    // The exclusion is structural rather than a filter a caller can forget:
    // the arithmetic accepts bot, manual and out-of-union counts and nothing
    // else, so the only way a system filing could reach the ratio is by being
    // mis-counted as one of those three at the reader.
    expect(callEvidenceWedgeBand.length).toBe(2); // (botCount, manualCount) + defaulted otherCount
  });
});

describeEmbeddedPostgres("evidence provenance & wedge metric (PC-011)", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db: ReturnType<typeof createDb>;
  let svc: ReturnType<typeof evidenceProvenanceService>;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-evidence-provenance-");
    db = createDb(tempDb.connectionString);
    svc = evidenceProvenanceService(db);
  }, 30_000);

  afterEach(async () => {
    await db.delete(issueEvidenceLinks);
    await db.delete(issueAttachments);
    await db.delete(issues);
    await db.delete(assets);
    await db.delete(externalObjects);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  let issueCounter = 0;

  async function seedCompany() {
    const companyId = randomUUID();
    const prefix = `PV${companyId.replaceAll("-", "").slice(0, 6).toUpperCase()}`;
    await db.insert(companies).values({
      id: companyId,
      name: "Provenance Co",
      issuePrefix: prefix,
      requireBoardApprovalForNewAgents: false,
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
      title: `Provenance issue ${issueCounter}`,
      status: "todo",
      priority: "medium",
      issueNumber: issueCounter,
      identifier: `${prefix}-${issueCounter}`,
      ...overrides,
    });
    return issueId;
  }

  /** Batch-file `count` evidence links, each with its own external object. */
  async function seedEvidenceLinks(
    companyId: string,
    issueId: string,
    count: number,
    overrides: Partial<typeof issueEvidenceLinks.$inferInsert> = {},
  ) {
    if (count <= 0) return;
    const objectRows = Array.from({ length: count }, () => ({
      id: randomUUID(),
      companyId,
      providerKey: "test-provider",
      objectType: "test-object",
      externalId: randomUUID(),
    }));
    await db.insert(externalObjects).values(objectRows);
    await db.insert(issueEvidenceLinks).values(
      objectRows.map((object) => ({
        id: randomUUID(),
        companyId,
        issueId,
        externalObjectId: object.id,
        ...overrides,
      })),
    );
  }

  /** Batch-file `count` attachments, each with its own asset. */
  async function seedAttachments(
    companyId: string,
    issueId: string,
    count: number,
    overrides: Partial<typeof issueAttachments.$inferInsert> = {},
  ) {
    if (count <= 0) return;
    const assetRows = Array.from({ length: count }, () => {
      const id = randomUUID();
      return {
        id,
        companyId,
        provider: "test",
        objectKey: `key-${id}`,
        contentType: "text/plain",
        byteSize: 10,
        sha256: "a".repeat(64),
      };
    });
    await db.insert(assets).values(assetRows);
    await db.insert(issueAttachments).values(
      assetRows.map((asset) => ({
        id: randomUUID(),
        companyId,
        issueId,
        assetId: asset.id,
        ...overrides,
      })),
    );
  }

  it("defaults source to manual on both evidence tables (AC1, backward compatible)", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    await seedEvidenceLinks(companyId, issueId, 1);
    await seedAttachments(companyId, issueId, 1);

    const [link] = await db.select().from(issueEvidenceLinks).where(eq(issueEvidenceLinks.issueId, issueId));
    const [attachment] = await db.select().from(issueAttachments).where(eq(issueAttachments.issueId, issueId));
    expect(link?.source).toBe("manual");
    expect(attachment?.source).toBe("manual");
  });

  it("round-trips source=bot on both evidence tables (AC2)", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    await seedEvidenceLinks(companyId, issueId, 1, { source: "bot" });
    await seedAttachments(companyId, issueId, 1, { source: "bot" });

    const [link] = await db.select().from(issueEvidenceLinks).where(eq(issueEvidenceLinks.issueId, issueId));
    const [attachment] = await db.select().from(issueAttachments).where(eq(issueAttachments.issueId, issueId));
    expect(link?.source).toBe("bot");
    expect(attachment?.source).toBe("bot");
  });

  it("counts the ratio across both evidence tables (AC3)", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    // 9 bot + 3 manual as links, 3 bot + 5 manual as attachments -> 12/20.
    await seedEvidenceLinks(companyId, issueId, 9, { source: "bot" });
    await seedEvidenceLinks(companyId, issueId, 3, { source: "manual" });
    await seedAttachments(companyId, issueId, 3, { source: "bot" });
    await seedAttachments(companyId, issueId, 5, { source: "manual" });

    const rows = await svc.getWedgeMetric({ companyId });
    expect(rows).toEqual([
      {
        groupBy: "company",
        groupKey: companyId,
        botCount: 12,
        manualCount: 8,
        systemCount: 0,
        otherCount: 0,
        sampleSize: 20,
        ratio: 0.6,
        band: "iterate",
      },
    ]);
  });

  it("reads the band from real rows at the pass boundary and below it", async () => {
    const { companyId, prefix } = await seedCompany();
    const passIssue = await seedIssue(companyId, prefix);
    // Exactly 80% bot: 12 bot links + 4 bot attachments over 20 filings.
    await seedEvidenceLinks(companyId, passIssue, 12, { source: "bot" });
    await seedAttachments(companyId, passIssue, 4, { source: "bot" });
    await seedEvidenceLinks(companyId, passIssue, 4, { source: "manual" });

    const passRows = await svc.getWedgeMetric({ companyId });
    expect(passRows[0]).toMatchObject({ botCount: 16, manualCount: 4, sampleSize: 20, ratio: 0.8, band: "pass" });

    // File one more manual link -> 16/21 = 76% -> iterate.
    await seedEvidenceLinks(companyId, passIssue, 1, { source: "manual" });
    const iterateRows = await svc.getWedgeMetric({ companyId });
    expect(iterateRows[0]).toMatchObject({ botCount: 16, manualCount: 5, sampleSize: 21, band: "iterate" });

    // And enough manual filings to cross under 50% -> abort.
    await seedEvidenceLinks(companyId, passIssue, 12, { source: "manual" });
    const abortRows = await svc.getWedgeMetric({ companyId });
    expect(abortRows[0]).toMatchObject({ botCount: 16, manualCount: 17, sampleSize: 33, band: "abort" });
  });

  it("returns extend_window below the minimum sample rather than a band (AC3)", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    await seedEvidenceLinks(companyId, issueId, 14, { source: "bot" });

    const rows = await svc.getWedgeMetric({ companyId });
    // The n comes back with the answer: the query does not hide a short sample
    // behind an empty result, so the caller can act on the minimum-n rule (file
    // 15 - n more, or widen the window) instead of guessing at it.
    expect(rows[0]).toMatchObject({ botCount: 14, manualCount: 0, sampleSize: 14, ratio: 1, band: "extend_window" });
  });

  it("counts `system` filings but keeps them out of both sides of the ratio (gate UC-1)", async () => {
    // Auto-linked commits and other system-generated filings are neither a bot
    // capture nor a human re-entry. 13 bot + 3 manual is the real sample; the 10
    // system rows are reported and excluded, so the ratio is 13/16, not 13/26.
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    await seedEvidenceLinks(companyId, issueId, 13, { source: "bot" });
    await seedEvidenceLinks(companyId, issueId, 3, { source: "manual" });
    await seedEvidenceLinks(companyId, issueId, 6, { source: "system" });
    await seedAttachments(companyId, issueId, 4, { source: "system" });

    const [row] = await svc.getWedgeMetric({ companyId });
    expect(row).toEqual({
      groupBy: "company",
      groupKey: companyId,
      botCount: 13,
      manualCount: 3,
      systemCount: 10,
      otherCount: 0,
      sampleSize: 16,
      ratio: 13 / 16,
      band: "pass",
    });
    // Nothing vanished: every seeded filing is accounted for in the row.
    expect(row.botCount + row.manualCount + row.systemCount + row.otherCount).toBe(26);
  });

  it("does not let system filings flip the band (gate UC-1)", async () => {
    // The same 13 bot + 3 manual sample: `pass` at 81.25%. The pilot's own card
    // type files most of its evidence as auto-linked commits, so if those 10
    // system rows landed in the denominator the ratio would read 13/26 = 50%
    // and the band would drop to `iterate` -- suppressing the metric however
    // well the bot performed. That is the exact flip this asserts cannot happen.
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    await seedEvidenceLinks(companyId, issueId, 13, { source: "bot" });
    await seedEvidenceLinks(companyId, issueId, 3, { source: "manual" });

    const withoutSystem = await svc.getWedgeMetric({ companyId });
    expect(withoutSystem[0]).toMatchObject({ sampleSize: 16, band: "pass" });

    await seedAttachments(companyId, issueId, 10, { source: "system" });
    const withSystem = await svc.getWedgeMetric({ companyId });
    // Band, ratio and n are all untouched; only systemCount moved.
    expect(withSystem[0]).toMatchObject({ sampleSize: 16, ratio: 13 / 16, band: "pass", systemCount: 10 });
    expect(callEvidenceWedgeBand(13, 3 + 10).band).toBe("iterate"); // what counting them would have said
  });

  it("keeps system filings out of the minimum-sample n as well (gate UC-1)", async () => {
    // The minimum-n rule asks whether enough bot-vs-manual filings have
    // happened to judge the bot yet, so it is applied to the ratio sample, not
    // to the row count: 12 real filings plus 20 system ones is still a sample of
    // 12, and the honest answer is still "extend the window" -- calling a band
    // off n=32 would be calling it on 12 filings while claiming 32.
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    await seedEvidenceLinks(companyId, issueId, 9, { source: "bot" });
    await seedEvidenceLinks(companyId, issueId, 3, { source: "manual" });
    await seedEvidenceLinks(companyId, issueId, 20, { source: "system" });

    const [row] = await svc.getWedgeMetric({ companyId });
    expect(row).toMatchObject({
      botCount: 9,
      manualCount: 3,
      systemCount: 20,
      sampleSize: 12,
      ratio: 0.75,
      band: "extend_window",
    });
    expect(row.sampleSize).toBeLessThan(EVIDENCE_WEDGE_MINIMUM_SAMPLE);
  });

  it("answers an empty window with n=0 rather than no row at all", async () => {
    const { companyId } = await seedCompany();
    const rows = await svc.getWedgeMetric({ companyId });
    expect(rows).toEqual([
      {
        groupBy: "company",
        groupKey: companyId,
        botCount: 0,
        manualCount: 0,
        systemCount: 0,
        otherCount: 0,
        sampleSize: 0,
        ratio: null,
        band: "extend_window",
      },
    ]);
  });

  it("groups per engineer (AC3)", async () => {
    const { companyId, prefix } = await seedCompany();
    const anIssue = await seedIssue(companyId, prefix, { assigneeUserId: "engineer-an" });
    const binhIssue = await seedIssue(companyId, prefix, { assigneeUserId: "engineer-binh" });
    await seedEvidenceLinks(companyId, anIssue, 8, { source: "bot" });
    await seedAttachments(companyId, anIssue, 2, { source: "manual" });
    await seedEvidenceLinks(companyId, binhIssue, 1, { source: "bot" });
    await seedAttachments(companyId, binhIssue, 3, { source: "manual" });

    const rows = await svc.getWedgeMetric({ companyId, groupBy: "engineer" });
    expect(rows.map((row) => [row.groupKey, row.botCount, row.manualCount])).toEqual([
      ["engineer-an", 8, 2],
      ["engineer-binh", 1, 3],
    ]);

    const scoped = await svc.getWedgeMetric({ companyId, groupBy: "engineer", engineerUserId: "engineer-an" });
    expect(scoped).toHaveLength(1);
    expect(scoped[0]).toMatchObject({ groupKey: "engineer-an", sampleSize: 10, ratio: 0.8 });
  });

  it("groups per work package (AC3)", async () => {
    const { companyId, prefix } = await seedCompany();
    const wpOne = await seedIssue(companyId, prefix);
    const wpTwo = await seedIssue(companyId, prefix);
    const cardOne = await seedIssue(companyId, prefix, { parentId: wpOne });
    const cardTwo = await seedIssue(companyId, prefix, { parentId: wpOne });
    const cardThree = await seedIssue(companyId, prefix, { parentId: wpTwo });
    await seedEvidenceLinks(companyId, cardOne, 5, { source: "bot" });
    await seedAttachments(companyId, cardTwo, 5, { source: "manual" });
    await seedEvidenceLinks(companyId, cardThree, 2, { source: "bot" });

    const rows = await svc.getWedgeMetric({ companyId, groupBy: "work_package" });
    const byKey = new Map(rows.map((row) => [row.groupKey, row]));
    expect(byKey.get(wpOne)).toMatchObject({ botCount: 5, manualCount: 5, sampleSize: 10, ratio: 0.5 });
    expect(byKey.get(wpTwo)).toMatchObject({ botCount: 2, manualCount: 0, sampleSize: 2 });
    // The WP parent cards filed no evidence of their own, so they contribute no
    // null-keyed row; only the two work packages appear.
    expect(rows).toHaveLength(2);

    const scoped = await svc.getWedgeMetric({ companyId, groupBy: "work_package", workPackageIssueId: wpOne });
    expect(scoped).toHaveLength(1);
    expect(scoped[0]).toMatchObject({ groupKey: wpOne, sampleSize: 10 });
  });

  it("bounds the ratio to the requested date range (AC3)", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    const before = new Date("2026-08-01T00:00:00.000Z");
    const inside = new Date("2026-09-01T12:00:00.000Z");
    const after = new Date("2026-10-01T00:00:00.000Z");
    await seedEvidenceLinks(companyId, issueId, 4, { source: "bot", createdAt: before });
    await seedEvidenceLinks(companyId, issueId, 3, { source: "bot", createdAt: inside });
    await seedAttachments(companyId, issueId, 1, { source: "manual", createdAt: inside });
    await seedAttachments(companyId, issueId, 6, { source: "manual", createdAt: after });

    const windowed = await svc.getWedgeMetric({
      companyId,
      from: new Date("2026-08-15T00:00:00.000Z"),
      to: new Date("2026-09-15T00:00:00.000Z"),
    });
    expect(windowed[0]).toMatchObject({ botCount: 3, manualCount: 1, sampleSize: 4, ratio: 0.75 });

    const unbounded = await svc.getWedgeMetric({ companyId });
    expect(unbounded[0]).toMatchObject({ botCount: 7, manualCount: 7, sampleSize: 14 });
  });

  it("treats BOTH date bounds as inclusive, to the millisecond (AC3)", async () => {
    // The contract is [from, to] -- closed at both ends. A filing stamped
    // exactly at either bound is inside the window; one a millisecond outside is
    // not. Stated here because a half-open window would silently move a filing
    // between two adjacent reporting windows, or drop it from both.
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    const from = new Date("2026-09-01T00:00:00.000Z");
    const to = new Date("2026-09-30T23:59:59.999Z");
    await seedEvidenceLinks(companyId, issueId, 1, { source: "bot", createdAt: new Date(from.getTime() - 1) });
    await seedEvidenceLinks(companyId, issueId, 1, { source: "bot", createdAt: from });
    await seedAttachments(companyId, issueId, 1, { source: "manual", createdAt: to });
    await seedAttachments(companyId, issueId, 1, { source: "manual", createdAt: new Date(to.getTime() + 1) });

    const rows = await svc.getWedgeMetric({ companyId, from, to });
    // The two rows exactly on the bounds are in; the two a millisecond outside
    // are out.
    expect(rows[0]).toMatchObject({ botCount: 1, manualCount: 1, sampleSize: 2 });
  });

  /**
   * Drop the `issue_evidence_links` source CHECK for the length of one test and
   * hand back a restore function that re-adds it verbatim from its own catalog
   * definition, so this file cannot drift from the migration that defines it.
   * A no-op when the constraint is not present.
   */
  async function suspendEvidenceSourceCheck(): Promise<() => Promise<void>> {
    const rows = (await db.execute(sql`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conname = 'issue_evidence_links_source_check'
    `)) as unknown as Iterable<{ definition: string }>;
    const definition = Array.from(rows)[0]?.definition;
    if (!definition) return async () => {};
    await db.execute(
      sql`ALTER TABLE issue_evidence_links DROP CONSTRAINT issue_evidence_links_source_check`,
    );
    return async () => {
      await db.execute(
        sql`ALTER TABLE issue_evidence_links ADD CONSTRAINT issue_evidence_links_source_check ${sql.raw(definition)}`,
      );
    };
  }

  it("does not drop a filing whose source is outside the union (AC1/AC3)", async () => {
    // `source` is a plain `text` column and `$type<EvidenceSource>()` is only a
    // compile-time cast. Both evidence tables carry a CHECK constraint as of
    // migration 0234, so a writer going through Postgres can no longer produce
    // a fourth value -- but rows written before it (an instance upgrading
    // through 0233, a restored older dump) still can, and the reader must never
    // make one vanish. The constraint is suspended here to put exactly such a
    // legacy row in front of the reader.
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    await seedEvidenceLinks(companyId, issueId, 12, { source: "bot" });

    const restoreCheck = await suspendEvidenceSourceCheck();
    try {
      await seedEvidenceLinks(companyId, issueId, 3, { source: "ui" as never });

      const [row] = await svc.getWedgeMetric({ companyId });
      // Deriving the denominator from bot+manual made those rows vanish from n
      // AND from the ratio, which reported a smaller, cleaner sample than
      // reality -- here it would have been n=12 at ratio 1.0 and band
      // `extend_window` instead of n=15 at 0.8 and band `pass`.
      expect(row).toMatchObject({
        botCount: 12,
        manualCount: 0,
        systemCount: 0,
        otherCount: 3,
        sampleSize: 15,
        ratio: 0.8,
        band: "pass",
      });
    } finally {
      // The off-contract rows have to go before the constraint can come back.
      await db.delete(issueEvidenceLinks);
      await restoreCheck();
    }
  });

  it("never counts another company's filings", async () => {
    const mine = await seedCompany();
    const theirs = await seedCompany();
    const myIssue = await seedIssue(mine.companyId, mine.prefix);
    const theirIssue = await seedIssue(theirs.companyId, theirs.prefix);
    await seedEvidenceLinks(mine.companyId, myIssue, 3, { source: "bot" });
    await seedEvidenceLinks(theirs.companyId, theirIssue, 9, { source: "manual" });

    const rows = await svc.getWedgeMetric({ companyId: mine.companyId });
    expect(rows[0]).toMatchObject({ groupKey: mine.companyId, botCount: 3, manualCount: 0 });
  });
});
