import { createHash } from "node:crypto";
import { and, asc, eq, gte, isNull, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  authUsers,
  commentIntakeCheckpoints,
  commentIntakeRuns,
  commentIntakeSources,
  developmentCommentIntakes,
  issueComments,
  issues,
} from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { redactSensitiveText } from "../redaction.js";
import { issueService } from "./issues.js";
import { commentIntakeDedupeKey, parseCommentIntakeText } from "./comment-intake-text.js";

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const OVERLAP_MS = 5 * 60 * 1000;
const MAX_PAGE_SIZE = 100;
const SAFE_ERROR_CODES = new Set(["database_error", "unexpected_error"]);

type Source = typeof commentIntakeSources.$inferSelect;

function fingerprint(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeErrorCode(error: unknown) {
  const code = typeof error === "object" && error && "code" in error && typeof error.code === "string"
    ? error.code
    : "unexpected_error";
  return SAFE_ERROR_CODES.has(code) ? code : "unexpected_error";
}

function safeErrorDetail(error: unknown) {
  const name = error instanceof Error ? error.name : "Error";
  return name.slice(0, 120);
}

function backlogDescription(input: { sourceIssueId: string; sourceCreatedAt: Date; kind: string; requestBody: string }) {
  return [
    "Feedback imported from a verified human issue comment.",
    `Source issue ID: ${input.sourceIssueId}`,
    `Source timestamp: ${input.sourceCreatedAt.toISOString()}`,
    `Category: ${input.kind}`,
    "",
    input.requestBody,
  ].join("\n");
}

/** Durable V1 poller for verified-human `issue_comments`. */
export function commentIntakeService(db: Db) {
  async function runSource(source: Source, now = new Date()) {
    if (source.providerKey !== "paperclip" || source.objectType !== "issue_comment" || source.sourceScopeId !== source.companyId) {
      return { sourceId: source.id, skipped: "unsupported_source" as const };
    }

    const checkpoint = await db.select().from(commentIntakeCheckpoints)
      .where(eq(commentIntakeCheckpoints.sourceId, source.id)).then((rows) => rows[0] ?? null);
    if (checkpoint?.lastAttemptAt && now.getTime() - checkpoint.lastAttemptAt.getTime() < POLL_INTERVAL_MS) {
      return { sourceId: source.id, skipped: "not_due" as const };
    }

    const [run] = await db.insert(commentIntakeRuns).values({
      companyId: source.companyId,
      sourceId: source.id,
      status: "running",
    }).returning();

    try {
      const result = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`comment-intake:${source.id}`}, 0))`);
        const current = await tx.select().from(commentIntakeCheckpoints)
          .where(eq(commentIntakeCheckpoints.sourceId, source.id)).then((rows) => rows[0] ?? null);
        // Two-part resume inside the fixed `createdAt ASC, id ASC` scan order:
        //
        // 1. New work strictly after the last processed row (durable keyset).
        //    A comment inserted during a prior tick's read has
        //    `createdAt > watermark` (insert time always beats the previous
        //    snapshot), so this never skips it, and it keeps the scan
        //    progressing even when more than a page of candidates falls inside
        //    a single poll window (a pure overlap replay would re-read the
        //    same oldest page forever).
        // 2. A bounded 5-minute replay window at-or-before the watermark so an
        //    *edited* source comment is re-read even though its keyset position
        //    does not move — edits surface as sourceChanged and transition the
        //    intake to `triaged` (contract §4). Unchanged replays are no-ops
        //    thanks to the SHA-256 identity key.
        const watermarkAt = current?.highWatermarkOccurredAt;
        const watermarkId = current?.highWatermarkId ?? null;
        const newWorkAfter = watermarkAt && watermarkId
          ? sql`(${issueComments.createdAt}, ${issueComments.id}) > (${watermarkAt.toISOString()}::timestamptz, ${watermarkId}::uuid)`
          : undefined;
        const replayFrom = watermarkAt
          ? new Date(watermarkAt.getTime() - OVERLAP_MS)
          : null;
        const replayWindow = replayFrom && watermarkAt && watermarkId
          ? and(
              gte(issueComments.createdAt, replayFrom),
              sql`(${issueComments.createdAt}, ${issueComments.id}) <= (${watermarkAt.toISOString()}::timestamptz, ${watermarkId}::uuid)`,
            )
          : undefined;

        const selectComments = (bound: ReturnType<typeof and> | undefined) =>
          tx.select({
            id: issueComments.id,
            issueId: issueComments.issueId,
            authorUserId: issueComments.authorUserId,
            body: issueComments.body,
            createdAt: issueComments.createdAt,
            updatedAt: issueComments.updatedAt,
          })
            .from(issueComments)
            .innerJoin(authUsers, eq(authUsers.id, issueComments.authorUserId))
            .innerJoin(issues, and(eq(issues.id, issueComments.issueId), eq(issues.companyId, source.companyId)))
            .where(and(
              eq(issueComments.companyId, source.companyId),
              isNull(issueComments.authorAgentId),
              isNull(issueComments.deletedAt),
              bound,
            ))
            .orderBy(asc(issueComments.createdAt), asc(issueComments.id))
            .limit(MAX_PAGE_SIZE);

        // Replays run first so new-work candidates are counted/created last and
        // become the watermark; replay rows always sit at-or-before the
        // previous watermark and can never advance it.
        const freshComments = await selectComments(newWorkAfter);
        const replayComments = replayWindow ? await selectComments(replayWindow) : [];
        const comments = [...replayComments, ...freshComments];

        let candidateCount = 0;
        let createdCount = 0;
        let updatedCount = 0;
        let duplicateCount = 0;
        let rejectedCount = 0;
        let partial = false;
        for (const comment of comments) {
          const parsed = parseCommentIntakeText(comment.body);
          if (!parsed) continue;
          candidateCount += 1;
          const dedupeKey = commentIntakeDedupeKey({
            companyId: source.companyId,
            providerKey: source.providerKey,
            objectType: source.objectType,
            sourceScopeId: source.sourceScopeId,
            sourceCommentId: comment.id,
          });
          const sensitiveBody = redactSensitiveText(parsed.requestBody);
          const rejected = !parsed.requestBody || sensitiveBody !== parsed.requestBody;
          const [existing] = await tx.select().from(developmentCommentIntakes)
            .where(and(eq(developmentCommentIntakes.companyId, source.companyId), eq(developmentCommentIntakes.dedupeKey, dedupeKey)))
            .limit(1);
          const baseValues = {
            sourceCommentId: comment.id,
            sourceIssueId: comment.issueId,
            sourceAuthorUserId: comment.authorUserId,
            sourceCreatedAt: comment.createdAt,
            sourceUpdatedAt: comment.updatedAt,
            sourceUrl: null,
            tag: source.tag,
            tagPositions: parsed.tagPositions,
            kind: parsed.kind,
            subject: rejected ? "Development feedback" : parsed.subject,
            requestBody: rejected ? null : parsed.requestBody,
            contentFingerprint: fingerprint(parsed.visibleText),
            updatedAt: now,
          };
          if (existing) {
            const sourceChanged =
              existing.contentFingerprint !== baseValues.contentFingerprint
              || existing.sourceUpdatedAt.getTime() !== comment.updatedAt.getTime();
            // Stalled-intake recovery (contract §6, acceptance #6): the
            // previous tick inserted this intake row but crashed before its
            // backlog issue was created (`intake_status = "new"`, no backlog
            // link). Resume the create now — the stable
            // `comment-intake:<intakeId>:v1` idempotency key makes the resume
            // safe against double-creation if the process dies again mid-create.
            if (!rejected && existing.intakeStatus === "new" && !existing.backlogIssueId) {
              if (sourceChanged) {
                // The source was edited before the backlog landed; persist the
                // latest content so the create reflects current text.
                await tx.update(developmentCommentIntakes).set({
                  ...baseValues,
                  intakeStatus: "new",
                  dismissedReasonCode: null,
                  redactedAt: null,
                }).where(eq(developmentCommentIntakes.id, existing.id));
              }
              let deduplicated = false;
              const backlog = await issueService(tx as unknown as Db).create(source.companyId, {
                title: `[${parsed.kind}] ${parsed.subject}`,
                description: backlogDescription({
                  sourceIssueId: comment.issueId,
                  sourceCreatedAt: comment.createdAt,
                  kind: parsed.kind,
                  requestBody: parsed.requestBody,
                }),
                status: "backlog",
                originKind: "comment_intake",
                originId: existing.id,
                idempotencyKey: `comment-intake:${existing.id}:v1`,
                onDeduplicated: () => { deduplicated = true; },
              });
              await tx.update(developmentCommentIntakes).set({
                backlogIssueId: backlog.id,
                backlogStatusSnapshot: backlog.status,
                backlogUpdatedAt: backlog.updatedAt,
                intakeStatus: deduplicated ? "duplicate" : "backlog_created",
                updatedAt: now,
              }).where(eq(developmentCommentIntakes.id, existing.id));
              if (deduplicated) duplicateCount += 1;
              else createdCount += 1;
              continue;
            }
            duplicateCount += 1;
            // A normal overlap replays unchanged source rows. It must remain a
            // no-op: only an edited source with already-created work requires
            // triage instead of silently replacing backlog content.
            if (!sourceChanged) continue;
            const shouldTriaged = !!existing.backlogIssueId && existing.intakeStatus === "backlog_created";
            await tx.update(developmentCommentIntakes).set({
              ...baseValues,
              intakeStatus: rejected ? "redacted" : shouldTriaged ? "triaged" : existing.intakeStatus,
              dismissedReasonCode: rejected ? "secret_detected" : null,
              redactedAt: rejected ? now : existing.redactedAt,
            }).where(eq(developmentCommentIntakes.id, existing.id));
            if (rejected) {
              rejectedCount += 1;
              partial = true;
            }
            else updatedCount += 1;
            continue;
          }

          const [intake] = await tx.insert(developmentCommentIntakes).values({
            companyId: source.companyId,
            sourceId: source.id,
            dedupeKey,
            intakeStatus: rejected ? "redacted" : "new",
            dismissedReasonCode: rejected ? "secret_detected" : null,
            redactedAt: rejected ? now : null,
            ...baseValues,
          }).returning();
          if (rejected) {
            rejectedCount += 1;
            partial = true;
            continue;
          }
          let deduplicated = false;
          const backlog = await issueService(tx as unknown as Db).create(source.companyId, {
            title: `[${parsed.kind}] ${parsed.subject}`,
            description: backlogDescription({
              sourceIssueId: comment.issueId,
              sourceCreatedAt: comment.createdAt,
              kind: parsed.kind,
              requestBody: parsed.requestBody,
            }),
            status: "backlog",
            originKind: "comment_intake",
            originId: intake.id,
            idempotencyKey: `comment-intake:${intake.id}:v1`,
            onDeduplicated: () => { deduplicated = true; },
          });
          await tx.update(developmentCommentIntakes).set({
            backlogIssueId: backlog.id,
            backlogStatusSnapshot: backlog.status,
            backlogUpdatedAt: backlog.updatedAt,
            intakeStatus: deduplicated ? "duplicate" : "backlog_created",
            updatedAt: now,
          }).where(eq(developmentCommentIntakes.id, intake.id));
          if (deduplicated) duplicateCount += 1;
          else createdCount += 1;
        }

        const last = freshComments.at(-1);
        await tx.insert(commentIntakeCheckpoints).values({
          sourceId: source.id,
          cursor: last?.id ?? current?.cursor ?? null,
          highWatermarkOccurredAt: last?.createdAt ?? current?.highWatermarkOccurredAt ?? null,
          highWatermarkId: last?.id ?? current?.highWatermarkId ?? null,
          lastAttemptAt: now,
          lastSuccessAt: now,
          consecutiveFailureCount: 0,
          lastErrorCode: null,
          updatedAt: now,
        }).onConflictDoUpdate({
          target: commentIntakeCheckpoints.sourceId,
          set: {
            cursor: last?.id ?? current?.cursor ?? null,
            highWatermarkOccurredAt: last?.createdAt ?? current?.highWatermarkOccurredAt ?? null,
            highWatermarkId: last?.id ?? current?.highWatermarkId ?? null,
            lastAttemptAt: now,
            lastSuccessAt: now,
            consecutiveFailureCount: 0,
            lastErrorCode: null,
            updatedAt: now,
          },
        });
        return { pageCount: comments.length ? 1 : 0, candidateCount, createdCount, updatedCount, duplicateCount, rejectedCount, status: partial ? "partial" : "succeeded" };
      });
      await db.update(commentIntakeRuns).set({ ...result, finishedAt: now }).where(eq(commentIntakeRuns.id, run.id));
      return { sourceId: source.id, ...result };
    } catch (error) {
      const errorCode = safeErrorCode(error);
      await db.transaction(async (tx) => {
        await tx.insert(commentIntakeCheckpoints).values({ sourceId: source.id, lastAttemptAt: now, consecutiveFailureCount: 1, lastErrorCode: errorCode, updatedAt: now })
          .onConflictDoUpdate({
            target: commentIntakeCheckpoints.sourceId,
            set: {
              lastAttemptAt: now,
              consecutiveFailureCount: sql`${commentIntakeCheckpoints.consecutiveFailureCount} + 1`,
              lastErrorCode: errorCode,
              updatedAt: now,
            },
          });
        await tx.update(commentIntakeRuns).set({ status: "failed", finishedAt: now, errorCode, errorDetail: safeErrorDetail(error) })
          .where(eq(commentIntakeRuns.id, run.id));
      });
      logger.error({ sourceId: source.id, companyId: source.companyId, errorCode }, "comment intake source poll failed");
      return { sourceId: source.id, failed: true as const, errorCode };
    }
  }

  async function runDue(now = new Date()) {
    const sources = await db.select().from(commentIntakeSources).where(and(
      eq(commentIntakeSources.enabled, true),
      eq(commentIntakeSources.providerKey, "paperclip"),
      eq(commentIntakeSources.objectType, "issue_comment"),
    ));
    return Promise.all(sources.map((source) => runSource(source, now)));
  }

  return { runSource, runDue };
}