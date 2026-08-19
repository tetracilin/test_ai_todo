import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";
import { projects } from "./projects.js";
import type { SchedulingRecurrenceRule } from "@paperclipai/shared";

export const schedulingRoutines = pgTable(
  "scheduling_routines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    assigneeAgentId: uuid("assignee_agent_id").references(() => agents.id, { onDelete: "set null" }),
    assigneeUserId: text("assignee_user_id"),
    priority: text("priority").notNull().default("medium"),
    status: text("status").notNull().default("active"),
    recurrenceRule: jsonb("recurrence_rule").$type<SchedulingRecurrenceRule>().notNull(),
    scheduledTime: text("scheduled_time"),
    estimateMinutes: integer("estimate_minutes"),
    lastGeneratedForDate: text("last_generated_for_date"),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStatusIdx: index("scheduling_routines_company_status_idx").on(table.companyId, table.status),
    companyAssigneeIdx: index("scheduling_routines_company_assignee_idx").on(table.companyId, table.assigneeAgentId),
    companyProjectIdx: index("scheduling_routines_company_project_idx").on(table.companyId, table.projectId),
  }),
);
