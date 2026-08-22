import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  approvals,
  authUsers,
  companyMemberships,
  issueApprovals,
  issueComments,
  issues,
} from "@paperclipai/db";
import { APPROVAL_TYPES } from "@paperclipai/shared";

const LEGACY_APPROVAL_TYPE = "request_board_approval" as const;
const TERMINAL_DECIDER_ROLES = ["owner", "admin", "operator"] as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type LegacyApprovalStatus = "Pending" | "Approved" | "Rejected";

export interface LegacyApprovalImportRow {
  companyId: string;
  sourceId: string;
  issueId: string;
  status: LegacyApprovalStatus;
  reason: string | null;
  requesterUserId: string | null;
  approverUserId: string | null;
  response: string | null;
  resolvedAt: Date | null;
  updatedAt: Date;
}

export type LegacyApprovalImportCheckpointEntry =
  | { outcome: "imported_approval"; canonicalId: string }
  | { outcome: "imported_comment"; canonicalId: string }
  | { outcome: "skipped"; canonicalId: null };

export interface LegacyApprovalImportCheckpoint {
  get(companyId: string, sourceId: string): Promise<LegacyApprovalImportCheckpointEntry | null>;
  put(companyId: string, sourceId: string, entry: LegacyApprovalImportCheckpointEntry): Promise<void>;
}

export type LegacyApprovalImportExceptionCode =
  | "approval_requester_unresolved"
  | "approval_terminal_decider_unresolved"
  | "approval_orphan_issue";

export interface LegacyApprovalImportException {
  code: LegacyApprovalImportExceptionCode;
  sourceId: string;
}

export interface LegacyApprovalImportResult {
  outcome: LegacyApprovalImportCheckpointEntry["outcome"];
  canonicalId: string | null;
  exceptions: LegacyApprovalImportException[];
  idempotent: boolean;
}

export interface LegacyApprovalImportIssue {
  id: string;
  companyId: string;
  title: string;
}

export interface LegacyApprovalInsert {
  id: string;
  companyId: string;
  issueId: string;
  type: typeof LEGACY_APPROVAL_TYPE;
  status: "pending" | "approved" | "rejected";
  requestedByUserId: string | null;
  decidedByUserId: string | null;
  decisionNote: string | null;
  decidedAt: Date | null;
  updatedAt: Date;
  payload: {
    title: string;
    summary: string;
    recommendedAction: string;
    risks: string[];
  };
}

export interface LegacyApprovalCommentInsert {
  id: string;
  companyId: string;
  issueId: string;
  body: string;
  createdAt: Date;
}

export interface LegacyApprovalImportOperations {
  findIssue(issueId: string): Promise<LegacyApprovalImportIssue | null>;
  resolveActiveUserMembership(
    companyId: string,
    userId: string,
    allowedRoles?: readonly string[],
  ): Promise<string | null>;
  isCheckpointEntryApplied(
    companyId: string,
    issueId: string,
    entry: LegacyApprovalImportCheckpointEntry,
  ): Promise<boolean>;
  insertApproval(approval: LegacyApprovalInsert): Promise<LegacyApprovalInsert>;
  insertIssueComment(comment: LegacyApprovalCommentInsert): Promise<LegacyApprovalCommentInsert>;
}

export interface LegacyApprovalImportStore extends LegacyApprovalImportOperations {
  withCompanyLock<T>(
    companyId: string,
    operation: (store: LegacyApprovalImportOperations) => Promise<T>,
  ): Promise<T>;
}

function deterministicPayload(issueTitle: string, reason: string | null): LegacyApprovalInsert["payload"] {
  return {
    title: `Legacy approval for: ${issueTitle}`,
    summary: reason?.trim() || "No reason supplied",
    recommendedAction: "Approve or reject the linked legacy request after reviewing imported context.",
    risks: ["Imported historical request; no legacy approver authority was transferred."],
  };
}

function terminalComment(row: LegacyApprovalImportRow): string {
  return [
    "Legacy terminal approval was not imported as an operational approval because its decider could not be authorized.",
    "",
    `Source status: ${row.status}`,
    `Reason: ${row.reason?.trim() || "No reason supplied"}`,
    `Response: ${row.response?.trim() || "No response supplied"}`,
    `Resolved at: ${row.resolvedAt?.toISOString() ?? "Unknown"}`,
    `Updated at: ${row.updatedAt.toISOString()}`,
  ].join("\n");
}

function validateRow(row: LegacyApprovalImportRow): void {
  if (!UUID_PATTERN.test(row.companyId)) throw new Error("companyId must be a UUID");
  if (!UUID_PATTERN.test(row.issueId)) throw new Error("issueId must be a UUID");
  if (!row.sourceId.trim()) throw new Error("sourceId must be non-empty");
  if (!(row.updatedAt instanceof Date) || Number.isNaN(row.updatedAt.getTime())) {
    throw new Error("updatedAt must be a valid date");
  }
  if (row.resolvedAt !== null && (!(row.resolvedAt instanceof Date) || Number.isNaN(row.resolvedAt.getTime()))) {
    throw new Error("resolvedAt must be a valid date or null");
  }
}

export function legacyApprovalImporter(
  store: LegacyApprovalImportStore,
  checkpoint: LegacyApprovalImportCheckpoint,
) {
  if (!(APPROVAL_TYPES as readonly string[]).includes(LEGACY_APPROVAL_TYPE)) {
    throw new Error(`Unsupported canonical approval type: ${LEGACY_APPROVAL_TYPE}`);
  }

  return {
    importRow: async (row: LegacyApprovalImportRow): Promise<LegacyApprovalImportResult> => {
      validateRow(row);
      return store.withCompanyLock(row.companyId, async (lockedStore) => {
        const existing = await checkpoint.get(row.companyId, row.sourceId);
        if (existing && await lockedStore.isCheckpointEntryApplied(row.companyId, row.issueId, existing)) {
          return {
            ...existing,
            exceptions: [],
            idempotent: true,
          };
        }

        if (row.status !== "Pending" && row.status !== "Approved" && row.status !== "Rejected") {
          throw new Error(`Unsupported legacy approval status: ${String(row.status)}`);
        }

        const issue = await lockedStore.findIssue(row.issueId);
        if (!issue || issue.companyId !== row.companyId) {
          const entry = { outcome: "skipped", canonicalId: null } as const;
          await checkpoint.put(row.companyId, row.sourceId, entry);
          return {
            ...entry,
            exceptions: [{ code: "approval_orphan_issue", sourceId: row.sourceId }],
            idempotent: false,
          };
        }

        const requesterUserId = row.requesterUserId
          ? await lockedStore.resolveActiveUserMembership(row.companyId, row.requesterUserId)
          : null;
        const exceptions: LegacyApprovalImportException[] = [];
        if (!requesterUserId) {
          exceptions.push({ code: "approval_requester_unresolved", sourceId: row.sourceId });
        }

        const terminal = row.status === "Approved" || row.status === "Rejected";
        const decidedByUserId = terminal && row.approverUserId
          ? await lockedStore.resolveActiveUserMembership(
              row.companyId,
              row.approverUserId,
              TERMINAL_DECIDER_ROLES,
            )
          : null;

        if (terminal && !decidedByUserId) {
          const commentId = randomUUID();
          await lockedStore.insertIssueComment({
            id: commentId,
            companyId: row.companyId,
            issueId: issue.id,
            body: terminalComment(row),
            createdAt: row.updatedAt,
          });
          const entry = { outcome: "imported_comment", canonicalId: commentId } as const;
          await checkpoint.put(row.companyId, row.sourceId, entry);
          exceptions.push({
            code: "approval_terminal_decider_unresolved",
            sourceId: row.sourceId,
          });
          return { ...entry, exceptions, idempotent: false };
        }

        const approvalId = existing?.outcome === "imported_approval"
          ? existing.canonicalId
          : randomUUID();
        await lockedStore.insertApproval({
          id: approvalId,
          companyId: row.companyId,
          issueId: issue.id,
          type: LEGACY_APPROVAL_TYPE,
          status: row.status === "Pending" ? "pending" : row.status === "Approved" ? "approved" : "rejected",
          requestedByUserId: requesterUserId,
          decidedByUserId,
          decisionNote: terminal ? row.response : null,
          decidedAt: terminal ? row.resolvedAt ?? row.updatedAt : null,
          updatedAt: row.updatedAt,
          payload: deterministicPayload(issue.title, row.reason),
        });
        const entry = { outcome: "imported_approval", canonicalId: approvalId } as const;
        await checkpoint.put(row.companyId, row.sourceId, entry);
        return { ...entry, exceptions, idempotent: false };
      });
    },
  };
}

export function legacyApprovalImportService(db: Db, checkpoint: LegacyApprovalImportCheckpoint) {
  return legacyApprovalImporter(createLegacyApprovalImportStore(db), checkpoint);
}

function createLegacyApprovalImportStore(db: Db): LegacyApprovalImportStore {
  function operations(activeDb: any): LegacyApprovalImportOperations {
    return {
      findIssue: (issueId) =>
        activeDb
          .select({ id: issues.id, companyId: issues.companyId, title: issues.title })
          .from(issues)
          .where(eq(issues.id, issueId))
          .then((rows: LegacyApprovalImportIssue[]) => rows[0] ?? null),

      resolveActiveUserMembership: (companyId, userId, allowedRoles) => {
        const conditions = [
          eq(companyMemberships.companyId, companyId),
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, userId),
          eq(companyMemberships.status, "active"),
        ];
        if (allowedRoles) {
          conditions.push(inArray(companyMemberships.membershipRole, [...allowedRoles]));
        }
        return activeDb
          .select({ userId: authUsers.id })
          .from(companyMemberships)
          .innerJoin(authUsers, eq(authUsers.id, companyMemberships.principalId))
          .where(and(...conditions))
          .then((rows: Array<{ userId: string }>) => rows[0]?.userId ?? null);
      },

      isCheckpointEntryApplied: async (companyId, issueId, entry) => {
        if (entry.outcome === "skipped") return true;
        if (entry.outcome === "imported_comment") {
          return activeDb
            .select({ id: issueComments.id })
            .from(issueComments)
            .where(
              and(
                eq(issueComments.id, entry.canonicalId),
                eq(issueComments.companyId, companyId),
                eq(issueComments.issueId, issueId),
              ),
            )
            .then((rows: Array<{ id: string }>) => rows.length > 0);
        }
        return activeDb
          .select({ id: approvals.id })
          .from(approvals)
          .innerJoin(
            issueApprovals,
            and(
              eq(issueApprovals.approvalId, approvals.id),
              eq(issueApprovals.companyId, companyId),
              eq(issueApprovals.issueId, issueId),
            ),
          )
          .where(and(eq(approvals.id, entry.canonicalId), eq(approvals.companyId, companyId)))
          .then((rows: Array<{ id: string }>) => rows.length > 0);
      },

      insertApproval: async (approval) => {
        await activeDb.insert(approvals).values({
          id: approval.id,
          companyId: approval.companyId,
          type: approval.type,
          status: approval.status,
          requestedByAgentId: null,
          requestedByUserId: approval.requestedByUserId,
          payload: approval.payload,
          decisionNote: approval.decisionNote,
          decidedByUserId: approval.decidedByUserId,
          decidedAt: approval.decidedAt,
          updatedAt: approval.updatedAt,
        });
        await activeDb.insert(issueApprovals).values({
          companyId: approval.companyId,
          issueId: approval.issueId,
          approvalId: approval.id,
          linkedByAgentId: null,
          linkedByUserId: null,
        });
        return approval;
      },

      insertIssueComment: async (comment) => {
        await activeDb.insert(issueComments).values({
          id: comment.id,
          companyId: comment.companyId,
          issueId: comment.issueId,
          authorAgentId: null,
          authorUserId: null,
          authorType: "system",
          body: comment.body,
          createdAt: comment.createdAt,
        });
        return comment;
      },
    };
  }

  const baseOperations = operations(db);
  return {
    ...baseOperations,
    withCompanyLock: async <T>(
      companyId: string,
      operation: (store: LegacyApprovalImportOperations) => Promise<T>,
    ): Promise<T> =>
      db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext('paperclip:legacy-approval-import'), hashtext(${companyId}))`,
        );
        return operation(operations(tx));
      }),
  };
}
