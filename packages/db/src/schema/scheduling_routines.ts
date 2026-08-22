import { sql } from "drizzle-orm";
import { check, date, foreignKey, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";
import { projects } from "./projects.js";
import type { SchedulingRecurrenceRule } from "@paperclipai/shared";

export const schedulingRoutines = pgTable(
  "scheduling_routines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id"),
    title: text("title").notNull(),
    description: text("description"),
    assigneeAgentId: uuid("assignee_agent_id").references(() => agents.id, { onDelete: "set null" }),
    assigneeUserId: text("assignee_user_id"),
    priority: text("priority").notNull().default("medium"),
    status: text("status").notNull().default("active"),
    recurrenceRule: jsonb("recurrence_rule").$type<SchedulingRecurrenceRule>().notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    scheduledTime: text("scheduled_time"),
    estimateMinutes: integer("estimate_minutes"),
    lastGeneratedForDate: date("last_generated_for_date"),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStatusIdx: index("scheduling_routines_company_status_idx").on(table.companyId, table.status),
    companyAssigneeIdx: index("scheduling_routines_company_assignee_idx").on(table.companyId, table.assigneeAgentId),
    companyProjectIdx: index("scheduling_routines_company_project_idx").on(table.companyId, table.projectId),
    projectCompanyFk: foreignKey({
      name: "scheduling_routines_company_project_fk",
      columns: [table.companyId, table.projectId],
      foreignColumns: [projects.companyId, projects.id],
    }).onDelete("cascade"),
    assigneeAgentCompanyFk: foreignKey({
      name: "scheduling_routines_company_assignee_agent_fk",
      columns: [table.companyId, table.assigneeAgentId],
      foreignColumns: [agents.companyId, agents.id],
    }),
    createdByAgentCompanyFk: foreignKey({
      name: "scheduling_routines_company_created_by_agent_fk",
      columns: [table.companyId, table.createdByAgentId],
      foreignColumns: [agents.companyId, agents.id],
    }),
    positiveEstimate: check(
      "scheduling_routines_positive_estimate_check",
      sql`${table.estimateMinutes} is null or ${table.estimateMinutes} > 0`,
    ),
    nonEmptyTimezone: check("scheduling_routines_non_empty_timezone_check", sql`btrim(${table.timezone}) <> ''`),
  }),
);
