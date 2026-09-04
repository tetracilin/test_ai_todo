import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { externalObjects, issueAttachments, issueEvidenceLinks, issues } from "@paperclipai/db";
import { notFound, unprocessable } from "../errors.js";
import type { EvidenceSource } from "./evidence-provenance.js";

export type { EvidenceSource };

/** PC-011 AC2's numerator value. Declared once so no writer spells it inline. */
const BOT_SOURCE: EvidenceSource = "bot";

interface ExistingObjectTarget {
  externalObjectId: string;
}

export interface NewObjectTarget {
  providerKey: string;
  objectType: string;
  externalId: string;
  displayTitle?: string | null;
  /**
   * Set for link-shaped providers (`teable` row URLs, `git` commit URLs).
   * Left null for provider `nas`, which records a PATH REFERENCE ONLY -- no
   * bytes ever leave the NAS (PC-007 AC3, AD-021/C16). This service never
   * touches the storage plane for either.
   */
  url?: string | null;
  /**
   * Provider-specific metadata (F-007-2/3/4): sha256/objectKey/byteSize for
   * `minio`, verified host/repo for `git`. Stored as-is in `external_objects.data`.
   * Left unset for providers with nothing to record.
   */
  data?: Record<string, unknown> | null;
}

/** Either an external object that already exists, or the descriptor of a static evidence row. */
export type EvidenceLinkTarget = ExistingObjectTarget | NewObjectTarget;

/**
 * PC-007 AC7 "static evidence rows must sit cleanly in the external_objects
 * refresh machinery (liveness=unknown, no resolver-error spam)".
 *
 * Evidence objects are records of something that already happened (a Teable
 * row, a NAS path, a commit) -- there is no resolver for them and nothing to
 * poll. Each field below is load-bearing:
 *   - `nextRefreshAt: null`   -- `refreshDueObjectsUnchecked` selects on
 *     `next_refresh_at <= now`, so a NULL is never due. This alone keeps the
 *     sweeper away, and is the only exclusion this insert may claim.
 *   - `liveness` left at its 'unknown' default -- `visibleLiveness` only
 *     rewrites 'fresh' -> 'stale', so 'unknown' is stable and renders as a
 *     neutral pill with no error state.
 * The row is NOT created via `upsertObjectFromDetection`, which
 * unconditionally sets `nextRefreshAt: now` and would re-arm the sweeper.
 *
 * `isTerminal` is deliberately LEFT AT ITS DEFAULT (false). It used to be set
 * true here, which was a company-wide correctness bug: the descriptor branch
 * can claim a (company, provider, objectType, externalId) identity that a
 * real detector also produces -- GitHub external ids are human-readable and
 * reproducible ("acme/app#pull/42", `externalIdFor` in
 * github-external-object-provider.ts), and the route validates providerKey
 * only against a lowercase-slug regex. Filing such a PR as evidence created a
 * terminal row; a later paste of the same URL took the
 * `upsertObjectFromDetection` ON CONFLICT branch, which re-arms
 * `nextRefreshAt` but never clears `isTerminal`, and nothing else in the repo
 * clears it either -- so `refreshDueObjectsUnchecked`'s
 * `is_terminal = false` filter excluded that object from status refresh
 * forever, on every card in the company, with no error to notice it by.
 * `nextRefreshAt: null` gives the same "never polled" behaviour for evidence
 * that stays evidence, while letting a resolver legitimately take ownership
 * of the row if the same artifact later shows up through detection.
 */
const STATIC_EVIDENCE_OBJECT_DEFAULTS = {
  nextRefreshAt: null,
} as const;

/**
 * Create-or-reuse the static `external_objects` row a `NewObjectTarget`
 * describes, WITHOUT touching `issue_evidence_links`. Exported so a provider
 * that must write to external storage before it can call `link()` can create
 * the row as its own step, ahead of and separate from the link write --
 * F-007-2's MinIO upload does this deliberately, so a failure between the
 * storage write and the link insert leaves a row the GC sweep
 * (`evidence-storage-reaper.ts`) can find and reclaim, rather than leaving no
 * record of the stored blob at all. `link()`'s own NewObjectTarget path below
 * calls this same function inside its transaction for every other provider,
 * where that failure mode does not apply.
 */
export async function createOrReuseEvidenceObject(
  dbOrTx: Pick<Db, "insert">,
  companyId: string,
  target: NewObjectTarget,
): Promise<typeof externalObjects.$inferSelect> {
  const now = new Date();
  const [object] = await dbOrTx
    .insert(externalObjects)
    .values({
      companyId,
      providerKey: target.providerKey,
      objectType: target.objectType,
      externalId: target.externalId,
      displayTitle: target.displayTitle ?? target.url ?? target.externalId,
      sanitizedCanonicalUrl: target.url ?? null,
      data: target.data ?? {},
      ...STATIC_EVIDENCE_OBJECT_DEFAULTS,
    })
    .onConflictDoUpdate({
      target: [
        externalObjects.companyId,
        externalObjects.providerKey,
        externalObjects.objectType,
        externalObjects.externalId,
      ],
      set: { updatedAt: now },
    })
    .returning();
  return object as typeof externalObjects.$inferSelect;
}

/**
 * The audit write for one evidence mutation, run INSIDE the service's own
 * transaction (PC-007 AC6: "never a silent deletion").
 *
 * Every caller of `link` / `unlink` / `move` must pass one. `logActivity`
 * itself touches the DB three times (`redactActivityDetails`,
 * `resolveResponsibleUserIdForActivity`, and an insert carrying `runId`, an FK
 * to `heartbeat_runs.id` that retention can prune), so it can fail. Run after
 * the commit, that failure orphans the mutation: the link row is already gone
 * (or already written) with no `activity_log` entry, and PC-002's dossier
 * correction line -- which is rendered from these entries -- can never be
 * written. Run inside the transaction, a failed audit entry rolls the mutation
 * back instead, which is exactly what the PC-001 evidence gate does with
 * `issue.evidence_gate.closed` (`logActivity(tx as unknown as Db, ...)` in
 * services/issues.ts). It also removes the retry hole on `link`: because the
 * row and its entry commit together, a retry that returns `created: false`
 * proves a committed entry already exists.
 */
export type EvidenceAuditWriter<TResult> = (tx: Db, result: TResult) => Promise<void>;

/** One issue, as locked and read by the write paths below. */
interface LockedIssue {
  id: string;
  companyId: string;
  identifier: string | null;
}

export interface EvidenceLinkResult {
  link: IssueEvidenceLinkRow;
  /** False when the same object was already filed against this issue. */
  created: boolean;
}

export interface EvidenceMoveResult {
  /** The surviving link row on the destination card. */
  link: IssueEvidenceLinkRow;
  fromIssue: LockedIssue;
  toIssue: LockedIssue;
  merged: boolean;
  /**
   * The provenance of the filing act that was MOVED, which on a merge is not
   * the same as `link.source` (the surviving row's). Both go on the audit
   * entry so a correction can never misreport who filed what.
   */
  movedSource: EvidenceSource;
}

/** One filing act joined to the artifact it points at. */
export interface IssueEvidenceLinkRow {
  id: string;
  companyId: string;
  issueId: string;
  externalObjectId: string;
  source: EvidenceSource;
  createdAt: Date;
  providerKey: string;
  objectType: string;
  externalId: string;
  displayTitle: string | null;
  sanitizedCanonicalUrl: string | null;
  liveness: string;
  statusCategory: string;
  statusTone: string;
  isTerminal: boolean;
}

/** The two filing tables the PC-001 gate sums, reported separately and together. */
export interface IssueEvidenceCounts {
  attachmentCount: number;
  evidenceLinkCount: number;
  total: number;
}

/**
 * Anything that can run a select: the module-level `Db`, or a caller's open
 * transaction. The PC-001 gate counts under the same `FOR UPDATE` lock as the
 * status write, so it must be able to hand its own `tx` in.
 */
type EvidenceCountReader = Pick<Db, "select">;

/**
 * THE evidence predicate. Five consumers ask "does this card have evidence, and
 * how much": the PC-001 done-gate, the PC-011 AC3 wedge ratio, the re-brief
 * verb's evidence gaps, the PM digest's blocked-card list, and the PC-006
 * WP-close export's evidence index. Written five times it drifts, and a digest
 * that disagrees with the export about the same card is worse than either being
 * wrong on its own -- so it is written once, here.
 *
 * Evidence is BOTH filing tables: `issue_attachments` (an uploaded file) plus
 * `issue_evidence_links` (a link to an external object). Counting only links
 * would report 0 on a card whose sole evidence is an uploaded photo -- a card
 * the gate closes happily. Both counts are company-scoped, exactly as the gate
 * scopes them: an issue id alone must never let one company's rows be counted
 * against another's card.
 */
export async function countEvidenceForIssue(
  dbOrTx: EvidenceCountReader,
  { companyId, issueId }: { companyId: string; issueId: string },
): Promise<IssueEvidenceCounts> {
  const [[attachments], [links]] = await Promise.all([
    dbOrTx
      .select({ count: sql<number>`count(*)::int` })
      .from(issueAttachments)
      .where(and(eq(issueAttachments.companyId, companyId), eq(issueAttachments.issueId, issueId))),
    dbOrTx
      .select({ count: sql<number>`count(*)::int` })
      .from(issueEvidenceLinks)
      .where(and(eq(issueEvidenceLinks.companyId, companyId), eq(issueEvidenceLinks.issueId, issueId))),
  ]);
  const attachmentCount = attachments?.count ?? 0;
  const evidenceLinkCount = links?.count ?? 0;
  return { attachmentCount, evidenceLinkCount, total: attachmentCount + evidenceLinkCount };
}

/**
 * Evidence-link write path (PC-007 AC7).
 *
 * The only issue<->external_object linkage that existed before this story was
 * `external_object_mentions`, a text-detection table whose `objectId` is
 * nullable with `onDelete: SET NULL` and whose rows are wholesale deleted and
 * re-inserted on every text sync. Dangling/ephemeral rows must never satisfy
 * the PC-001 gate, so evidence is a first-class `issue_evidence_links` row
 * (mechanism decided at gate T3, 2026-09-02) and this service is its only
 * writer.
 *
 * Deliberately NOT routed through `externalObjectService`: that service is
 * gated by the instance experimental flag `enableExternalObjects` (default
 * off) and its read surface is mention-based, so evidence filed through it
 * would be both disabled and invisible on a stock instance.
 */
export function issueEvidenceLinkService(db: Db) {
  const evidenceLinkColumns = {
    id: issueEvidenceLinks.id,
    companyId: issueEvidenceLinks.companyId,
    issueId: issueEvidenceLinks.issueId,
    externalObjectId: issueEvidenceLinks.externalObjectId,
    source: issueEvidenceLinks.source,
    createdAt: issueEvidenceLinks.createdAt,
    providerKey: externalObjects.providerKey,
    objectType: externalObjects.objectType,
    externalId: externalObjects.externalId,
    displayTitle: externalObjects.displayTitle,
    sanitizedCanonicalUrl: externalObjects.sanitizedCanonicalUrl,
    liveness: externalObjects.liveness,
    statusCategory: externalObjects.statusCategory,
    statusTone: externalObjects.statusTone,
    isTerminal: externalObjects.isTerminal,
  };

  async function getIssue(issueId: string, dbOrTx: any = db) {
    return dbOrTx
      .select({ id: issues.id, companyId: issues.companyId, identifier: issues.identifier })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows: Array<{ id: string; companyId: string; identifier: string | null }>) => rows[0] ?? null);
  }

  /**
   * Locks the issue rows this write touches, in a deterministic order.
   *
   * The PC-001 gate reads the evidence count under `FOR UPDATE` on the issue
   * row inside the same transaction as the status write. Taking the same lock
   * here means a link/unlink/move can never interleave with a `done`
   * transition (PC-001 AC8 / PC-007 AC6). It is NOT what makes `link`
   * single-filing -- the unique index on (issue_id, external_object_id) is;
   * see the upsert below. Sorting the ids keeps the two-issue `move` from
   * deadlocking against a mirrored concurrent move.
   */
  async function lockIssues(tx: any, issueIds: string[]): Promise<LockedIssue[]> {
    const ordered = Array.from(new Set(issueIds)).sort();
    return tx
      .select({ id: issues.id, companyId: issues.companyId, identifier: issues.identifier })
      .from(issues)
      .where(inArray(issues.id, ordered))
      .orderBy(issues.id)
      .for("update")
      .then((rows: LockedIssue[]) => rows);
  }

  async function resolveEvidenceObject(tx: any, companyId: string, target: EvidenceLinkTarget) {
    if ("externalObjectId" in target) {
      const existing = await tx
        .select()
        .from(externalObjects)
        .where(eq(externalObjects.id, target.externalObjectId))
        .then((rows: Array<typeof externalObjects.$inferSelect>) => rows[0] ?? null);
      // Same 404 for missing and cross-tenant -- an evidence link must never
      // confirm that another company's object exists.
      if (!existing || existing.companyId !== companyId) throw notFound("External object not found");
      return existing;
    }

    // Find-or-create in one statement against the
    // (company_id, provider_key, object_type, external_id) unique index, so a
    // concurrent link of the same evidence cannot produce a duplicate object.
    // On conflict only `updatedAt` is touched: re-filing evidence that happens
    // to already exist as a live, resolver-owned object (a detected GitHub
    // URL, say) must not turn that object static.
    return createOrReuseEvidenceObject(tx, companyId, target);
  }

  async function readLink(dbOrTx: any, linkId: string): Promise<IssueEvidenceLinkRow | null> {
    return dbOrTx
      .select(evidenceLinkColumns)
      .from(issueEvidenceLinks)
      .innerJoin(externalObjects, eq(issueEvidenceLinks.externalObjectId, externalObjects.id))
      .where(eq(issueEvidenceLinks.id, linkId))
      .then((rows: IssueEvidenceLinkRow[]) => rows[0] ?? null);
  }

  /** The row was just written or just read under lock, so it is always present. */
  async function readLinkOrThrow(dbOrTx: any, linkId: string): Promise<IssueEvidenceLinkRow> {
    const link = await readLink(dbOrTx, linkId);
    if (!link) throw notFound("Evidence link not found");
    return link;
  }

  return {
    /**
     * Evidence-linked objects are invisible on the existing external-object
     * surface (`listForIssue` reads mention rows), so this is the read side of
     * the evidence record -- and the list the correction path (AC6) unlinks
     * from.
     */
    listForIssue: async (issueId: string) => {
      const issue = await getIssue(issueId);
      if (!issue) throw notFound("Issue not found");
      return db
        .select(evidenceLinkColumns)
        .from(issueEvidenceLinks)
        .innerJoin(externalObjects, eq(issueEvidenceLinks.externalObjectId, externalObjects.id))
        .where(eq(issueEvidenceLinks.issueId, issueId))
        .orderBy(desc(issueEvidenceLinks.createdAt));
    },

    /**
     * Files one evidence artifact against an issue. `source` is PC-011 AC2
     * provenance for this filing act. It is stated explicitly by the caller and
     * never read off the request body -- a client must not be able to inflate
     * the `wp0_evidence_via_bot` wedge metric. Nor is it inferred from the
     * actor: the HTTP route passes a constant (`HTTP_EVIDENCE_SOURCE` in
     * routes/issues.ts, which explains why the actor class is the wrong
     * discriminator), and only a producer that knows it is the WP-0 chat bot
     * passes "bot".
     *
     * Idempotent: re-filing the same object on the same issue returns the
     * existing link rather than a second row, so a retried chat message cannot
     * manufacture evidence count.
     *
     * `writeAudit` runs inside this transaction (see `EvidenceAuditWriter`); it
     * is invoked for the idempotent path too, and the caller decides whether
     * that path warrants an entry.
     */
    link: async (
      issueId: string,
      target: EvidenceLinkTarget,
      source: EvidenceSource,
      writeAudit: EvidenceAuditWriter<EvidenceLinkResult>,
    ): Promise<EvidenceLinkResult> => {
      return db.transaction(async (tx) => {
        const [issue] = await lockIssues(tx, [issueId]);
        if (!issue) throw notFound("Issue not found");

        const object = await resolveEvidenceObject(tx, issue.companyId, target);

        // Idempotent by CONSTRAINT, not by check-then-insert. The old read of
        // the pair before inserting leaned on the issue row lock above to
        // serialize concurrent links; a lock that is taken for a different
        // reason (PC-001 AC8) is the wrong thing to hang single-filing on, and
        // any writer that reaches this table down a path without that lock
        // double-counts -- inflating both the gate count and the PC-011 wedge
        // ratio with one artifact filed twice. Instead both racers reach the
        // insert and the unique index on (issue_id, external_object_id) lets
        // exactly one win; the loser gets no row back, re-reads the survivor
        // and answers `created: false`. One row, two successful responses.
        const [inserted] = await tx
          .insert(issueEvidenceLinks)
          .values({
            companyId: issue.companyId,
            issueId,
            externalObjectId: object.id,
            source,
          })
          .onConflictDoNothing({
            target: [issueEvidenceLinks.issueId, issueEvidenceLinks.externalObjectId],
          })
          .returning({ id: issueEvidenceLinks.id });

        if (inserted) {
          const result = { link: await readLinkOrThrow(tx, inserted.id), created: true };
          await writeAudit(tx as unknown as Db, result);
          return result;
        }

        // DO NOTHING waits out an uncommitted conflicting insert, so by the
        // time we get here the survivor is committed and visible to this
        // statement's snapshot.
        const existing = await tx
          .select({ id: issueEvidenceLinks.id })
          .from(issueEvidenceLinks)
          .where(
            and(
              eq(issueEvidenceLinks.issueId, issueId),
              eq(issueEvidenceLinks.externalObjectId, object.id),
            ),
          )
          .then((rows: Array<{ id: string }>) => rows[0] ?? null);
        if (!existing) throw notFound("Evidence link not found");
        const result = { link: await readLinkOrThrow(tx, existing.id), created: false };
        await writeAudit(tx as unknown as Db, result);
        return result;
      });
    },

    /**
     * PC-007 AC6 correction path. `writeAudit` is run inside the same
     * transaction as the delete, so the entry that makes this a recorded
     * correction cannot be lost after the row is already gone -- the deletion
     * is never silent, structurally rather than procedurally.
     */
    unlink: async (
      issueId: string,
      linkId: string,
      writeAudit: EvidenceAuditWriter<IssueEvidenceLinkRow>,
    ): Promise<IssueEvidenceLinkRow> => {
      return db.transaction(async (tx) => {
        const [issue] = await lockIssues(tx, [issueId]);
        if (!issue) throw notFound("Issue not found");

        const link = await readLink(tx, linkId);
        if (!link || link.issueId !== issueId) throw notFound("Evidence link not found");

        await tx.delete(issueEvidenceLinks).where(eq(issueEvidenceLinks.id, linkId));
        await writeAudit(tx as unknown as Db, link);
        return link;
      });
    },

    /**
     * PC-007 AC6 "a moved link records where it went": mis-filed evidence is
     * re-parented to the correct card rather than deleted and re-created, so
     * the filing act keeps its original `source` provenance (PC-011 AC1 -- the
     * act did not change, only the card it was filed against).
     *
     * If the destination already carries the same object the moved row is
     * folded into it (`merged`), which the caller records on the activity_log
     * entry so the correction still reads as a move, not a disappearance.
     *
     * A merge destroys one of the two filing acts, so n drops by 1 and the
     * PC-011 AC3 ratio necessarily moves. Which way it moves is a DECISION, and
     * it is settled the same way every other provenance question on this branch
     * is: never over-count `bot`. See HTTP_EVIDENCE_SOURCE (routes/issues.ts)
     * and `otherCount` (services/evidence-provenance.ts) -- both deliberately
     * bias the wedge metric DOWN, because a pilot that looks worse than it is
     * gets investigated and one that looks better than it is does not.
     * So the survivor keeps the WEAKER of the two provenances: if either row
     * was non-bot, the merged row is non-bot. Checked over the four cases, that
     * makes a merge either leave the ratio alone (bot+bot, manual+manual) or
     * lower it (bot+manual either way round); it can never raise it. The
     * opposite rule -- "keep the stronger" -- reads as the fairer one but turns
     * every mixed merge into a ratio increase (0.5 -> 1.0), which would let a
     * routine AC6 correction push the band toward `pass`.
     * Nothing is lost from the record: the destroyed act's provenance is
     * reported as `movedSource` on the audit entry, which is what PC-002's
     * dossier correction line renders.
     *
     * `writeAudit` runs inside this transaction (see `EvidenceAuditWriter`).
     */
    move: async (
      issueId: string,
      linkId: string,
      targetIssueId: string,
      writeAudit: EvidenceAuditWriter<EvidenceMoveResult>,
    ): Promise<EvidenceMoveResult> => {
      if (targetIssueId === issueId) {
        throw unprocessable("Evidence link is already filed against this issue");
      }
      return db.transaction(async (tx) => {
        const locked = await lockIssues(tx, [issueId, targetIssueId]);
        const issue = locked.find((row) => row.id === issueId);
        if (!issue) throw notFound("Issue not found");
        const targetIssue = locked.find((row) => row.id === targetIssueId);
        if (!targetIssue) throw notFound("Target issue not found");
        if (targetIssue.companyId !== issue.companyId) {
          throw unprocessable("Evidence can only be moved between issues in the same company");
        }

        const link = await readLink(tx, linkId);
        if (!link || link.issueId !== issueId) throw notFound("Evidence link not found");
        const externalObjectId = link.externalObjectId;

        const alreadyOnTarget = await tx
          .select({ id: issueEvidenceLinks.id, source: issueEvidenceLinks.source })
          .from(issueEvidenceLinks)
          .where(
            and(
              eq(issueEvidenceLinks.issueId, targetIssueId),
              eq(issueEvidenceLinks.externalObjectId, externalObjectId),
            ),
          )
          .then((rows: Array<{ id: string; source: EvidenceSource }>) => rows[0] ?? null);

        if (alreadyOnTarget) {
          await tx.delete(issueEvidenceLinks).where(eq(issueEvidenceLinks.id, linkId));
          // The moved filing act disappears from the metric. The survivor keeps
          // the WEAKER provenance so the merge can never raise the bot ratio
          // (see the docblock): a bot-filed destination that absorbs a non-bot
          // act is written down to that act's own source -- a real recorded
          // value, not an invented 'manual'.
          if (alreadyOnTarget.source === BOT_SOURCE && link.source !== BOT_SOURCE) {
            await tx
              .update(issueEvidenceLinks)
              .set({ source: link.source })
              .where(eq(issueEvidenceLinks.id, alreadyOnTarget.id));
          }
          const result: EvidenceMoveResult = {
            link: await readLinkOrThrow(tx, alreadyOnTarget.id),
            fromIssue: issue,
            toIssue: targetIssue,
            merged: true,
            movedSource: link.source,
          };
          await writeAudit(tx as unknown as Db, result);
          return result;
        }

        await tx
          .update(issueEvidenceLinks)
          .set({ issueId: targetIssueId })
          .where(eq(issueEvidenceLinks.id, linkId));
        const result: EvidenceMoveResult = {
          link: await readLinkOrThrow(tx, linkId),
          fromIssue: issue,
          toIssue: targetIssue,
          merged: false,
          movedSource: link.source,
        };
        await writeAudit(tx as unknown as Db, result);
        return result;
      });
    },

    /**
     * Total evidence artifact count for one issue, for callers that hold only
     * an issue id. The company scope comes off the issue row, so this cannot
     * disagree with `countEvidenceForIssue` -- it IS that function.
     */
    countForIssue: async (issueId: string) => {
      const issue = await getIssue(issueId);
      if (!issue) return 0;
      const { total } = await countEvidenceForIssue(db, { companyId: issue.companyId, issueId });
      return total;
    },
  };
}
