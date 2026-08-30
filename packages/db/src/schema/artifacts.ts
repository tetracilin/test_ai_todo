import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";
import { agents } from "./agents.js";

/**
 * An artifact is a file attached to a task (issue) via the "open file" flow.
 * Editable document types (markdown/docx/xlsx) are `kind = "document"` with a
 * non-null `format`; every other file type is `kind = "attachment"` with a
 * null `format` and is version-controlled but not editable in-app.
 */
export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("attachment"),
    format: text("format"),
    name: text("name").notNull(),
    contentType: text("content_type").notNull(),
    currentVersionId: uuid("current_version_id"),
    currentVersionNumber: integer("current_version_number").notNull().default(0),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIssueIdx: index("artifacts_company_issue_idx").on(table.companyId, table.issueId),
    companyCreatedIdx: index("artifacts_company_created_idx").on(table.companyId, table.createdAt),
    currentVersionIdx: index("artifacts_current_version_idx").on(table.currentVersionId),
  }),
);
