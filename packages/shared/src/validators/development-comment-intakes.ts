import { z } from "zod";
import { ISSUE_STATUSES } from "../constants.js";

export const DEVELOPMENT_COMMENT_INTAKE_KINDS = ["complaint", "suggestion", "needs_triage"] as const;
export const DEVELOPMENT_COMMENT_INTAKE_STATUSES = [
  "new",
  "triaged",
  "backlog_created",
  "duplicate",
  "dismissed",
  "rejected",
  "redacted",
  "archived",
] as const;
export const DEVELOPMENT_COMMENT_INTAKE_SOURCES = ["paperclip"] as const;
export const DEVELOPMENT_COMMENT_INTAKE_DEFAULT_LIMIT = 50;
export const DEVELOPMENT_COMMENT_INTAKE_MAX_LIMIT = 100;

function firstQueryValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function queryValues(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function parseOptionalString(value: unknown, ctx: z.RefinementCtx, name: string): string | undefined {
  const raw = firstQueryValue(value);
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${name} must be a string` });
    return undefined;
  }
  const normalized = raw.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function parseEnumList<T extends string>(value: unknown, ctx: z.RefinementCtx, name: string, allowed: readonly T[]): T[] {
  const allowedSet = new Set<string>(allowed);
  const results: T[] = [];
  for (const raw of queryValues(value)) {
    if (typeof raw !== "string") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${name} must be a string` });
      continue;
    }
    for (const entry of raw.split(",")) {
      const normalized = entry.trim();
      if (!normalized) continue;
      if (!allowedSet.has(normalized)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${name} contains an unsupported value` });
        continue;
      }
      if (!results.includes(normalized as T)) results.push(normalized as T);
    }
  }
  return results;
}

function parseTimestamp(value: unknown, ctx: z.RefinementCtx, name: string): string | undefined {
  const normalized = parseOptionalString(value, ctx, name);
  if (normalized === undefined) return undefined;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${name} must be an ISO-8601 timestamp` });
    return undefined;
  }
  return parsed.toISOString();
}

function parseLimit(value: unknown, ctx: z.RefinementCtx): number {
  const raw = firstQueryValue(value);
  if (raw === undefined || raw === null || raw === "") return DEVELOPMENT_COMMENT_INTAKE_DEFAULT_LIMIT;
  const text = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : "";
  if (!/^\d+$/.test(text)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "limit must be an integer" });
    return DEVELOPMENT_COMMENT_INTAKE_DEFAULT_LIMIT;
  }
  const limit = Number.parseInt(text, 10);
  if (limit < 1 || limit > DEVELOPMENT_COMMENT_INTAKE_MAX_LIMIT) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `limit must be between 1 and ${DEVELOPMENT_COMMENT_INTAKE_MAX_LIMIT}` });
    return DEVELOPMENT_COMMENT_INTAKE_DEFAULT_LIMIT;
  }
  return limit;
}

export const developmentCommentIntakeListQuerySchema = z.object({
  tag: z.unknown().optional().transform((value, ctx) => {
    const tag = parseOptionalString(value, ctx, "tag");
    if (tag !== undefined && tag !== "@dev") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "tag must be @dev" });
    }
    return tag;
  }),
  source: z.unknown().optional().transform((value, ctx) => {
    const source = parseOptionalString(value, ctx, "source");
    if (source !== undefined && source !== "paperclip") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "source must be paperclip" });
    }
    return source;
  }),
  kind: z.unknown().optional().transform((value, ctx) => parseOptionalString(value, ctx, "kind")),
  status: z.unknown().optional().transform((value, ctx) => parseEnumList(value, ctx, "status", DEVELOPMENT_COMMENT_INTAKE_STATUSES)),
  backlogStatus: z.unknown().optional().transform((value, ctx) => parseEnumList(value, ctx, "backlogStatus", [...ISSUE_STATUSES, "none"] as const)),
  createdAfter: z.unknown().optional().transform((value, ctx) => parseTimestamp(value, ctx, "createdAfter")),
  createdBefore: z.unknown().optional().transform((value, ctx) => parseTimestamp(value, ctx, "createdBefore")),
  limit: z.unknown().optional().transform((value, ctx) => parseLimit(value, ctx)),
  cursor: z.unknown().optional().transform((value, ctx) => parseOptionalString(value, ctx, "cursor")),
}).superRefine((value, ctx) => {
  if (value.kind !== undefined && !(DEVELOPMENT_COMMENT_INTAKE_KINDS as readonly string[]).includes(value.kind)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "kind must be complaint, suggestion, or needs_triage", path: ["kind"] });
  }
  if (value.createdAfter && value.createdBefore && value.createdAfter > value.createdBefore) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "createdAfter must be before createdBefore" });
  }
});

export type DevelopmentCommentIntakeListQuery = z.infer<typeof developmentCommentIntakeListQuerySchema>;
