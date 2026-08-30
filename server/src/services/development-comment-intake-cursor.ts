import { createHash } from "node:crypto";
import { badRequest } from "../errors.js";

/**
 * Opaque, filter-bound keyset cursor for the development comment intake
 * listing endpoint (design doc/plans/2026-08-30-dev-comment-intake-design.md
 * §7). The cursor carries the position of the last returned row in the fixed
 * `sourceCreatedAt DESC, id DESC` order plus a SHA-256 hash of the canonical
 * filter set it was produced under, so a cursor minted for one filter set
 * cannot be replayed against a different one (design: "cursor from a different
 * filter set returns 400").
 *
 * The payload is base64url(JSON). It is opaque to clients; nothing here is a
 * credential, raw provider data, or a secret.
 */

export const DEVELOPMENT_COMMENT_INTAKE_CURSOR_VERSION = 1;

export type DevelopmentCommentIntakeFilterInput = {
  tag?: string;
  source?: string;
  kind?: string;
  status?: string[];
  backlogStatus?: string[];
  createdAfter?: string;
  createdBefore?: string;
};

export type DevelopmentCommentIntakeCursor = {
  v: number;
  /** SHA-256 (hex) of the canonicalized filter set. */
  f: string;
  /** `sourceCreatedAt` of the last row, ISO-8601 UTC. */
  t: string;
  /** `id` of the last row (uuid). */
  i: string;
};

/**
 * Stable canonical serialization of the filter set. Key order is fixed and
 * repeated filters are sorted, so semantically identical filter sets always
 * produce the same hash regardless of query-parameter ordering.
 */
export function developmentCommentIntakeFilterHash(
  filter: DevelopmentCommentIntakeFilterInput,
): string {
  const canonical = {
    tag: filter.tag ?? null,
    source: filter.source ?? null,
    kind: filter.kind ?? null,
    status: [...(filter.status ?? [])].sort(),
    backlogStatus: [...(filter.backlogStatus ?? [])].sort(),
    createdAfter: filter.createdAfter ?? null,
    createdBefore: filter.createdBefore ?? null,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function encodeDevelopmentCommentIntakeCursor(
  cursor: DevelopmentCommentIntakeCursor,
): string {
  return Buffer.from(
    JSON.stringify({
      v: DEVELOPMENT_COMMENT_INTAKE_CURSOR_VERSION,
      f: cursor.f,
      t: cursor.t,
      i: cursor.i,
    }),
    "utf8",
  ).toString("base64url");
}

function isCursorPayload(value: unknown): value is DevelopmentCommentIntakeCursor {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.v === DEVELOPMENT_COMMENT_INTAKE_CURSOR_VERSION &&
    typeof candidate.f === "string" &&
    typeof candidate.t === "string" &&
    typeof candidate.i === "string"
  );
}

/**
 * Decode and validate an opaque cursor against the filter set it must belong
 * to. Throws `badRequest` (400) for a malformed cursor, an unsupported
 * version, or a cursor minted under a different filter set.
 */
export function decodeDevelopmentCommentIntakeCursor(
  raw: string,
  filter: DevelopmentCommentIntakeFilterInput,
): DevelopmentCommentIntakeCursor {
  let payload: unknown;
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    payload = JSON.parse(json) as unknown;
  } catch {
    throw badRequest("cursor is invalid");
  }
  if (!isCursorPayload(payload)) {
    throw badRequest("cursor is invalid");
  }
  const expectedHash = developmentCommentIntakeFilterHash(filter);
  if (payload.f !== expectedHash) {
    throw badRequest("cursor does not match the requested filters");
  }
  return payload;
}