import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";
import { externalObjects } from "./external_objects.js";

// PC-011 AC1: evidence provenance is recorded per FILING ACT, not per object.
// The same external object can be bot-linked on one card and manually linked on
// another, so the column lives on this link row and on `issue_attachments` --
// never on `external_objects`. `bot` is written by the chat bot's evidence
// filing path (PC-007); every other writer takes the `manual` default.
// `system` is for filings no human authored at all (auto-linked git commits and
// the like): they are neither a bot capture nor a human re-entry, so the wedge
// ratio excludes them instead of letting them suppress it (gate UC-1,
// 2026-09-03). Held as a CHECK constraint rather than a Postgres enum so a
// fourth source is a migration, not a type rewrite.
export const EVIDENCE_SOURCES = ["bot", "manual", "system"] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

export const issueEvidenceLinks = pgTable(
  "issue_evidence_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    externalObjectId: uuid("external_object_id")
      .notNull()
      .references(() => externalObjects.id, { onDelete: "cascade" }),
    source: text("source").$type<EvidenceSource>().notNull().default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIssueIdx: index("issue_evidence_links_company_issue_idx").on(table.companyId, table.issueId),
    // F-007-1: idempotent re-filing is a DATABASE invariant, not an app-level
    // check-then-insert -- two concurrent filings of the same object race
    // straight through that check, and the second row inflates both the
    // evidence gate count and the wedge-ratio numerator.
    issueObjectUq: uniqueIndex("issue_evidence_links_issue_object_uq").on(table.issueId, table.externalObjectId),
    // F-011-1: `$type<EvidenceSource>()` is a compile-time cast over a plain
    // `text` column, so without this any writer bypassing the typed client
    // (portability import, raw SQL) could land a source the wedge metric
    // cannot classify.
    sourceCheck: check("issue_evidence_links_source_check", sql`${table.source} in ('bot', 'manual', 'system')`),
  }),
);
