import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
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

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

// F-011-1 / F-007-1: migration 0234 moves two invariants out of TypeScript and
// into Postgres. `$type<EvidenceSource>()` is a compile-time cast over a plain
// `text` column, and "this link already exists" was an app-level
// check-then-insert -- neither holds against the writers that matter here: raw
// SQL, a company-portability import, or two concurrent filings. So every insert
// below goes through `db.execute` rather than the typed client; asserting
// through the client would only re-test the cast.

// SQLSTATE rather than a message: each case is about WHICH invariant fired, and
// a bare `rejects.toThrow()` would also pass on an unrelated FK failure.
const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";

/** The SQLSTATE of the rejection, or null if the statement was accepted. */
async function sqlStateOf(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    // drizzle-orm wraps driver failures in a DrizzleQueryError, so the SQLSTATE
    // sits on the postgres.js error underneath rather than on what was thrown.
    for (let current: unknown = error; current; current = (current as { cause?: unknown }).cause) {
      const code = (current as { code?: unknown }).code;
      if (typeof code === "string") return code;
    }
    // Rethrow rather than return null: an unclassifiable failure must not read
    // as "the database accepted this".
    throw error;
  }
}

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres evidence source constraint tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("evidence source constraints (F-011-1, F-007-1)", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-evidence-source-constraint-");
    db = createDb(tempDb.connectionString);
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
    const prefix = `EC${companyId.replaceAll("-", "").slice(0, 6).toUpperCase()}`;
    await db.insert(companies).values({
      id: companyId,
      name: "Evidence Constraint Co",
      issuePrefix: prefix,
      requireBoardApprovalForNewAgents: false,
    });
    return { companyId, prefix };
  }

  type FilingTarget = {
    companyId: string;
    issueId: string;
    externalObjectId: string;
    assetId: string;
  };

  /** One issue plus a fresh external object and asset to file against it. */
  async function seedFilingTarget(company?: { companyId: string; prefix: string }): Promise<FilingTarget> {
    const { companyId, prefix } = company ?? (await seedCompany());

    issueCounter += 1;
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: `Constraint issue ${issueCounter}`,
      status: "todo",
      priority: "medium",
      issueNumber: issueCounter,
      identifier: `${prefix}-${issueCounter}`,
    });

    const externalObjectId = randomUUID();
    await db.insert(externalObjects).values({
      id: externalObjectId,
      companyId,
      providerKey: "test-provider",
      objectType: "test-object",
      externalId: randomUUID(),
    });

    const assetId = randomUUID();
    await db.insert(assets).values({
      id: assetId,
      companyId,
      provider: "test",
      objectKey: `key-${assetId}`,
      contentType: "text/plain",
      byteSize: 10,
      sha256: "a".repeat(64),
    });

    return { companyId, issueId, externalObjectId, assetId };
  }

  function insertLink(target: FilingTarget, source: string, externalObjectId = target.externalObjectId) {
    return db.execute(sql`
      insert into issue_evidence_links (id, company_id, issue_id, external_object_id, source)
      values (${randomUUID()}, ${target.companyId}, ${target.issueId}, ${externalObjectId}, ${source})
    `);
  }

  function insertAttachment(target: FilingTarget, source: string) {
    return db.execute(sql`
      insert into issue_attachments (id, company_id, issue_id, asset_id, source)
      values (${randomUUID()}, ${target.companyId}, ${target.issueId}, ${target.assetId}, ${source})
    `);
  }

  it("rejects a source outside the union on both evidence tables", async () => {
    const target = await seedFilingTarget();

    expect(await sqlStateOf(() => insertLink(target, "banana"))).toBe(CHECK_VIOLATION);
    expect(await sqlStateOf(() => insertAttachment(target, "banana"))).toBe(CHECK_VIOLATION);
    // `ui` is the third value the wedge metric's `otherCount` bucket was written
    // to tolerate; after 0234 it cannot be stored in the first place.
    expect(await sqlStateOf(() => insertLink(target, "ui"))).toBe(CHECK_VIOLATION);
    expect(await sqlStateOf(() => insertAttachment(target, "ui"))).toBe(CHECK_VIOLATION);
    // Nothing normalises case or whitespace on the way in, so near-misses have
    // to be rejected too or an unclassifiable row still lands.
    expect(await sqlStateOf(() => insertLink(target, "Bot"))).toBe(CHECK_VIOLATION);
    expect(await sqlStateOf(() => insertLink(target, " manual"))).toBe(CHECK_VIOLATION);
    expect(await sqlStateOf(() => insertLink(target, ""))).toBe(CHECK_VIOLATION);

    expect(await db.select().from(issueEvidenceLinks)).toHaveLength(0);
    expect(await db.select().from(issueAttachments)).toHaveLength(0);
  });

  it("accepts bot, manual and system", async () => {
    // Spelled out rather than read from EVIDENCE_SOURCES: widening the union
    // should have to widen this list too, not silently pass.
    for (const source of ["bot", "manual", "system"]) {
      const target = await seedFilingTarget();
      expect(await sqlStateOf(() => insertLink(target, source))).toBeNull();
      expect(await sqlStateOf(() => insertAttachment(target, source))).toBeNull();
    }

    const links = await db.select().from(issueEvidenceLinks);
    const attachments = await db.select().from(issueAttachments);
    expect(links.map((row) => row.source).sort()).toEqual(["bot", "manual", "system"]);
    expect(attachments.map((row) => row.source).sort()).toEqual(["bot", "manual", "system"]);
  });

  it("rejects a second link for the same (issue, external object) pair", async () => {
    const target = await seedFilingTarget();

    expect(await sqlStateOf(() => insertLink(target, "bot"))).toBeNull();
    // A different `source` is still the same filing act. Two rows would count
    // one object twice in the evidence gate and in the wedge-ratio numerator.
    expect(await sqlStateOf(() => insertLink(target, "manual"))).toBe(UNIQUE_VIOLATION);

    const rows = await db.select().from(issueEvidenceLinks);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.source).toBe("bot");
  });

  it("still allows the same object on a different issue", async () => {
    // Uniqueness is per (issue, object), not per object: the same commit is
    // legitimately evidence on two cards, and each card is its own filing act.
    const company = await seedCompany();
    const first = await seedFilingTarget(company);
    const second = await seedFilingTarget(company);

    expect(await sqlStateOf(() => insertLink(first, "bot"))).toBeNull();
    expect(await sqlStateOf(() => insertLink(second, "manual", first.externalObjectId))).toBeNull();

    expect(await db.select().from(issueEvidenceLinks)).toHaveLength(2);
  });
});
