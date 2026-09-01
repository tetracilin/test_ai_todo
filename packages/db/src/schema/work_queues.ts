import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";
import { issues } from "./issues.js";
import type { WorkQueueItemStatus } from "@paperclipai/shared";

export const workQueues = pgTable(
  "work_queues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companySlugUniqueIdx: uniqueIndex("work_queues_company_slug_uq").on(table.companyId, table.slug),
    companyUpdatedIdx: index("work_queues_company_updated_idx").on(table.companyId, table.updatedAt),
  }),
);

export const workQueueItems = pgTable(
  "work_queue_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Denormalized alongside the queueId parent FK (matching issues.ts's pattern of
    // carrying companyId even under a parent FK) so item queries and RLS-style
    // company scoping checks never need to join through work_queues.
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    queueId: uuid("queue_id").notNull().references(() => workQueues.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body"),
    sourceLabel: text("source_label"),
    status: text("status").$type<WorkQueueItemStatus>().notNull().default("open"),
    promotedIssueId: uuid("promoted_issue_id").references(() => issues.id, { onDelete: "set null" }),
    promotedAt: timestamp("promoted_at", { withTimezone: true }),
    promotedByAgentId: uuid("promoted_by_agent_id").references(() => agents.id),
    promotedByUserId: text("promoted_by_user_id"),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    dismissedByAgentId: uuid("dismissed_by_agent_id").references(() => agents.id),
    dismissedByUserId: text("dismissed_by_user_id"),
    dismissReason: text("dismiss_reason"),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyQueueStatusIdx: index("work_queue_items_company_queue_status_idx").on(
      table.companyId,
      table.queueId,
      table.status,
      table.createdAt,
    ),
    companyStatusIdx: index("work_queue_items_company_status_idx").on(table.companyId, table.status),
    // Mirrors issues.ts's originIdx-style back-reference lookup, here from the
    // promoted issue back to the queue item that produced it.
    promotedIssueIdx: index("work_queue_items_promoted_issue_idx").on(table.promotedIssueId),
  }),
);
