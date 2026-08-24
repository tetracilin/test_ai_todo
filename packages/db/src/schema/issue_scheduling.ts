import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";

export const issueScheduling = pgTable(
  "issue_scheduling",
  {
    issueId: uuid("issue_id").primaryKey(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    deferUntil: timestamp("defer_until", { withTimezone: true }),
    scheduledDurationMinutes: integer("scheduled_duration_minutes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyScheduledAtIdx: index("issue_scheduling_company_scheduled_at_idx").on(table.companyId, table.scheduledAt),
    companyDeferUntilIdx: index("issue_scheduling_company_defer_until_idx").on(table.companyId, table.deferUntil),
    issueCompanyFk: foreignKey({
      name: "issue_scheduling_company_issue_fk",
      columns: [table.companyId, table.issueId],
      foreignColumns: [issues.companyId, issues.id],
    }).onDelete("cascade"),
    positiveDuration: check(
      "issue_scheduling_positive_duration_check",
      sql`${table.scheduledDurationMinutes} is null or ${table.scheduledDurationMinutes} > 0`,
    ),
  }),
);
