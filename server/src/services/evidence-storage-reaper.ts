import { and, eq, lt } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { externalObjects, issueEvidenceLinks } from "@paperclipai/db";
import type { StorageService } from "../storage/types.js";
import { MINIO_OBJECT_TYPE, MINIO_PROVIDER_KEY } from "./evidence-provider-minio.js";

const DEFAULT_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export interface EvidenceStorageReapResult {
  reclaimed: number;
  failed: number;
}

export interface EvidenceStorageReaperDeps {
  db: Db;
  storage: StorageService;
  now?: () => number;
  /** How long an unlinked `minio` object row must sit before it's reclaimed. */
  thresholdMs?: number;
  log?: (line: string) => void;
}

type ReclaimOutcome = "reclaimed" | "linked" | "missing";

/**
 * F-007-2's GC backstop (review finding 4.1). `uploadMinioEvidenceFile`
 * deliberately creates the `external_objects` row as its own step, ahead of
 * the `issue_evidence_links` insert (see that module's docblock) -- so a
 * failure in between leaves a real, queryable row: a `minio` object with no
 * matching link row. This sweep finds those, older than the threshold,
 * deletes the stored blob and the row, and logs what it did.
 *
 * A row can also legitimately have no link yet for a brief moment mid-request
 * -- the threshold (default 24h) is there so the sweep never races an
 * in-flight upload.
 *
 * Reclaiming is concurrency-safe against a link() call that is landing on the
 * SAME row at the same time (e.g. an upload's dedupe hit reusing an old,
 * still-unlinked object): each candidate is re-verified and deleted inside
 * its own transaction that takes `FOR UPDATE` on the `external_objects` row --
 * the same lock `resolveEvidenceObject`'s `ExistingObjectTarget` branch takes
 * before it links one. Whichever side's transaction commits first wins; the
 * other sees the fresh state (a link that now exists, or a row that is now
 * gone) and backs off instead of racing into a corrupt result. The DB row is
 * always deleted BEFORE the storage blob, never the other way around: a crash
 * between the two then leaves an orphaned blob with nothing pointing at it
 * (wasted space, reclaimable later), never a surviving evidence row whose
 * blob is already gone -- which would let the PC-001 gate stay satisfied by a
 * file nobody can retrieve.
 */
export function createEvidenceStorageReaper(deps: EvidenceStorageReaperDeps) {
  const now = deps.now ?? Date.now;
  const thresholdMs = deps.thresholdMs ?? DEFAULT_THRESHOLD_MS;

  async function reclaimOne(candidateId: string): Promise<{ outcome: ReclaimOutcome; objectKey: string | null; companyId: string | null }> {
    return deps.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ id: externalObjects.id, companyId: externalObjects.companyId, data: externalObjects.data })
        .from(externalObjects)
        .where(eq(externalObjects.id, candidateId))
        .for("update");
      if (!row) return { outcome: "missing" as const, objectKey: null, companyId: null };

      const [link] = await tx
        .select({ id: issueEvidenceLinks.id })
        .from(issueEvidenceLinks)
        .where(eq(issueEvidenceLinks.externalObjectId, candidateId))
        .limit(1);
      if (link) return { outcome: "linked" as const, objectKey: null, companyId: null };

      await tx.delete(externalObjects).where(eq(externalObjects.id, candidateId));
      const objectKey = typeof row.data?.objectKey === "string" ? row.data.objectKey : null;
      return { outcome: "reclaimed" as const, objectKey, companyId: row.companyId };
    });
  }

  async function sweep(): Promise<EvidenceStorageReapResult> {
    const cutoff = new Date(now() - thresholdMs);
    const candidates = await deps.db
      .select({ id: externalObjects.id })
      .from(externalObjects)
      .where(
        and(
          eq(externalObjects.providerKey, MINIO_PROVIDER_KEY),
          eq(externalObjects.objectType, MINIO_OBJECT_TYPE),
          lt(externalObjects.createdAt, cutoff),
        ),
      );
    if (candidates.length === 0) return { reclaimed: 0, failed: 0 };

    let reclaimed = 0;
    let failed = 0;
    for (const candidate of candidates) {
      try {
        const result = await reclaimOne(candidate.id);
        if (result.outcome !== "reclaimed") continue;
        // The DB row is already gone (committed above); the blob delete runs
        // OUTSIDE that transaction on purpose -- see the docblock on ordering.
        if (result.objectKey && result.companyId) {
          await deps.storage.deleteObject(result.companyId, result.objectKey);
        }
        reclaimed += 1;
      } catch (err) {
        failed += 1;
        deps.log?.(`evidence storage reaper failed to reclaim ${candidate.id}: ${String(err)}`);
      }
    }
    if (reclaimed > 0 || failed > 0) {
      deps.log?.(`evidence storage reaper reclaimed ${reclaimed} object(s), ${failed} failed`);
    }
    return { reclaimed, failed };
  }

  return { sweep };
}

export type EvidenceStorageReaper = ReturnType<typeof createEvidenceStorageReaper>;
