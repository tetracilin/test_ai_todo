import { and, eq, inArray, lt } from "drizzle-orm";
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
 */
export function createEvidenceStorageReaper(deps: EvidenceStorageReaperDeps) {
  const now = deps.now ?? Date.now;
  const thresholdMs = deps.thresholdMs ?? DEFAULT_THRESHOLD_MS;

  async function sweep(): Promise<EvidenceStorageReapResult> {
    const cutoff = new Date(now() - thresholdMs);
    const candidates = await deps.db
      .select({ id: externalObjects.id, companyId: externalObjects.companyId, data: externalObjects.data })
      .from(externalObjects)
      .where(
        and(
          eq(externalObjects.providerKey, MINIO_PROVIDER_KEY),
          eq(externalObjects.objectType, MINIO_OBJECT_TYPE),
          lt(externalObjects.createdAt, cutoff),
        ),
      );
    if (candidates.length === 0) return { reclaimed: 0, failed: 0 };

    const linkedIds = new Set(
      (
        await deps.db
          .select({ externalObjectId: issueEvidenceLinks.externalObjectId })
          .from(issueEvidenceLinks)
          .where(inArray(issueEvidenceLinks.externalObjectId, candidates.map((row) => row.id)))
      ).map((row) => row.externalObjectId),
    );
    const orphans = candidates.filter((row) => !linkedIds.has(row.id));

    let reclaimed = 0;
    let failed = 0;
    for (const orphan of orphans) {
      const objectKey = typeof orphan.data?.objectKey === "string" ? orphan.data.objectKey : null;
      try {
        if (objectKey) await deps.storage.deleteObject(orphan.companyId, objectKey);
        await deps.db.delete(externalObjects).where(eq(externalObjects.id, orphan.id));
        reclaimed += 1;
      } catch (err) {
        failed += 1;
        deps.log?.(`evidence storage reaper failed to reclaim ${orphan.id}: ${String(err)}`);
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
