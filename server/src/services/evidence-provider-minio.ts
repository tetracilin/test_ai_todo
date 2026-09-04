import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { externalObjects } from "@paperclipai/db";
import { unprocessable } from "../errors.js";
import { isAllowedContentType } from "../attachment-types.js";
import type { StorageService } from "../storage/types.js";
import { createOrReuseEvidenceObject } from "./issue-evidence-links.js";

export const MINIO_PROVIDER_KEY = "minio";
export const MINIO_OBJECT_TYPE = "file";

const KNOWN_SIGNATURE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "video/mp4",
  "video/quicktime",
  "video/x-m4v",
  "video/webm",
]);

function startsWith(buffer: Buffer, signature: number[]): boolean {
  if (buffer.length < signature.length) return false;
  for (let i = 0; i < signature.length; i += 1) {
    if (buffer[i] !== signature[i]) return false;
  }
  return true;
}

function isFtypContainer(buffer: Buffer): boolean {
  return buffer.length > 8 && buffer.subarray(4, 8).toString("ascii") === "ftyp";
}

function isRiffWebp(buffer: Buffer): boolean {
  return startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) && buffer.subarray(8, 12).toString("ascii") === "WEBP";
}

/** True when `buffer`'s magic bytes match `type`'s known signature. */
function sniffMatchesDeclaredType(buffer: Buffer, type: string): boolean {
  switch (type) {
    case "image/png":
      return startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg":
    case "image/jpg":
      return startsWith(buffer, [0xff, 0xd8, 0xff]);
    case "image/gif":
      return startsWith(buffer, [0x47, 0x49, 0x46, 0x38]);
    case "image/webp":
      return isRiffWebp(buffer);
    case "application/pdf":
      return startsWith(buffer, [0x25, 0x50, 0x44, 0x46]);
    case "application/zip":
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      return startsWith(buffer, [0x50, 0x4b, 0x03, 0x04]);
    case "video/mp4":
    case "video/quicktime":
    case "video/x-m4v":
      return isFtypContainer(buffer);
    case "video/webm":
      return startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3]);
    default:
      return true;
  }
}

/** If `buffer` unambiguously matches SOME known binary signature, which one. */
function looksLikeKnownBinary(buffer: Buffer): string | null {
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(buffer, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (isRiffWebp(buffer)) return "image/webp";
  if (startsWith(buffer, [0x25, 0x50, 0x44, 0x46])) return "application/pdf";
  if (startsWith(buffer, [0x50, 0x4b, 0x03, 0x04])) return "application/zip";
  if (isFtypContainer(buffer)) return "video/mp4";
  if (startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3])) return "video/webm";
  return null;
}

/**
 * PC-007 AC1: content-type is sniffed, never taken from the client's
 * declared header, before the allowlist check. Binary types with a real
 * magic-byte signature are verified against it -- a declared `image/png`
 * whose bytes are something else is refused. Types with no reliable
 * signature (`text/*`, `application/json`, legacy office formats) are
 * trusted UNLESS the bytes unambiguously match a DIFFERENT known binary
 * format -- the disguised-binary case.
 */
export function sniffAndValidateContentType(buffer: Buffer, declaredContentType: string): string {
  const declared = declaredContentType.trim().toLowerCase();
  if (!isAllowedContentType(declared)) {
    throw unprocessable(`Content type ${declared} is not allowed`);
  }
  if (KNOWN_SIGNATURE_TYPES.has(declared)) {
    if (!sniffMatchesDeclaredType(buffer, declared)) {
      throw unprocessable("File content does not match its declared content type");
    }
    return declared;
  }
  const disguised = looksLikeKnownBinary(buffer);
  if (disguised && disguised !== declared) {
    throw unprocessable("File content does not match its declared content type");
  }
  return declared;
}

export interface MinioEvidenceUploadInput {
  companyId: string;
  originalFilename: string | null;
  declaredContentType: string;
  body: Buffer;
  maxBytes: number;
}

export interface MinioEvidenceUploadResult {
  externalObjectId: string;
  /** False when the upload deduped onto an existing object -- no new storage write happened. */
  created: boolean;
  sha256: string;
}

/**
 * PC-007 AC1: chat/UI file to the NAS MinIO evidence bucket, SHA-256
 * recorded, deduped per `(company_id, sha256)` -- never the bare hash, which
 * would let one company confirm another company holds a given file (review
 * 3.2). Dedup reuses `externalId = sha256`'s own unique index inside
 * `createOrReuseEvidenceObject`; the SELECT below is purely an optimization
 * that skips a redundant storage write on a byte-for-byte repeat upload.
 *
 * Storage write happens BEFORE the `external_objects` row is created (ordering:
 * store first, object second) -- see `createOrReuseEvidenceObject`'s docblock
 * for why this row is its own step rather than folded into `link()`'s
 * transaction. If `putFile` throws, nothing below it ever runs: no dangling
 * DB row, no dangling link.
 */
export async function uploadMinioEvidenceFile(
  db: Db,
  storage: StorageService,
  input: MinioEvidenceUploadInput,
): Promise<MinioEvidenceUploadResult> {
  if (input.body.length <= 0) {
    throw unprocessable("File is empty");
  }
  if (input.body.length > input.maxBytes) {
    throw unprocessable(`File exceeds the ${input.maxBytes}-byte evidence upload limit`);
  }
  const contentType = sniffAndValidateContentType(input.body, input.declaredContentType);
  const sha256 = createHash("sha256").update(input.body).digest("hex");

  const existing = await db
    .select({ id: externalObjects.id })
    .from(externalObjects)
    .where(
      and(
        eq(externalObjects.companyId, input.companyId),
        eq(externalObjects.providerKey, MINIO_PROVIDER_KEY),
        eq(externalObjects.objectType, MINIO_OBJECT_TYPE),
        eq(externalObjects.externalId, sha256),
      ),
    )
    .then((rows) => rows[0] ?? null);
  if (existing) {
    return { externalObjectId: existing.id, created: false, sha256 };
  }

  const stored = await storage.putFile({
    companyId: input.companyId,
    namespace: "evidence",
    originalFilename: input.originalFilename,
    contentType,
    body: input.body,
  });

  const object = await createOrReuseEvidenceObject(db, input.companyId, {
    providerKey: MINIO_PROVIDER_KEY,
    objectType: MINIO_OBJECT_TYPE,
    externalId: sha256,
    displayTitle: stored.originalFilename ?? sha256,
    url: null,
    data: {
      objectKey: stored.objectKey,
      contentType: stored.contentType,
      byteSize: stored.byteSize,
      sha256: stored.sha256,
      storageProvider: stored.provider,
    },
  });

  return { externalObjectId: object.id, created: true, sha256 };
}
