import { index, integer, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";

export const issueScheduling = pgTable(
  "issue_scheduling",
  {
    issueId: uuid("issue_id").primaryKey().references(() => issues.id, { onDelete: "cascade" }),
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
  }),
);
