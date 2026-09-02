import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";
import { externalObjects } from "./external_objects.js";

// PC-011 AC1: evidence provenance is recorded per FILING ACT, not per object.
// The same external object can be bot-linked on one card and manually linked on
// another, so the column lives on this link row and on `issue_attachments` --
// never on `external_objects`. `bot` is written by the chat bot's evidence
// filing path (PC-007); every other writer takes the `manual` default.
export const EVIDENCE_SOURCES = ["bot", "manual"] as const;
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
  }),
);
