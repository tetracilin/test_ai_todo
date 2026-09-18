import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { activityLog, companies, externalObjects, issueEvidenceLinks, issues } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { logActivity } from "./activity-log.js";
import { secretService } from "./secrets.js";
import { issueEvidenceLinkService, type EvidenceSource, type NewObjectTarget } from "./issue-evidence-links.js";
import { TEABLE_BOT_ACCOUNT_SECRET_NAME, isPaperclipBotAuthored } from "./teable-append.js";
import {
  createTeableClient,
  teableError,
  type TeableClient,
  type TeableError,
  type TeableRecord,
  type TeableSecretsDeps,
} from "./teable-client.js";

/**
 * Card -> Teable mirror cron (F-005-1, story PC-005).
 *
 * One-directional, Paperclip -> Teable, of exactly the fields PC-005 AC1 names
 * (card create + status + assignee), into the ONE table this company has
 * allowlisted for the mirror (base "Tecotec CN" in production). It is a
 * SEPARATE pipeline from F-010-2's agent write (`teable-append.ts`): that one
 * is agent-initiated, append-only, and writes to whatever table an agent names
 * within its own allowlist; this one is cron-driven, owns exactly one row per
 * issue, and is the only writer expected to ever UPDATE that row.
 *
 * Division of labour with `teable-client.ts`: this module owns the cron loop,
 * the field mapping, the `external_objects`/`issue_evidence_links` linkage
 * (reusing `issue-evidence-links.ts`'s `NewObjectTarget` shape exactly as
 * `teable-append.ts` does), the conflict check, the `activity_log` writes, and
 * the retry-with-backoff scheduling. The client only ever sees one create or
 * one update call per tick per issue -- it never retries a write itself (see
 * its own docblock).
 *
 * State, WITHOUT a new table (K6 domain-map rule, backlog.md:40): the mirror
 * link is one `issue_evidence_links` row to one `external_objects` row per
 * issue, `providerKey: "teable"`, `objectType: TEABLE_MIRROR_OBJECT_TYPE` --
 * distinct from F-010-2's `objectType: "record"`, so the two pipelines' rows
 * never collide on the same (issue, object) identity and a sweep here never
 * mistakes an agent-authored evidence row for its own mirror row. Everything
 * this cron needs to remember between ticks (the last fields it wrote, the
 * remote `lastModifiedTime` it last observed, whether the row is currently
 * flagged as a conflict) lives in that `external_objects` row's own `data`
 * JSON column -- a column that already exists for exactly this purpose.
 * Retry-with-backoff state lives in `activity_log` itself: the most recent
 * consecutive run of `issue.teable_mirror_failed` entries for an issue IS the
 * failure streak: no counter column to keep in sync, and the backoff is
 * visible in the same place PC-005 AC4 already requires the failure to be
 * surfaced.
 *
 * Conflict handling (PC-005 AC3): before writing an update, and even when
 * nothing local changed, the mirror's row is periodically re-read
 * (`MIRROR_RECHECK_INTERVAL_MS`) and its `lastModifiedTime`/`lastModifiedBy`
 * compared against what this mirror itself last wrote. A remote edit this
 * mirror did not make is flagged as a conflict and the row is never
 * overwritten -- exactly PC-010 AC3's mechanism, reused rather than
 * reinvented. Bot-authored writes (this mirror's own, or PC-010's agent
 * writes) are excluded from that comparison via the SAME
 * `isPaperclipBotAuthored` predicate PC-010 exports from `teable-append.ts`
 * for exactly this purpose (F-010-2's own docblock names F-005-1 as the
 * intended consumer) -- this module does not re-derive that rule.
 */

/** Distinct from F-010-2's `objectType: "record"` -- see module docblock. */
export const TEABLE_MIRROR_PROVIDER_KEY = "teable";
export const TEABLE_MIRROR_OBJECT_TYPE = "issue_mirror";

/**
 * Per-company secret naming the ONE table the mirror writes to -- deliberately
 * separate from F-010-2's `TEABLE_WRITE_TABLE_SECRET_NAME`, because the two
 * pipelines can legitimately point at different tables (an agent's working
 * table vs. the PM-facing "Tecotec CN" board mirror).
 */
export const TEABLE_MIRROR_TABLE_SECRET_NAME = "TEABLE_MIRROR_TABLE_ID";

/** PC-011 gate UC-1: a cron-driven filing act is system-generated, neither a bot chat capture nor a human re-entry. */
const MIRROR_EVIDENCE_SOURCE: EvidenceSource = "system";

const MIRROR_ACTOR = { actorType: "system" as const, actorId: "teable-mirror" };

export const TEABLE_MIRROR_ACTIVITY_ACTIONS = {
  created: "issue.teable_mirror_created",
  updated: "issue.teable_mirror_updated",
  conflict: "issue.teable_mirror_conflict",
  failed: "issue.teable_mirror_failed",
} as const;

/**
 * How long a mirrored row is trusted without re-reading it from Teable when
 * nothing local changed. Bounds Teable API load from the conflict check --
 * without this, a sweep tick running every heartbeat interval would issue one
 * `getRecord` per mirrored issue every tick regardless of whether anything
 * happened. Comfortably inside PC-005 AC1's 5-minute propagation budget for
 * genuine changes, which always bypass this window (see `syncIssue`).
 */
const MIRROR_RECHECK_INTERVAL_MS = 2 * 60 * 1000;

/** Exponential backoff base/ceiling for a failing sync, keyed off the CONSECUTIVE `failed` streak in `activity_log`. */
const MIRROR_RETRY_BASE_SECONDS = 60;
const MIRROR_RETRY_MAX_SECONDS = 30 * 60;
/** How many recent activity_log rows to look at when measuring the failure streak. Caps the query; the backoff itself saturates well before this. */
const MIRROR_BACKOFF_LOOKBACK = 12;

export function mirrorRetryDelaySeconds(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return 0;
  const exponent = Math.min(consecutiveFailures - 1, 10);
  return Math.min(MIRROR_RETRY_BASE_SECONDS * 2 ** exponent, MIRROR_RETRY_MAX_SECONDS);
}

/** The issue fields PC-005 AC1 names: create, status, assignee. */
export interface MirrorIssueInput {
  id: string;
  companyId: string;
  identifier: string | null;
  title: string;
  status: string;
  assigneeUserId: string | null;
  assigneeAgentId: string | null;
  updatedAt: Date;
  hiddenAt: Date | null;
}

/**
 * Slice-1 field mapping for the ONE mirror table. Kept as a small, overridable
 * function rather than PC-010 AC2's general per-table schema-map framework
 * (explicitly deferred to Slice 2) -- there is exactly one table here.
 *
 * Field NAMES are a placeholder pending the real "Tecotec CN" base schema
 * (owner constraint, 2026-09-13: no live Teable instance has been reached from
 * this repo -- see `teable-client.ts`'s header). Isolated in one function so
 * matching the real base is a one-line change, and injectable via
 * `teableMirrorService`'s `mapFields` option so a test (or a future per-base
 * config) can supply the real names without touching this module.
 */
export function defaultMirrorFieldMapper(issue: MirrorIssueInput): Record<string, unknown> {
  return {
    "Card": issue.title,
    "Status": issue.status,
    "Assignee": issue.assigneeUserId ?? issue.assigneeAgentId ?? null,
    "Paperclip ID": issue.identifier ?? issue.id,
  };
}

function fieldsEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => Object.is(a[key], b[key]) || JSON.stringify(a[key]) === JSON.stringify(b[key]));
}

/** What this mirror stores in its `external_objects.data` column between ticks. */
interface MirrorObjectData {
  tableId: string;
  recordId: string;
  mirroredFields: Record<string, unknown>;
  /** ISO. The issue's own `updatedAt` as of the last successful create/update -- NOT a Teable timestamp. */
  mirroredIssueUpdatedAt: string;
  /** ISO or null. The Teable row's own `lastModifiedTime` as last observed by this mirror. */
  lastKnownRemoteModifiedAt: string | null;
  /** ISO. When this mirror last called `getRecord` on this row -- gates `MIRROR_RECHECK_INTERVAL_MS`. */
  lastCheckedAt: string;
  /** True while a Teable-side edit is flagged and unresolved (PC-005 AC3: never auto-cleared by an overwrite). */
  conflict: boolean;
}

function isMirrorObjectData(value: unknown): value is MirrorObjectData {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.tableId === "string" && typeof v.recordId === "string";
}

export type MirrorSyncStatus =
  | "created"
  | "updated"
  | "unchanged"
  | "conflict"
  | "skipped_not_configured"
  | "skipped_backoff"
  | "failed";

export interface MirrorSyncResult {
  status: MirrorSyncStatus;
  reason?: string;
}

export interface TeableMirrorSweepSummary {
  checked: number;
  created: number;
  updated: number;
  unchanged: number;
  conflicts: number;
  failed: number;
  skipped: number;
}

function emptySummary(): TeableMirrorSweepSummary {
  return { checked: 0, created: 0, updated: 0, unchanged: 0, conflicts: 0, failed: 0, skipped: 0 };
}

function resolvePublicBaseUrl(env: NodeJS.ProcessEnv): string | null {
  const raw = env.PAPERCLIP_TEABLE_PUBLIC_URL?.trim();
  return raw ? raw.replace(/\/+$/, "") : null;
}

export function teableMirrorService(
  db: Db,
  opts: {
    client?: TeableClient;
    secrets?: TeableSecretsDeps;
    env?: NodeJS.ProcessEnv;
    mapFields?: (issue: MirrorIssueInput) => Record<string, unknown>;
    now?: () => Date;
  } = {},
) {
  const client = opts.client ?? createTeableClient(db, { env: opts.env });
  const secrets: TeableSecretsDeps = opts.secrets ?? (secretService(db) as unknown as TeableSecretsDeps);
  const env = opts.env ?? process.env;
  const mapFields = opts.mapFields ?? defaultMirrorFieldMapper;

  async function resolveCompanySecret(companyId: string, name: string): Promise<string | null> {
    const secret = await Promise.resolve(secrets.getByName(companyId, name)).catch(() => null);
    if (!secret) return null;
    const value = await Promise.resolve(
      secrets.resolveSecretValue(companyId, secret.id, "latest", {
        accessContext: { consumerType: "system", consumerId: "teable-mirror", actorType: "system" },
      }),
    )
      .then((v) => v.trim())
      .catch(() => "");
    return value || null;
  }

  async function recordFailure(
    issue: Pick<MirrorIssueInput, "companyId" | "id">,
    phase: "create" | "read" | "update",
    error: TeableError,
  ): Promise<void> {
    await logActivity(db, {
      companyId: issue.companyId,
      actorType: MIRROR_ACTOR.actorType,
      actorId: MIRROR_ACTOR.actorId,
      action: TEABLE_MIRROR_ACTIVITY_ACTIONS.failed,
      entityType: "issue",
      entityId: issue.id,
      details: {
        phase,
        code: error.code,
        message: error.message,
        retryAfterSeconds: error.retryAfterSeconds ?? null,
      },
    }).catch((err: unknown) => {
      // The sync itself already failed; losing the audit trail on top of that
      // must never throw past the sweep loop (PC-005 AC4 wants this entry, but
      // one missing entry is better than the sweep aborting for every other
      // issue behind it).
      logger.error({ err, issueId: issue.id }, "teable mirror: failed to write activity_log entry for a sync failure");
    });
  }

  /**
   * The failure streak IS the backoff state (see module docblock): walk the
   * most recent mirror-activity rows for this issue newest-first and count how
   * many consecutive `failed` entries sit at the head. A `created`/`updated`
   * row breaks the streak, exactly like a successful attempt should.
   */
  async function computeBackoff(
    companyId: string,
    issueId: string,
    now: Date,
  ): Promise<{ inBackoff: boolean; retryAt?: Date }> {
    const recent = await db
      .select({ action: activityLog.action, createdAt: activityLog.createdAt })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.companyId, companyId),
          eq(activityLog.entityType, "issue"),
          eq(activityLog.entityId, issueId),
          inArray(activityLog.action, Object.values(TEABLE_MIRROR_ACTIVITY_ACTIONS)),
        ),
      )
      .orderBy(desc(activityLog.createdAt))
      .limit(MIRROR_BACKOFF_LOOKBACK);

    let consecutiveFailures = 0;
    for (const row of recent) {
      if (row.action === TEABLE_MIRROR_ACTIVITY_ACTIONS.failed) consecutiveFailures += 1;
      else break;
    }
    if (consecutiveFailures === 0) return { inBackoff: false };
    const lastFailureAt = recent[0]!.createdAt;
    const delaySeconds = mirrorRetryDelaySeconds(consecutiveFailures);
    const retryAt = new Date(lastFailureAt.getTime() + delaySeconds * 1000);
    return { inBackoff: retryAt > now, retryAt };
  }

  async function findExistingMirror(issueId: string) {
    const rows = await db
      .select({
        objectId: externalObjects.id,
        data: externalObjects.data,
      })
      .from(issueEvidenceLinks)
      .innerJoin(externalObjects, eq(issueEvidenceLinks.externalObjectId, externalObjects.id))
      .where(
        and(
          eq(issueEvidenceLinks.issueId, issueId),
          eq(externalObjects.providerKey, TEABLE_MIRROR_PROVIDER_KEY),
          eq(externalObjects.objectType, TEABLE_MIRROR_OBJECT_TYPE),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row || !isMirrorObjectData(row.data)) return null;
    return { objectId: row.objectId, data: row.data as MirrorObjectData };
  }

  async function createMirrorRow(
    issue: MirrorIssueInput,
    tableId: string,
    fields: Record<string, unknown>,
    now: Date,
  ): Promise<MirrorSyncResult> {
    const result = await client.createRecords({ companyId: issue.companyId, tableId, records: [{ fields }] });
    if (!result.ok) {
      await recordFailure(issue, "create", result.error);
      return { status: "failed", reason: result.error.code };
    }
    const record = result.data[0];
    if (!record) {
      const error = teableError("teable_invalid_response", {
        message: "Teable reported success but returned no created record.",
      });
      await recordFailure(issue, "create", error);
      return { status: "failed", reason: error.code };
    }

    const publicBaseUrl = resolvePublicBaseUrl(env);
    const data: MirrorObjectData = {
      tableId,
      recordId: record.id,
      mirroredFields: fields,
      mirroredIssueUpdatedAt: issue.updatedAt.toISOString(),
      lastKnownRemoteModifiedAt: record.lastModifiedTime ?? record.createdTime,
      lastCheckedAt: now.toISOString(),
      conflict: false,
    };
    const target: NewObjectTarget = {
      providerKey: TEABLE_MIRROR_PROVIDER_KEY,
      objectType: TEABLE_MIRROR_OBJECT_TYPE,
      externalId: `${tableId}/${record.id}`,
      displayTitle: issue.title,
      url: publicBaseUrl ? `${publicBaseUrl}/table/${tableId}/${record.id}` : null,
      data: data as unknown as Record<string, unknown>,
    };

    const { created } = await issueEvidenceLinkService(db).link(
      issue.id,
      target,
      MIRROR_EVIDENCE_SOURCE,
      async (tx, linkResult) => {
        if (!linkResult.created) return;
        await logActivity(tx, {
          companyId: issue.companyId,
          actorType: MIRROR_ACTOR.actorType,
          actorId: MIRROR_ACTOR.actorId,
          action: TEABLE_MIRROR_ACTIVITY_ACTIONS.created,
          entityType: "issue",
          entityId: issue.id,
          details: { tableId, recordId: record.id, evidenceLinkId: linkResult.link.id },
        });
      },
    );
    return { status: created ? "created" : "unchanged" };
  }

  async function updateMirrorRow(
    issue: MirrorIssueInput,
    objectId: string,
    data: MirrorObjectData,
    fields: Record<string, unknown>,
    now: Date,
  ): Promise<MirrorSyncResult> {
    const result = await client.updateRecord({
      companyId: issue.companyId,
      tableId: data.tableId,
      recordId: data.recordId,
      fields,
    });
    if (!result.ok) {
      await recordFailure(issue, "update", result.error);
      return { status: "failed", reason: result.error.code };
    }
    const record = result.data;
    const nextData: MirrorObjectData = {
      ...data,
      mirroredFields: fields,
      mirroredIssueUpdatedAt: issue.updatedAt.toISOString(),
      lastKnownRemoteModifiedAt: record.lastModifiedTime ?? record.createdTime ?? data.lastKnownRemoteModifiedAt,
      lastCheckedAt: now.toISOString(),
      conflict: false,
    };
    await db
      .update(externalObjects)
      .set({ data: nextData as unknown as Record<string, unknown>, displayTitle: issue.title, updatedAt: now })
      .where(eq(externalObjects.id, objectId));
    await logActivity(db, {
      companyId: issue.companyId,
      actorType: MIRROR_ACTOR.actorType,
      actorId: MIRROR_ACTOR.actorId,
      action: TEABLE_MIRROR_ACTIVITY_ACTIONS.updated,
      entityType: "issue",
      entityId: issue.id,
      details: { tableId: data.tableId, recordId: data.recordId },
    }).catch((err: unknown) => {
      logger.error({ err, issueId: issue.id }, "teable mirror: failed to write activity_log entry for a successful update");
    });
    return { status: "updated" };
  }

  /**
   * Re-reads the mirrored row and decides: is it a conflict (someone -- not
   * this mirror, not any Teable-bot-account write -- edited it since we last
   * wrote), and does our own record of "what Teable last showed" need
   * refreshing. Never writes; callers act on the verdict.
   */
  async function checkRemoteConflict(
    issue: MirrorIssueInput,
    data: MirrorObjectData,
    botAccountName: string | null,
  ): Promise<
    | { ok: true; conflict: boolean; remote: TeableRecord }
    | { ok: false; error: TeableError }
  > {
    const result = await client.getRecord({ companyId: issue.companyId, tableId: data.tableId, recordId: data.recordId });
    if (!result.ok) return { ok: false, error: result.error };
    const remote = result.data;
    const remoteChangedSinceOurLastWrite =
      remote.lastModifiedTime !== null && remote.lastModifiedTime !== data.lastKnownRemoteModifiedAt;
    // Deliberately pass ONLY `lastModifiedBy` to the shared predicate, not the
    // full record. `createdBy` never changes after the row is created, and
    // this mirror is ALWAYS the one who created its own row (`createMirrorRow`
    // above) -- so `createdBy` is always the configured bot account, and
    // including it here would make every mirror row permanently immune to
    // conflict detection the moment `isPaperclipBotAuthored`'s OR matches on
    // that field alone. Once `remoteChangedSinceOurLastWrite` is true (an edit
    // actually happened), `lastModifiedBy` is the field that answers "who made
    // THIS edit" -- `createdBy` answers a question from the past that is no
    // longer the one being asked.
    const conflict =
      remoteChangedSinceOurLastWrite &&
      !isPaperclipBotAuthored({ createdBy: null, lastModifiedBy: remote.lastModifiedBy }, botAccountName);
    return { ok: true, conflict, remote };
  }

  async function flagConflict(
    issue: MirrorIssueInput,
    objectId: string,
    data: MirrorObjectData,
    remote: TeableRecord,
    now: Date,
  ): Promise<void> {
    const alreadyFlaggedForThisEdit = data.conflict && data.lastKnownRemoteModifiedAt === remote.lastModifiedTime;
    await db
      .update(externalObjects)
      .set({
        data: {
          ...data,
          lastKnownRemoteModifiedAt: remote.lastModifiedTime,
          lastCheckedAt: now.toISOString(),
          conflict: true,
        } satisfies MirrorObjectData,
        updatedAt: now,
      })
      .where(eq(externalObjects.id, objectId));
    if (alreadyFlaggedForThisEdit) return; // don't spam an activity_log entry per tick for the same unresolved edit
    await logActivity(db, {
      companyId: issue.companyId,
      actorType: MIRROR_ACTOR.actorType,
      actorId: MIRROR_ACTOR.actorId,
      action: TEABLE_MIRROR_ACTIVITY_ACTIONS.conflict,
      entityType: "issue",
      entityId: issue.id,
      details: {
        tableId: data.tableId,
        recordId: data.recordId,
        remoteLastModifiedTime: remote.lastModifiedTime,
        remoteLastModifiedBy: remote.lastModifiedBy,
      },
    }).catch((err: unknown) => {
      logger.error({ err, issueId: issue.id }, "teable mirror: failed to write activity_log entry for a conflict");
    });
  }

  /**
   * `createRecords` has no server-side idempotency key (`teable-client.ts`'s
   * own docblock, and `teable-append.ts`'s AC6 comment), so two overlapping
   * "create the mirror row" calls for the SAME issue would each succeed and
   * leave two Teable rows for one card. The cross-process version of this race
   * is an accepted pilot-scale limitation (backlog.md PC-005/PC-010 Eng-8: "no
   * cross-system transaction, the conflict comment is the recovery, not
   * prevention") -- but the single-process, same-tick version is cheap to
   * close outright: dedupe concurrent `syncIssue` calls for the same issue
   * onto one in-flight promise, the same technique `external-objects.ts` uses
   * for its own `refreshObject`.
   */
  const inFlightSyncs = new Map<string, Promise<MirrorSyncResult>>();

  async function syncIssue(input: { companyId: string; issue: MirrorIssueInput; now?: Date }): Promise<MirrorSyncResult> {
    const existingInFlight = inFlightSyncs.get(input.issue.id);
    if (existingInFlight) return existingInFlight;
    const run = syncIssueUnchecked(input).finally(() => {
      inFlightSyncs.delete(input.issue.id);
    });
    inFlightSyncs.set(input.issue.id, run);
    return run;
  }

  async function syncIssueUnchecked(input: { companyId: string; issue: MirrorIssueInput; now?: Date }): Promise<MirrorSyncResult> {
      const now = input.now ?? opts.now?.() ?? new Date();
      const issue = input.issue;
      if (issue.hiddenAt) return { status: "skipped_not_configured", reason: "issue_hidden" };

      const tableId = await resolveCompanySecret(issue.companyId, TEABLE_MIRROR_TABLE_SECRET_NAME);
      if (!tableId) return { status: "skipped_not_configured", reason: "no_mirror_table_configured" };

      const backoff = await computeBackoff(issue.companyId, issue.id, now);
      if (backoff.inBackoff) return { status: "skipped_backoff", reason: backoff.retryAt?.toISOString() };

      const fields = mapFields(issue);
      const existing = await findExistingMirror(issue.id);

      if (!existing) {
        return createMirrorRow(issue, tableId, fields, now);
      }

      const { objectId, data } = existing;

      // PC-005 AC3: "never overwritten" means never -- not "until the remote
      // stops moving". Once flagged, this row stays flagged and this mirror
      // never calls createRecords/updateRecord against it again; a fresh
      // remote read here could otherwise let the conflict clear itself the
      // moment the edit stream goes quiet, and then silently push the pending
      // local change over a human's still-unresolved edit. Resolving it is a
      // human action outside this Slice-1 loop (see the module docblock's
      // "accepted at pilot scale" note) -- the activity_log entry already
      // written by `flagConflict` is the recovery signal.
      if (data.conflict) {
        return { status: "conflict", reason: "unresolved" };
      }

      const localUnchanged = fieldsEqual(data.mirroredFields, fields);
      const recentlyChecked = now.getTime() - Date.parse(data.lastCheckedAt) < MIRROR_RECHECK_INTERVAL_MS;

      if (localUnchanged && recentlyChecked) {
        return { status: "unchanged" };
      }

      const botAccountName = await resolveCompanySecret(issue.companyId, TEABLE_BOT_ACCOUNT_SECRET_NAME);
      const conflictCheck = await checkRemoteConflict(issue, data, botAccountName);
      if (!conflictCheck.ok) {
        await recordFailure(issue, "read", conflictCheck.error);
        return { status: "failed", reason: conflictCheck.error.code };
      }

      if (conflictCheck.conflict) {
        await flagConflict(issue, objectId, data, conflictCheck.remote, now);
        return { status: "conflict" };
      }

      if (localUnchanged) {
        // No conflict, nothing to write -- just refresh our bookkeeping
        // (`lastCheckedAt`/`lastKnownRemoteModifiedAt`) so the next tick's
        // recheck window starts fresh. `data.conflict` is already false here
        // (the guard above returns early whenever it is true), so this is not
        // where a conflict gets cleared.
        await db
          .update(externalObjects)
          .set({
            data: {
              ...data,
              lastKnownRemoteModifiedAt: conflictCheck.remote.lastModifiedTime,
              lastCheckedAt: now.toISOString(),
              conflict: false,
            } satisfies MirrorObjectData,
            updatedAt: now,
          })
          .where(eq(externalObjects.id, objectId));
        return { status: "unchanged" };
      }

      return updateMirrorRow(issue, objectId, data, fields, now);
  }

  /** Sweeps one company's non-hidden issues. `limit` bounds worst-case work per tick (pilot scale; see module docblock). */
  async function sweepCompany(companyId: string, limit = 200, now: Date = opts.now?.() ?? new Date()): Promise<TeableMirrorSweepSummary> {
      const tableId = await resolveCompanySecret(companyId, TEABLE_MIRROR_TABLE_SECRET_NAME);
      if (!tableId) return emptySummary();

      const candidates = await db
        .select({
          id: issues.id,
          companyId: issues.companyId,
          identifier: issues.identifier,
          title: issues.title,
          status: issues.status,
          assigneeUserId: issues.assigneeUserId,
          assigneeAgentId: issues.assigneeAgentId,
          updatedAt: issues.updatedAt,
          hiddenAt: issues.hiddenAt,
        })
        .from(issues)
        .where(and(eq(issues.companyId, companyId), isNull(issues.hiddenAt)))
        .limit(limit);

      const summary = emptySummary();
      for (const issue of candidates) {
        summary.checked += 1;
        let result: MirrorSyncResult;
        try {
          result = await syncIssue({ companyId: issue.companyId, issue, now });
        } catch (err) {
          summary.failed += 1;
          logger.error({ err, issueId: issue.id, companyId }, "teable mirror: unhandled error syncing issue");
          continue;
        }
        switch (result.status) {
          case "created": summary.created += 1; break;
          case "updated": summary.updated += 1; break;
          case "unchanged": summary.unchanged += 1; break;
          case "conflict": summary.conflicts += 1; break;
          case "failed": summary.failed += 1; break;
          default: summary.skipped += 1; break;
        }
      }
      return summary;
  }

  /** Sweeps every active company. Mirrors `external-objects.ts`'s `refreshDueObjectsForActiveCompanies` shape. */
  async function sweepActiveCompanies(limitPerCompany = 200, now: Date = opts.now?.() ?? new Date()): Promise<{ companies: number } & TeableMirrorSweepSummary> {
      const activeCompanies = await db.select({ id: companies.id }).from(companies).where(eq(companies.status, "active"));
      const total = { companies: activeCompanies.length, ...emptySummary() };
      for (const company of activeCompanies) {
        const result = await sweepCompany(company.id, limitPerCompany, now);
        total.checked += result.checked;
        total.created += result.created;
        total.updated += result.updated;
        total.unchanged += result.unchanged;
        total.conflicts += result.conflicts;
        total.failed += result.failed;
        total.skipped += result.skipped;
      }
      return total;
  }

  return { syncIssue, sweepCompany, sweepActiveCompanies };
}
