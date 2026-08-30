import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";

export const commentIntakeSources = pgTable(
  "comment_intake_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    providerKey: text("provider_key").notNull(),
    objectType: text("object_type").notNull(),
    sourceScopeId: text("source_scope_id").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    tag: text("tag").notNull().default("@dev"),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyScopeUq: uniqueIndex("comment_intake_sources_company_scope_uq").on(table.companyId, table.providerKey, table.objectType, table.sourceScopeId),
    idCompanyUq: uniqueIndex("comment_intake_sources_id_company_uq").on(table.id, table.companyId),
  }),
);

export const commentIntakeCheckpoints = pgTable(
  "comment_intake_checkpoints",
  {
    sourceId: uuid("source_id").primaryKey().references(() => commentIntakeSources.id, { onDelete: "cascade" }),
    cursor: text("cursor"),
    highWatermarkOccurredAt: timestamp("high_watermark_occurred_at", { withTimezone: true }),
    highWatermarkId: text("high_watermark_id"),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    consecutiveFailureCount: integer("consecutive_failure_count").notNull().default(0),
    lastErrorCode: text("last_error_code"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    failuresNonnegative: check("comment_intake_checkpoints_failures_nonnegative", sql`${table.consecutiveFailureCount} >= 0`),
  }),
);

export const developmentCommentIntakes = pgTable(
  "development_comment_intakes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").notNull().references(() => commentIntakeSources.id, { onDelete: "cascade" }),
    sourceCommentId: text("source_comment_id").notNull(),
    sourceIssueId: uuid("source_issue_id").references(() => issues.id, { onDelete: "set null" }),
    sourceAuthorUserId: text("source_author_user_id"),
    sourceCreatedAt: timestamp("source_created_at", { withTimezone: true }).notNull(),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }).notNull(),
    sourceUrl: text("source_url"),
    tag: text("tag").notNull().default("@dev"),
    tagPositions: jsonb("tag_positions").notNull().default([]),
    kind: text("kind").notNull(),
    subject: text("subject").notNull(),
    requestBody: text("request_body"),
    contentFingerprint: text("content_fingerprint").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    intakeStatus: text("intake_status").notNull().default("new"),
    backlogIssueId: uuid("backlog_issue_id").references(() => issues.id, { onDelete: "set null" }),
    backlogStatusSnapshot: text("backlog_status_snapshot"),
    backlogUpdatedAt: timestamp("backlog_updated_at", { withTimezone: true }),
    dismissedReasonCode: text("dismissed_reason_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    redactedAt: timestamp("redacted_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => ({
    companyDedupeUq: uniqueIndex("development_comment_intakes_company_dedupe_uq").on(table.companyId, table.dedupeKey),
    backlogUq: uniqueIndex("development_comment_intakes_backlog_issue_uq").on(table.backlogIssueId).where(sql`${table.backlogIssueId} is not null`),
    companyStatusCreatedIdx: index("development_comment_intakes_company_status_created_idx").on(table.companyId, table.intakeStatus, table.sourceCreatedAt.desc(), table.id.desc()),
    companyKindCreatedIdx: index("development_comment_intakes_company_kind_created_idx").on(table.companyId, table.kind, table.sourceCreatedAt.desc(), table.id.desc()),
    sourceCommentIdx: index("development_comment_intakes_source_comment_idx").on(table.sourceId, table.sourceCommentId),
    sourceCompanyFk: foreignKey({ columns: [table.sourceId, table.companyId], foreignColumns: [commentIntakeSources.id, commentIntakeSources.companyId], name: "development_comment_intakes_source_company_fk" }),
    // Composite FK column order must match the referenced unique index
    // "issues_company_id_unique_idx" on (company_id, id) so the constraint is
    // satisfiable by PostgreSQL's exact-order referenced-key matching.
    backlogCompanyFk: foreignKey({ columns: [table.companyId, table.backlogIssueId], foreignColumns: [issues.companyId, issues.id], name: "development_comment_intakes_backlog_company_fk" }),
  }),
);

export const commentIntakeRuns = pgTable(
  "comment_intake_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").notNull().references(() => commentIntakeSources.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    pageCount: integer("page_count").notNull().default(0),
    candidateCount: integer("candidate_count").notNull().default(0),
    createdCount: integer("created_count").notNull().default(0),
    updatedCount: integer("updated_count").notNull().default(0),
    duplicateCount: integer("duplicate_count").notNull().default(0),
    rejectedCount: integer("rejected_count").notNull().default(0),
    errorCode: text("error_code"),
    errorDetail: text("error_detail"),
  },
  (table) => ({ sourceStartedIdx: index("comment_intake_runs_source_started_idx").on(table.sourceId, table.startedAt) }),
);
