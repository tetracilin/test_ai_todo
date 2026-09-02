import { pgTable, uuid, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";
import { externalObjects } from "./external_objects.js";

export const issueEvidenceLinks = pgTable(
  "issue_evidence_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    externalObjectId: uuid("external_object_id")
      .notNull()
      .references(() => externalObjects.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIssueIdx: index("issue_evidence_links_company_issue_idx").on(table.companyId, table.issueId),
  }),
);
