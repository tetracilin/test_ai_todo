import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { calendarEvents, companies, createDb, issueScheduling, issues } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("calendar_events schema", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-calendar-events-schema-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedIssue() {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Events Co",
      issuePrefix: `E${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    const [issue] = await db
      .insert(issues)
      .values({ companyId, title: "Pinned issue", status: "todo", priority: "medium" })
      .returning();
    return { companyId, issueId: issue!.id };
  }

  it("rejects a second event for the same issue", async () => {
    const { companyId, issueId } = await seedIssue();
    const startsAt = new Date("2026-10-14T03:00:00.000Z");
    const endsAt = new Date("2026-10-14T03:30:00.000Z");
    await db.insert(calendarEvents).values({ companyId, issueId, title: "A", startsAt, endsAt });
    await expect(
      db.insert(calendarEvents).values({ companyId, issueId, title: "B", startsAt, endsAt }),
    ).rejects.toThrow();
  });

  it("rejects an event whose end is not after its start", async () => {
    const { companyId, issueId } = await seedIssue();
    const at = new Date("2026-10-14T03:00:00.000Z");
    await expect(
      db.insert(calendarEvents).values({ companyId, issueId, title: "Zero", startsAt: at, endsAt: at }),
    ).rejects.toThrow();
  });

  it("removes the event when its issue is deleted", async () => {
    const { companyId, issueId } = await seedIssue();
    await db.insert(calendarEvents).values({
      companyId, issueId, title: "Gone",
      startsAt: new Date("2026-10-14T03:00:00.000Z"), endsAt: new Date("2026-10-14T03:30:00.000Z"),
    });
    await db.delete(issues).where(eq(issues.id, issueId));
    const rows = await db.select().from(calendarEvents).where(eq(calendarEvents.issueId, issueId));
    expect(rows).toHaveLength(0);
  });

  it("backfills scheduled issues with the migration's own SQL", async () => {
    const { companyId, issueId } = await seedIssue();
    await db.insert(issueScheduling).values({
      issueId, companyId, scheduledAt: new Date("2026-10-14T05:00:00.000Z"), scheduledDurationMinutes: 45,
    });
    const { companyId: otherCompany, issueId: noDurationIssue } = await seedIssue();
    await db.insert(issueScheduling).values({
      issueId: noDurationIssue, companyId: otherCompany, scheduledAt: new Date("2026-10-14T06:00:00.000Z"),
    });
    const { companyId: unscheduledCompany, issueId: unscheduledIssue } = await seedIssue();
    await db.insert(issueScheduling).values({
      issueId: unscheduledIssue, companyId: unscheduledCompany, scheduledDurationMinutes: 20,
    });

    const migrationsDir = path.resolve(__dirname, "../../../packages/db/src/migrations");
    const file = readdirSync(migrationsDir).find((name) => /^0235_.*\.sql$/.test(name));
    expect(file).toBeDefined();
    const statements = readFileSync(path.join(migrationsDir, file!), "utf8").split("--> statement-breakpoint");
    const backfill = statements.find((statement) => statement.includes("-- backfill"));
    expect(backfill).toBeDefined();
    await db.execute(sql.raw(backfill!));

    const [pinned] = await db.select().from(calendarEvents).where(eq(calendarEvents.issueId, issueId));
    expect(pinned?.title).toBe("Pinned issue");
    expect(pinned?.endsAt.toISOString()).toBe("2026-10-14T05:45:00.000Z");
    const [defaulted] = await db.select().from(calendarEvents).where(eq(calendarEvents.issueId, noDurationIssue));
    expect(defaulted?.endsAt.toISOString()).toBe("2026-10-14T06:30:00.000Z");
    const none = await db.select().from(calendarEvents).where(eq(calendarEvents.issueId, unscheduledIssue));
    expect(none).toHaveLength(0);

    await db.execute(sql.raw(backfill!));
    const again = await db.select().from(calendarEvents).where(eq(calendarEvents.issueId, issueId));
    expect(again).toHaveLength(1);
  });
});
