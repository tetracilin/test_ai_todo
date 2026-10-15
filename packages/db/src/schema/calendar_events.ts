import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";
import { issues } from "./issues.js";

export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id"),
    title: text("title").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    createdByUserId: text("created_by_user_id"),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStartsAtIdx: index("calendar_events_company_starts_at_idx").on(table.companyId, table.startsAt),
    issueUniqueIdx: uniqueIndex("calendar_events_issue_unique_idx")
      .on(table.issueId)
      .where(sql`${table.issueId} is not null`),
    issueCompanyFk: foreignKey({
      name: "calendar_events_company_issue_fk",
      columns: [table.companyId, table.issueId],
      foreignColumns: [issues.companyId, issues.id],
    }).onDelete("cascade"),
    validRange: check("calendar_events_valid_range_check", sql`${table.endsAt} > ${table.startsAt}`),
  }),
);
