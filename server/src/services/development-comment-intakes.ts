import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  commentIntakeSources,
  developmentCommentIntakes,
  issues as issuesTable,
} from "@paperclipai/db";
import type { DevelopmentCommentIntakeListQuery } from "@paperclipai/shared";
import { badRequest } from "../errors.js";
import {
  decodeDevelopmentCommentIntakeCursor,
  developmentCommentIntakeFilterHash,
  encodeDevelopmentCommentIntakeCursor,
} from "./development-comment-intake-cursor.js";

/**
 * Read-only storage access for `development_comment_intakes`
 * (design doc/plans/2026-08-30-dev-comment-intake-design.md §7). Sorting is
 * fixed at `sourceCreatedAt DESC, id DESC`; pagination is a filter-bound
 * opaque keyset cursor; linked backlog status is resolved from the canonical
 * `issues` row at read time (the stored snapshot is never returned).
 *
 * Company scoping is enforced in every query: the list is rooted at
 * `company_id`, and `backlog_issue_id` can only reference an issue in the same
 * company (composite FK), so a stale or forged link can never grant
 * cross-company visibility.
 */

const INTAKE_STATUS_SOURCE_LINKED = "backlog_created";

export type DevelopmentCommentIntakeListItem = {
  id: string;
  source: {
    provider: string | null;
    commentId: string;
    issueId: string | null;
    url: string | null;
    createdAt: string;
  };
  tag: string;
  kind: string;
  subject: string;
  requestBody: string | null;
  intakeStatus: string;
  backlog: {
    issueId: string;
    identifier: string | null;
    status: string;
    updatedAt: string;
  } | null;
  redactedAt: string | null;
  archivedAt: string | null;
};

export type DevelopmentCommentIntakeListResult = {
  items: DevelopmentCommentIntakeListItem[];
  nextCursor: string | null;
};

type IntakeListRow = {
  id: string;
  sourceId: string;
  companyId: string;
  sourceCommentId: string;
  sourceIssueId: string | null;
  sourceCreatedAt: Date;
  sourceUrl: string | null;
  tag: string;
  kind: string;
  subject: string;
  requestBody: string | null;
  intakeStatus: string;
  backlogIssueId: string | null;
  redactedAt: Date | null;
  archivedAt: Date | null;
  provider_key: string | null;
  issueId: string | null;
  issueIdentifier: string | null;
  issueStatus: string | null;
  issueUpdatedAt: Date | null;
};

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

/**
 * Shape a joined intake row into the stable API item. `requestBody` is
 * suppressed for redacted intakes and expired (archived) intakes regardless of
 * what the row currently holds — the agent API never returns a redacted or
 * expired body. `backlog` is resolved from the canonical issue row and is
 * null until a link exists.
 */
export function shapeDevelopmentCommentIntake(row: IntakeListRow): DevelopmentCommentIntakeListItem {
  const bodySuppressed =
    row.intakeStatus === "redacted" || row.intakeStatus === "archived";
  const backlog =
    row.backlogIssueId && row.issueId
      ? {
          issueId: row.issueId,
          identifier: row.issueIdentifier,
          status: row.issueStatus ?? "unknown",
          updatedAt: iso(row.issueUpdatedAt) ?? new Date(0).toISOString(),
        }
      : null;
  return {
    id: row.id,
    source: {
      provider: row.provider_key,
      commentId: row.sourceCommentId,
      issueId: row.sourceIssueId,
      url: row.sourceUrl,
      createdAt: iso(row.sourceCreatedAt) ?? new Date(0).toISOString(),
    },
    tag: row.tag,
    kind: row.kind,
    subject: row.subject,
    requestBody: bodySuppressed ? null : row.requestBody,
    intakeStatus: row.intakeStatus,
    backlog,
    redactedAt: iso(row.redactedAt),
    archivedAt: iso(row.archivedAt),
  };
}

export function developmentCommentIntakeService(db: Db) {
  const intake = developmentCommentIntakes;
  const sources = commentIntakeSources;
  const issues = issuesTable;

  const selectColumns = {
    id: intake.id,
    companyId: intake.companyId,
    sourceId: intake.sourceId,
    sourceCommentId: intake.sourceCommentId,
    sourceIssueId: intake.sourceIssueId,
    sourceCreatedAt: intake.sourceCreatedAt,
    sourceUrl: intake.sourceUrl,
    tag: intake.tag,
    kind: intake.kind,
    subject: intake.subject,
    requestBody: intake.requestBody,
    intakeStatus: intake.intakeStatus,
    backlogIssueId: intake.backlogIssueId,
    redactedAt: intake.redactedAt,
    archivedAt: intake.archivedAt,
    provider_key: sources.providerKey,
    issueId: issues.id,
    issueIdentifier: issues.identifier,
    issueStatus: issues.status,
    issueUpdatedAt: issues.updatedAt,
  };

  function listBaseQuery(companyId: string, query: DevelopmentCommentIntakeListQuery) {
    const conditions: ReturnType<typeof and>[] = [eq(intake.companyId, companyId)];

    if (query.tag !== undefined) conditions.push(eq(intake.tag, query.tag));
    if (query.source !== undefined) conditions.push(eq(sources.providerKey, query.source));
    if (query.kind !== undefined) conditions.push(eq(intake.kind, query.kind));
    if (query.status !== undefined && query.status.length > 0) {
      conditions.push(inArray(intake.intakeStatus, query.status));
    }

    const backlogStatuses = query.backlogStatus ?? [];
    const canonicalStatuses = backlogStatuses.filter((status) => status !== "none");
    const includesNone = backlogStatuses.includes("none");
    if (canonicalStatuses.length > 0 || includesNone) {
      const linkedCondition = inArray(issues.status, canonicalStatuses);
      if (includesNone) {
        conditions.push(or(isNull(intake.backlogIssueId), linkedCondition));
      } else {
        conditions.push(linkedCondition);
      }
    }

    if (query.createdAfter !== undefined) {
      conditions.push(gte(intake.sourceCreatedAt, new Date(query.createdAfter)));
    }
    if (query.createdBefore !== undefined) {
      conditions.push(lte(intake.sourceCreatedAt, new Date(query.createdBefore)));
    }

    if (query.cursor !== undefined) {
      const cursor = decodeDevelopmentCommentIntakeCursor(query.cursor, query);
      const cursorTime = new Date(cursor.t);
      if (Number.isNaN(cursorTime.getTime())) {
        throw badRequest("cursor is invalid");
      }
      conditions.push(
        sql`(${intake.sourceCreatedAt}, ${intake.id}) < (${cursorTime.toISOString()}::timestamptz, ${cursor.i}::uuid)`,
      );
    }

    return and(...conditions);
  }

  return {
    async list(
      companyId: string,
      query: DevelopmentCommentIntakeListQuery,
    ): Promise<DevelopmentCommentIntakeListResult> {
      const limit = query.limit ?? 50;
      const where = listBaseQuery(companyId, query);
      const rows = (await db
        .select(selectColumns)
        .from(intake)
        .leftJoin(sources, eq(intake.sourceId, sources.id))
        .leftJoin(
          issues,
          and(eq(intake.backlogIssueId, issues.id), eq(intake.companyId, issues.companyId)),
        )
        .where(where)
        .orderBy(desc(intake.sourceCreatedAt), desc(intake.id))
        .limit(limit + 1)) as IntakeListRow[];

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const items = page.map((row) => shapeDevelopmentCommentIntake(row));

      let nextCursor: string | null = null;
      if (hasMore && page.length > 0) {
        const last = page[page.length - 1]!;
        nextCursor = encodeDevelopmentCommentIntakeCursor({
          v: 1,
          f: developmentCommentIntakeFilterHash(query),
          t: iso(last.sourceCreatedAt) ?? new Date(0).toISOString(),
          i: last.id,
        });
      }

      return { items, nextCursor };
    },

    async getById(
      companyId: string,
      intakeId: string,
    ): Promise<DevelopmentCommentIntakeListItem | null> {
      const rows = (await db
        .select(selectColumns)
        .from(intake)
        .leftJoin(sources, eq(intake.sourceId, sources.id))
        .leftJoin(
          issues,
          and(eq(intake.backlogIssueId, issues.id), eq(intake.companyId, issues.companyId)),
        )
        .where(and(eq(intake.companyId, companyId), eq(intake.id, intakeId)))
        .limit(1)) as IntakeListRow[];
      const row = rows[0];
      return row ? shapeDevelopmentCommentIntake(row) : null;
    },
  };
}

export type DevelopmentCommentIntakeService = ReturnType<typeof developmentCommentIntakeService>;