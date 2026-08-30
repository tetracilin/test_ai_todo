import { createHash } from "node:crypto";

export const COMMENT_INTAKE_TAG = "@dev";
export const COMMENT_INTAKE_DEFAULT_SUBJECT = "Development feedback";
export const COMMENT_INTAKE_MAX_REQUEST_BODY_CODE_POINTS = 16_000;
export const COMMENT_INTAKE_MAX_SUBJECT_CODE_POINTS = 240;

export type CommentIntakeKind = "complaint" | "suggestion" | "needs_triage";

export type ParsedCommentIntakeText = {
  visibleText: string;
  requestBody: string;
  subject: string;
  kind: CommentIntakeKind;
  tagPositions: Array<{ start: number; end: number }>;
};

const TAG_RE = /(?<![A-Za-z0-9_-])@dev(?![A-Za-z0-9_-])/gi;
const COMPLAINT_DIRECTIVES = new Set(["complaint", "bug", "issue"]);
const SUGGESTION_DIRECTIVES = new Set(["suggestion", "feature", "idea"]);
const DIRECTIVE_RE = /^(?:[\s:-])*(complaint|bug|issue|suggestion|feature|idea)\b/i;

function codePointSlice(value: string, length: number): string {
  return Array.from(value).slice(0, length).join("");
}

function normalizeVisibleWhitespace(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/[\t \f\v]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Removes Markdown fenced and inline code while retaining newline boundaries.
 * It deliberately does not parse links/emphasis: those are visible prose.
 */
export function visibleCommentProse(body: string): string {
  const normalized = body.normalize("NFC");
  let output = "";
  let index = 0;
  let fencedMarker: "`" | "~" | null = null;
  let fencedLength = 0;
  let inlineDelimiterLength = 0;

  while (index < normalized.length) {
    const char = normalized[index]!;
    const next = normalized[index + 1] ?? "";

    if (fencedMarker) {
      if (char === fencedMarker) {
        let run = 1;
        while (normalized[index + run] === fencedMarker) run += 1;
        if (run >= fencedLength) {
          fencedMarker = null;
          fencedLength = 0;
          output += " ";
          index += run;
          continue;
        }
      }
      output += char === "\n" ? "\n" : " ";
      index += 1;
      continue;
    }

    if (inlineDelimiterLength > 0) {
      if (char === "`") {
        let run = 1;
        while (normalized[index + run] === "`") run += 1;
        if (run === inlineDelimiterLength) {
          inlineDelimiterLength = 0;
          output += " ";
          index += run;
          continue;
        }
      }
      output += char === "\n" ? "\n" : " ";
      index += 1;
      continue;
    }

    if ((char === "`" || char === "~") && (index === 0 || normalized[index - 1] === "\n")) {
      let run = 1;
      while (normalized[index + run] === char) run += 1;
      if (run >= 3) {
        fencedMarker = char;
        fencedLength = run;
        output += " ";
        index += run;
        continue;
      }
    }

    if (char === "`") {
      let run = 1;
      while (normalized[index + run] === "`") run += 1;
      inlineDelimiterLength = run;
      output += " ";
      index += run;
      continue;
    }

    // A backslash escapes the following Markdown delimiter, preserving prose.
    if (char === "\\" && (next === "`" || next === "~")) {
      output += next;
      index += 2;
      continue;
    }

    output += char;
    index += 1;
  }

  return normalizeVisibleWhitespace(output);
}

function kindForDirective(directive: string | null): CommentIntakeKind {
  if (directive && COMPLAINT_DIRECTIVES.has(directive.toLowerCase())) return "complaint";
  if (directive && SUGGESTION_DIRECTIVES.has(directive.toLowerCase())) return "suggestion";
  return "needs_triage";
}

export function parseCommentIntakeText(body: string): ParsedCommentIntakeText | null {
  const visibleText = visibleCommentProse(body);
  const tagPositions: Array<{ start: number; end: number }> = [];
  let firstDirective: string | null = null;
  let firstTagEnd = -1;

  for (const match of visibleText.matchAll(TAG_RE)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    tagPositions.push({ start, end });
    if (firstTagEnd >= 0) continue;
    firstTagEnd = end;
    firstDirective = visibleText.slice(end).match(DIRECTIVE_RE)?.[1] ?? null;
  }

  if (tagPositions.length === 0) return null;

  const requestBody = codePointSlice(visibleText, COMMENT_INTAKE_MAX_REQUEST_BODY_CODE_POINTS);
  const directiveMatch = firstTagEnd >= 0 ? visibleText.slice(firstTagEnd).match(DIRECTIVE_RE) : null;
  const removedTagAndDirective = visibleText.slice(0, tagPositions[0]!.start)
    + visibleText.slice(firstTagEnd + (directiveMatch?.[0].length ?? 0));
  const subjectLine = normalizeVisibleWhitespace(removedTagAndDirective)
    .split("\n")
    .find((line) => line.length > 0) ?? "";

  return {
    visibleText,
    requestBody,
    subject: codePointSlice(subjectLine.replace(/^[\s:-]+/, ""), COMMENT_INTAKE_MAX_SUBJECT_CODE_POINTS) || COMMENT_INTAKE_DEFAULT_SUBJECT,
    kind: kindForDirective(firstDirective),
    tagPositions,
  };
}

export function commentIntakeDedupeKey(input: {
  companyId: string;
  providerKey: string;
  objectType: string;
  sourceScopeId: string;
  sourceCommentId: string;
}): string {
  return createHash("sha256").update([
    input.companyId,
    input.providerKey,
    input.objectType,
    input.sourceScopeId,
    input.sourceCommentId,
  ].join("\u0000"), "utf8").digest("hex");
}
