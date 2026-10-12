import { unprocessable } from "../errors.js";
import type { EvidenceLinkTarget } from "./issue-evidence-links.js";

/** A confidential (defense/B2G) path never leaves the NAS -- AD-021/C16. */
const ABSOLUTE_PATH_RE = /^(\/|[a-zA-Z]:[\\/]|\\\\)/;

export interface NasEvidenceDescriptor {
  providerKey: string;
  objectType: string;
  externalId: string;
  displayTitle?: string | null;
  url?: string | null;
}

/**
 * PC-007 AC3: a NAS evidence row is a PATH REFERENCE ONLY -- no bytes ever
 * leave the NAS. This validates shape (non-empty, absolute-looking path, no
 * `url`) and returns the target `issueEvidenceLinkService(db).link()` should
 * be called with. `data` stays empty deliberately: no content-type, no size,
 * nothing that could let the stored row leak what the file actually is.
 *
 * This fork does not model a configured NAS root to validate the path
 * against -- that would be existence validation, which this unit's effort
 * budget does not cover. Shape only.
 */
export function buildNasEvidenceTarget(descriptor: NasEvidenceDescriptor): EvidenceLinkTarget {
  if (descriptor.url) {
    throw unprocessable("NAS evidence is a path reference only and cannot carry a url");
  }
  const path = descriptor.externalId.trim();
  if (path.length === 0) {
    throw unprocessable("NAS evidence path is required");
  }
  if (!ABSOLUTE_PATH_RE.test(path)) {
    throw unprocessable("NAS evidence path must be absolute");
  }
  return {
    providerKey: descriptor.providerKey,
    objectType: descriptor.objectType,
    externalId: path,
    displayTitle: descriptor.displayTitle ?? path,
    url: null,
  };
}
