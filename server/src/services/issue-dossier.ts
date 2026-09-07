import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { documents, issueDocuments, issues } from "@paperclipai/db";
import { HttpError, notFound, unprocessable } from "../errors.js";
import { isUniqueViolation } from "../db-errors.js";
import { documentService } from "./documents.js";

/**
 * Dossier document contract (PC-002, AD-034).
 *
 * The dossier is the per-card record an engineer's agent maintains instead of the engineer
 * writing anything up. It is stored as an ordinary `issue_documents` row under the key
 * `dossier` (the key IS the discriminator — there is no `kind` column) and is deliberately
 * NOT a system document key, so the card UI renders it and company search indexes it.
 *
 * This module owns the *shape* only: the ordered section headings from PC-002 AC1 and the
 * three line grammars its consumers must agree on — the agent that writes the dossier, the
 * markdown export that emits it verbatim, and the CTO retrieval test that reads it back.
 * `server/src/__tests__/fixtures/dossier-example.md` is the single checked-in example
 * (PC-002 AC5); `issue-dossier-fixture.test.ts` round-trips it through this module so the
 * three consumers cannot drift apart silently.
 *
 * Two rules run through every grammar below, because this document exists to hold content
 * captured verbatim from a chat message (AD-034):
 *   - nothing a *closed* grammar owns is silently discarded. A caption or note that cannot be
 *     represented on one line is rejected at format time rather than written and lost at read
 *     time, and in the Scope changes section — whose bullet grammar is closed — a bullet that
 *     does not parse raises `unprocessable` (422) rather than vanishing from the count. The
 *     Evidence log's bullet grammar is deliberately NOT closed; see `parseSectionEntries`.
 *   - no legitimate captured text can brick the document. Body lines the parser would read as
 *     a section heading are escaped reversibly (see `escapeSectionBody`) instead of being
 *     rejected or, worse, re-parsed as a sixth section.
 */
export const ISSUE_DOSSIER_DOCUMENT_KEY = "dossier" as const;
export const ISSUE_DOSSIER_TITLE = "Dossier";

/** PC-002 AC1, in the order they must appear in the body. */
export const DOSSIER_SECTION_HEADINGS = [
  "Job order",
  "Clarifications",
  "Evidence log",
  "Scope changes",
  "Related Teable rows",
] as const;
export type DossierSectionHeading = (typeof DOSSIER_SECTION_HEADINGS)[number];

export type DossierDocument = {
  /** The H1 line, without its `# ` prefix. Card identifier + job-order title. */
  title: string;
  /**
   * Free prose between the H1 and the first section heading. Preserved rather than dropped:
   * the first consumer to append an evidence line does it as parse -> mutate -> render, and
   * a parser that forgot the preamble would delete whatever a human (or an earlier agent
   * version) wrote there. Absent when empty, so the round trip stays byte-exact.
   */
  preamble?: string;
  /**
   * Section body markdown, keyed by heading. Never has leading/trailing blank lines.
   * A body MAY be empty: PC-002 AC1 requires every intake-created card to carry all five
   * headings, and at intake (PC-004 AC1) only Job order has content. The headings are the
   * contract; the content accrues. See `createSeededDossier`.
   */
  sections: Record<DossierSectionHeading, string>;
};

/**
 * Evidence-log line (PC-007 AC5: every linkage appends exactly one line).
 * `- <ISO 8601 UTC> · <providerKey> · `<ref>` — <caption>`
 *
 * `providerKey` matches `externalObjectProviderKeySchema` (minio · git · nas · teable · …).
 * `ref` is `external_objects.external_id` VERBATIM — the identity the evidence-link write
 * path (`server/src/services/issue-evidence-links.ts`) stores for the artifact, not a
 * prettified or re-schemed form of it. That is why provider `nas` reads as the UNC path
 * `//nas-t3/...` and provider `teable` as `<tableId>/<recordId>`: those are the strings in
 * the row. Build the line with `evidenceLineFromLink` rather than by hand so the two lanes
 * cannot diverge — for provider `nas` the reference is a path only, because no bytes leave
 * the NAS (PC-007 AC3, AD-021). The human-readable URL, where one exists, lives in
 * `external_objects.sanitized_canonical_url` and in the Related Teable rows section.
 * `caption` is captured content and therefore stays verbatim Vietnamese; it must be a
 * single non-empty line (a multi-line caption is rejected, never truncated).
 */
export type DossierEvidenceLine = {
  at: string;
  providerKey: string;
  ref: string;
  caption: string;
};

/**
 * The subset of an `issue_evidence_links` row (joined to its `external_objects` row) that the
 * PC-007 AC5 appender needs. Structurally satisfied by `IssueEvidenceLinkRow` from
 * `server/src/services/issue-evidence-links.ts` — deliberately declared structurally rather
 * than imported, so this module stays free of the DB layer while still binding to its shape.
 */
export type DossierEvidenceLinkRow = {
  providerKey: string;
  externalId: string;
  createdAt: Date | string;
};

/**
 * Scope-change line (PC-002 AC2/AC3). The leading timestamp is the CTO's replanning-latency
 * signal, so it is the first thing on the line and always ISO 8601 UTC.
 * `- <ISO 8601 UTC> — <note>`
 */
export type DossierScopeChangeLine = {
  at: string;
  note: string;
};

/**
 * The chat-message-id ↔ card correlation line (PC-002 AC5 calls this out by name).
 * `- Source: chat message `<chatOriginId>` -> card `<issueIdentifier>` (origin_kind=`<kind>`)`
 *
 * It is the first line of the Job order section. `chatOriginId` is `issues.origin_id`
 * verbatim (also copied to `issues.origin_fingerprint`, which is what makes the create call
 * idempotent), read in the namespace named by `originKind` — the pair, not the id alone, is
 * the identity. Correlating a chat event back to its card is therefore an index lookup on
 * `issues_company_origin_idx` (companyId, originKind, originId), never a text search of this
 * document.
 *
 * WHAT THE SHIPPED WRITER STORES: the only route that creates cards today,
 * `server/src/routes/discord-integrations.ts`, is the slash-command path, and it stores the
 * Discord *interaction* id — the bridge is slash-command + notification transport only, with
 * no message handler and no DM path (gate decision 2026-09-02). So for `origin_kind=discord`
 * as written today the id is an interaction id, not a DM message id. PC-004's job-order
 * forward path, when it lands, must store the forwarded message's id in `origin_id` (under
 * its own origin kind if the two namespaces must coexist), or a support tool handed a
 * message id by an engineer will match no card.
 */
export type DossierChatCorrelation = {
  chatOriginId: string;
  issueIdentifier: string;
  originKind: string;
};

const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const PROVIDER_KEY_RE = /^[a-z][a-z0-9_.-]*$/;
const EVIDENCE_LINE_RE = /^- (\S+) · ([^ ·]+) · `([^`]+)` — (.+)$/;
const SCOPE_CHANGE_LINE_RE = /^- (\S+) — (.+)$/;
const CHAT_CORRELATION_LINE_RE = /^- Source: chat message `([^`]+)` -> card `([^`]+)` \(origin_kind=`([^`]+)`\)$/;
/**
 * A body line `parseDossierMarkdown` would read as a SECTION heading — deliberately the exact
 * complement of the parser's own `line.startsWith("## ")` test (:228), plus any number of
 * leading backslashes so the escape stays a bijection. Nothing else is escaped: a `# `, a
 * `### ` sub-heading, a bare `##` and an indented `  ## ` all parse as ordinary body text, so
 * escaping them would put a literal backslash into the card UI and the markdown export
 * (PC-002 AC4) while fixing nothing.
 */
const HEADING_LIKE_RE = /^\\*## /;
/** The same line after `escapeSectionBody` has run at least once. */
const ESCAPED_HEADING_RE = /^\\+## /;

function assertIsoUtc(value: string, what: string) {
  if (!ISO_UTC_RE.test(value)) throw unprocessable(`Dossier ${what} timestamp must be ISO 8601 UTC (…Z): ${value}`);
}

/**
 * Every grammar in this module is one line per entry, so a value carrying a newline would
 * render as an entry the parser can no longer see. Reject it at the source instead
 * (PC-007 AC5's "every linkage appends ONE line" is only true if this holds).
 */
function assertSingleLine(value: string, what: string) {
  if (/[\r\n]/.test(value)) throw unprocessable(`Dossier ${what} must be a single line`);
}

function assertNoBacktick(value: string, what: string) {
  if (value.includes("`")) throw unprocessable(`${what} cannot contain a backtick`);
}

/**
 * Normalizes a producer's timestamp to the second-precision UTC form both line grammars pin.
 * `Date#toISOString` emits milliseconds, which `ISO_UTC_RE` rejects, so an appender that
 * passed `row.createdAt.toISOString()` straight through would 422 on every filing.
 */
export function toDossierTimestamp(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw unprocessable(`Dossier timestamp is not a date: ${String(value)}`);
  return `${date.toISOString().slice(0, 19)}Z`;
}

/**
 * PC-002 exists to hold content captured verbatim (AD-034), so a section body may legitimately
 * contain a line the parser reads as a section heading — a forwarded quote sheet whose header
 * line is `## Báo giá`, say. Written raw, the parser would see a sixth section and *every* later
 * read of that card would 422: the export, the CTO retrieval test and the next evidence-log
 * append, with no recovery short of hand-editing the document body. So exactly those lines are
 * backslash-escaped on the way out and unescaped on the way in. The mapping is a bijection (an
 * already-escaped line simply gains another backslash), so the round trip stays byte-exact, and
 * `\## Báo giá` still renders as that literal text in any markdown viewer.
 *
 * The escape is kept as narrow as the brick it prevents (`HEADING_LIKE_RE`): a `### Chi tiết
 * khảo sát` sub-heading an agent writes into Clarifications is NOT heading-like to this parser,
 * so it is stored and exported unchanged rather than as a literal `\###`.
 */
function escapeSectionBody(body: string): string {
  return body
    .split("\n")
    .map((line) => (HEADING_LIKE_RE.test(line) ? `\\${line}` : line))
    .join("\n");
}

function unescapeSectionBody(body: string): string {
  return body
    .split("\n")
    .map((line) => (ESCAPED_HEADING_RE.test(line) ? line.slice(1) : line))
    .join("\n");
}

/**
 * Renders the canonical body.
 *
 * `parse` ∘ `render` is an identity on every `DossierDocument` this module accepts.
 * `render` ∘ `parse` is an identity on canonically-rendered bodies — i.e. anything this
 * function produced. It is NOT an identity on an arbitrary markdown file: `parse` normalizes
 * CRLF to LF, trims each section body, and unescapes heading-like lines, so a hand-edited body
 * with, say, three blank lines before a heading round-trips to the canonical two. That is the
 * intended direction (render is the writer of record); what matters is that nothing is
 * *dropped* — a preamble is preserved, and anything else raises instead of vanishing.
 */
export function renderDossierMarkdown(document: DossierDocument): string {
  const title = document.title.trim();
  if (!title) throw unprocessable("Dossier title is required");
  assertSingleLine(title, "title");
  const blocks: string[] = [`# ${title}`];
  const preamble = document.preamble?.trim() ?? "";
  if (preamble) blocks.push(escapeSectionBody(preamble));
  for (const heading of DOSSIER_SECTION_HEADINGS) {
    const body = escapeSectionBody(document.sections[heading]?.trim() ?? "");
    blocks.push(body ? `## ${heading}\n${body}` : `## ${heading}`);
  }
  return `${blocks.join("\n\n")}\n`;
}

/** Parses a stored dossier body. Throws 422 when a section is missing or out of order. */
export function parseDossierMarkdown(body: string): DossierDocument {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const titleLine = lines.findIndex((line) => line.startsWith("# "));
  if (titleLine < 0) throw unprocessable("Dossier body has no title heading");
  if (lines.slice(0, titleLine).some((line) => line.trim())) {
    throw unprocessable("Dossier body has content before its title heading");
  }

  const found: { heading: string; start: number }[] = [];
  for (const [index, line] of lines.entries()) {
    if (line.startsWith("## ")) found.push({ heading: line.slice(3).trim(), start: index });
  }
  const actual = found.map((entry) => entry.heading);
  const expected = [...DOSSIER_SECTION_HEADINGS];
  if (actual.length !== expected.length || actual.some((heading, index) => heading !== expected[index])) {
    throw unprocessable(
      `Dossier sections must be exactly ${expected.join(" · ")} in order; got ${actual.join(" · ") || "(none)"}`,
    );
  }

  const sections = {} as Record<DossierSectionHeading, string>;
  for (const [index, entry] of found.entries()) {
    const end = found[index + 1]?.start ?? lines.length;
    sections[entry.heading as DossierSectionHeading] = unescapeSectionBody(
      lines.slice(entry.start + 1, end).join("\n").trim(),
    );
  }

  const document: DossierDocument = { title: lines[titleLine]!.slice(2).trim(), sections };
  const preamble = unescapeSectionBody(lines.slice(titleLine + 1, found[0]!.start).join("\n").trim());
  if (preamble) document.preamble = preamble;
  return document;
}

/**
 * PC-002 AC1 / PC-004 AC1: a freshly intake-created card carries all five headings and only a
 * job order. Exported so the seeding path never has to invent a placeholder line that the
 * export and the retrieval test would then each have to agree on independently — which is the
 * drift AC5's single fixture exists to prevent.
 */
export function createSeededDossier(input: { title: string; jobOrder: string }): DossierDocument {
  const sections = {} as Record<DossierSectionHeading, string>;
  for (const heading of DOSSIER_SECTION_HEADINGS) sections[heading] = "";
  sections["Job order"] = input.jobOrder.trim();
  return { title: input.title, sections };
}

export function formatEvidenceLine(line: DossierEvidenceLine): string {
  assertIsoUtc(line.at, "evidence-log");
  if (!PROVIDER_KEY_RE.test(line.providerKey)) throw unprocessable(`Invalid evidence provider key: ${line.providerKey}`);
  assertNoBacktick(line.ref, "Evidence reference");
  assertSingleLine(line.ref, "evidence reference");
  if (!line.ref.trim()) throw unprocessable("Evidence reference is required");
  const caption = line.caption.trim();
  assertSingleLine(caption, "evidence caption");
  if (!caption) throw unprocessable("Evidence caption is required");
  return `- ${line.at} · ${line.providerKey} · \`${line.ref}\` — ${caption}`;
}

/**
 * PC-007 AC5 — the Evidence-log line for one filing act, built from the row the evidence-link
 * write path stores. `ref` is `external_objects.external_id` verbatim; going through this
 * function is what keeps the dossier's reference shape and PC-007's stored shape one shape.
 */
export function evidenceLineFromLink(link: DossierEvidenceLinkRow, caption: string): DossierEvidenceLine {
  return {
    at: toDossierTimestamp(link.createdAt),
    providerKey: link.providerKey,
    ref: link.externalId,
    caption: caption.trim(),
  };
}

/** Returns null for a line that is not an evidence entry (free-form prose is allowed around them). */
export function parseEvidenceLine(line: string): DossierEvidenceLine | null {
  const match = EVIDENCE_LINE_RE.exec(line.trim());
  if (!match) return null;
  const [, at, providerKey, ref, caption] = match;
  if (!ISO_UTC_RE.test(at!) || !PROVIDER_KEY_RE.test(providerKey!)) return null;
  return { at: at!, providerKey: providerKey!, ref: ref!, caption: caption!.trim() };
}

/**
 * Reads the entries out of one section. Free-form prose around the entries is always allowed.
 *
 * `raiseOnMalformedBullet` is the ONE difference between the two sections, and the asymmetry is
 * deliberate — do not "fix" it back into symmetry:
 *
 *   - Scope changes (`raiseOnMalformedBullet = "scope-change"`) has a CLOSED bullet grammar:
 *     `SCOPE_CHANGE_LINE_RE` is the only thing a `- ` line in that section is ever allowed to
 *     be. PC-002 AC3 reads those timestamps as the CTO's replanning-latency signal, so a bullet
 *     silently skipped reads as a genuinely low number. It raises.
 *   - Evidence log (`raiseOnMalformedBullet = null`) has an OPEN one: PC-007 AC6 puts the
 *     unlink/move *correction* line in this same section next to the AC5 evidence lines, and
 *     that correction grammar is not `EVIDENCE_LINE_RE` and is not yet specified. Raising here
 *     would mean the first unlink on a card makes every later read — export, CTO retrieval
 *     test, next AC5 append — 422 forever, with no recovery short of hand-editing
 *     `documents.latestBody`. The bricking failure is strictly worse than the undercount, so
 *     this section stays lenient until AC6's line has a grammar this module can parse.
 */
function parseSectionEntries<T>(
  body: string,
  parse: (line: string) => T | null,
  raiseOnMalformedBullet: string | null,
): T[] {
  const entries: T[] = [];
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const parsed = parse(line);
    if (parsed) {
      entries.push(parsed);
      continue;
    }
    if (raiseOnMalformedBullet && line.startsWith("- ")) {
      throw unprocessable(`Dossier ${raiseOnMalformedBullet} entry is malformed: ${line}`);
    }
  }
  return entries;
}

/**
 * PC-007 AC5: the filing acts, in document order. Lenient by construction — a bullet this
 * grammar does not recognise (an AC6 correction line, say) is skipped, not raised on. See
 * `parseSectionEntries` for why this section and Scope changes differ.
 */
export function parseEvidenceLog(document: DossierDocument): DossierEvidenceLine[] {
  return parseSectionEntries(document.sections["Evidence log"], parseEvidenceLine, null);
}

export function formatScopeChangeLine(line: DossierScopeChangeLine): string {
  assertIsoUtc(line.at, "scope-change");
  const note = line.note.trim();
  assertSingleLine(note, "scope-change note");
  if (!note) throw unprocessable("Scope-change note is required");
  return `- ${line.at} — ${note}`;
}

export function parseScopeChangeLine(line: string): DossierScopeChangeLine | null {
  const match = SCOPE_CHANGE_LINE_RE.exec(line.trim());
  if (!match || !ISO_UTC_RE.test(match[1]!)) return null;
  return { at: match[1]!, note: match[2]!.trim() };
}

/**
 * PC-002 AC3: the replanning-latency signal is read from here, in document order. Strict — a
 * `- ` bullet that is not a scope-change line raises rather than being dropped from the count.
 */
export function parseScopeChanges(document: DossierDocument): DossierScopeChangeLine[] {
  return parseSectionEntries(document.sections["Scope changes"], parseScopeChangeLine, "scope-change");
}

/**
 * Clarification line (PC-004 AC2: "Agent replies... asks clarifying questions; answers land in
 * dossier Clarifications"). One line per answered question.
 * `- <ISO 8601 UTC> · Q: <question> — A: <answer>`
 *
 * Lenient on read like Evidence log, not strict like Scope changes: an engineer or an earlier
 * agent may write free-form notes into Clarifications alongside the structured Q/A lines, and
 * nothing downstream counts entries here the way AC3 counts scope changes, so there is no metric
 * a malformed bullet could silently understate.
 */
export type DossierClarificationLine = {
  at: string;
  question: string;
  answer: string;
};

const CLARIFICATION_LINE_RE = /^- (\S+) · Q: (.+) — A: (.+)$/;

export function formatClarificationLine(line: DossierClarificationLine): string {
  assertIsoUtc(line.at, "clarification");
  const question = line.question.trim();
  assertSingleLine(question, "clarification question");
  if (!question) throw unprocessable("Clarification question is required");
  const answer = line.answer.trim();
  assertSingleLine(answer, "clarification answer");
  if (!answer) throw unprocessable("Clarification answer is required");
  return `- ${line.at} · Q: ${question} — A: ${answer}`;
}

export function parseClarificationLine(line: string): DossierClarificationLine | null {
  const match = CLARIFICATION_LINE_RE.exec(line.trim());
  if (!match || !ISO_UTC_RE.test(match[1]!)) return null;
  return { at: match[1]!, question: match[2]!.trim(), answer: match[3]!.trim() };
}

export function parseClarifications(document: DossierDocument): DossierClarificationLine[] {
  return parseSectionEntries(document.sections["Clarifications"], parseClarificationLine, null);
}

export function formatChatCorrelationLine(correlation: DossierChatCorrelation): string {
  const { chatOriginId, issueIdentifier, originKind } = correlation;
  if (!chatOriginId.trim() || !issueIdentifier.trim() || !originKind.trim()) {
    throw unprocessable("Chat correlation line requires chatOriginId, issueIdentifier and originKind");
  }
  // All three are interpolated between backticks, so an unguarded one can forge or destroy the
  // line — `1` -> card `T3-999` smuggled into an id reads as a correlation to a different card.
  const fields = [
    ["Chat origin id", chatOriginId, "chat origin id"],
    ["Card identifier", issueIdentifier, "card identifier"],
    ["Origin kind", originKind, "origin kind"],
  ] as const;
  for (const [label, value, what] of fields) {
    assertNoBacktick(value, label);
    assertSingleLine(value, what);
  }
  return `- Source: chat message \`${chatOriginId}\` -> card \`${issueIdentifier}\` (origin_kind=\`${originKind}\`)`;
}

export function parseChatCorrelationLine(line: string): DossierChatCorrelation | null {
  const match = CHAT_CORRELATION_LINE_RE.exec(line.trim());
  if (!match) return null;
  return { chatOriginId: match[1]!, issueIdentifier: match[2]!, originKind: match[3]! };
}

/** The correlation line is the first line of Job order, so a reader never has to scan. */
export function parseChatCorrelation(document: DossierDocument): DossierChatCorrelation | null {
  const [first] = document.sections["Job order"].split("\n");
  return first ? parseChatCorrelationLine(first) : null;
}

// ---------------------------------------------------------------------------
// Persistence (F-002-1/2). Everything above this line is pure shape/grammar;
// everything below reads and writes the actual `issue_documents` row.
// ---------------------------------------------------------------------------

export interface DossierActor {
  agentId?: string | null;
  userId?: string | null;
  runId?: string | null;
}

const MAX_APPEND_ATTEMPTS = 3;

/**
 * `issueDossierService(db)` — create-on-intake, read, and append-section (F-002-1), and the four
 * append hooks that write to it (F-002-2). Built directly on `documentService(db)`
 * (`server/src/services/documents.ts`), the same generic keyed-`issue_documents` CRUD
 * `issue-continuation-summary.ts` already uses for its own document key — no new schema, no new
 * persistence layer.
 */
export function issueDossierService(db: Db) {
  const documentsSvc = documentService(db);

  async function readCurrent(
    issueId: string,
  ): Promise<{ document: DossierDocument; latestRevisionId: string | null } | null> {
    const row = await documentsSvc.getIssueDocumentByKey(issueId, ISSUE_DOSSIER_DOCUMENT_KEY);
    if (!row) return null;
    // `getIssueDocumentByKey` always calls `mapIssueDocumentRow(row, true)`, so `body` is always
    // present; the type is optional only because that helper's signature doesn't statically
    // encode which call sites pass `includeBody: true`.
    return { document: parseDossierMarkdown(row.body!), latestRevisionId: row.latestRevisionId };
  }

  async function write(
    issueId: string,
    document: DossierDocument,
    baseRevisionId: string | null,
    actor: DossierActor,
    changeSummary: string,
  ) {
    return documentsSvc.upsertIssueDocument({
      issueId,
      key: ISSUE_DOSSIER_DOCUMENT_KEY,
      title: ISSUE_DOSSIER_TITLE,
      format: "markdown",
      body: renderDossierMarkdown(document),
      baseRevisionId,
      changeSummary,
      createdByAgentId: actor.agentId ?? null,
      createdByUserId: actor.userId ?? null,
      createdByRunId: actor.runId ?? null,
    });
  }

  /** PC-002 AC1 seed content for a card with no dossier yet: its own title/description. */
  async function seedDocumentFor(issueId: string): Promise<DossierDocument> {
    const issue = await db
      .select({ title: issues.title, description: issues.description })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0] ?? null);
    if (!issue) throw notFound("Issue not found");
    return createSeededDossier({ title: issue.title, jobOrder: issue.description ?? issue.title });
  }

  /**
   * Read -> parse -> append `buildLines`'s lines to `section` -> render -> write. Two callers
   * appending to the SAME card's dossier at once race in one of two ways, and this retries on
   * both by RE-READING fresh state each attempt (never resubmitting the same `baseRevisionId`),
   * so two evidence links landing back to back both survive as two lines rather than the second
   * one failing outright:
   *   - The card already has a dossier: `upsertIssueDocument`'s optimistic concurrency throws
   *     `conflict()` (409 `HttpError`) on a stale `baseRevisionId`.
   *   - The card has NO dossier yet and two appends both lazily seed one at once (via
   *     `seedDocumentFor`): `upsertIssueDocument`'s create path has no `ON CONFLICT` of its own,
   *     so the loser hits the raw Postgres unique violation on
   *     `issue_documents_company_issue_key_uq` instead of a `conflict()` HttpError -- caught here
   *     via `isUniqueViolation` rather than left to surface as a 500.
   */
  async function appendLines(
    issueId: string,
    section: DossierSectionHeading,
    buildLines: (document: DossierDocument) => string[],
    actor: DossierActor,
    changeSummary: string,
  ): Promise<DossierDocument> {
    let lastConflict: unknown;
    for (let attempt = 0; attempt < MAX_APPEND_ATTEMPTS; attempt += 1) {
      const current = await readCurrent(issueId);
      const document = current?.document ?? (await seedDocumentFor(issueId));
      const newLines = buildLines(document);
      if (newLines.length === 0) return document;
      const existingBody = document.sections[section];
      document.sections[section] = existingBody ? `${existingBody}\n${newLines.join("\n")}` : newLines.join("\n");
      try {
        const result = await write(issueId, document, current?.latestRevisionId ?? null, actor, changeSummary);
        return parseDossierMarkdown(result.document.body);
      } catch (err) {
        const isConflict = (err instanceof HttpError && err.status === 409) || isUniqueViolation(err);
        if (!isConflict) throw err;
        lastConflict = err;
      }
    }
    throw lastConflict;
  }

  return {
    get: readCurrent,

    /** PC-002 AC1: every intake-created card gets all five headings and a Job order. */
    seed: async (issueId: string, input: { title: string; jobOrder: string }, actor: DossierActor) => {
      const document = createSeededDossier(input);
      const result = await write(issueId, document, null, actor, "Seed dossier at intake");
      return parseDossierMarkdown(result.document.body);
    },

    /**
     * PC-007 AC5: one Evidence-log line per filing act — an `issue_evidence_links` row or an
     * `issue_attachments` row, `link` structurally satisfying `DossierEvidenceLinkRow` either way.
     */
    appendEvidenceLine: (issueId: string, link: DossierEvidenceLinkRow, caption: string, actor: DossierActor) =>
      appendLines(
        issueId,
        "Evidence log",
        () => [formatEvidenceLine(evidenceLineFromLink(link, caption))],
        actor,
        "Evidence linked",
      ),

    /** PC-004 AC2: one Clarifications line per answered question, in one write. */
    appendClarificationAnswers: (issueId: string, entries: DossierClarificationLine[], actor: DossierActor) =>
      appendLines(issueId, "Clarifications", () => entries.map(formatClarificationLine), actor, "Clarification answered"),

    /**
     * PC-002 AC2: one Scope-changes line, timestamped by the agent. The caller
     * (`POST /issues/:id/dossier/scope-changes`) does NOT treat this as best-effort like the
     * other three hooks — recording the change is the request's entire purpose.
     */
    appendScopeChange: (issueId: string, line: DossierScopeChangeLine, actor: DossierActor) =>
      appendLines(issueId, "Scope changes", () => [formatScopeChangeLine(line)], actor, "Scope change recorded"),
  };
}

export interface ScopeChangeTimestampQuery {
  companyId: string;
  issueId?: string;
  /** Inclusive lower bound on a scope-change entry's own `at` timestamp. */
  from?: Date;
  /** Inclusive upper bound. */
  to?: Date;
}

export interface ScopeChangeTimestampRow {
  issueId: string;
  /** The earliest scope-change entry's timestamp within the queried window. */
  firstScopeChangeAt: string;
  count: number;
}

/**
 * PC-002 AC3: scope-change timestamps, queryable. Reads every matching card's dossier, parses its
 * Scope changes section with `parseScopeChanges`, and reports the first-signal timestamp per
 * card within `[from, to]` — the earliest scope-change entry, which is the CTO's
 * replanning-latency signal (time from intake to first scope change). Cards with no dossier, or
 * no scope-change entry in the window, are simply absent from the result.
 *
 * No HTTP route: F-011-3's evidence-provenance query (`evidence-provenance.ts`) shipped the same
 * way, function + tests only, because nothing consumes it until the feature that reads it
 * (here, F-006-1's timeline) lands.
 */
export async function queryScopeChangeTimestamps(
  db: Db,
  input: ScopeChangeTimestampQuery,
): Promise<ScopeChangeTimestampRow[]> {
  const conditions = [
    eq(issueDocuments.companyId, input.companyId),
    eq(issueDocuments.key, ISSUE_DOSSIER_DOCUMENT_KEY),
  ];
  if (input.issueId) conditions.push(eq(issueDocuments.issueId, input.issueId));
  const from = input.from ? toDossierTimestamp(input.from) : null;
  const to = input.to ? toDossierTimestamp(input.to) : null;

  const rows = await db
    .select({ issueId: issueDocuments.issueId, body: documents.latestBody })
    .from(issueDocuments)
    .innerJoin(documents, eq(issueDocuments.documentId, documents.id))
    .where(and(...conditions));

  const results: ScopeChangeTimestampRow[] = [];
  for (const row of rows) {
    // Fixed-width, zero-padded ISO 8601 UTC strings sort correctly lexicographically, so the
    // window filter and the "earliest" reduction below never need to parse into Date objects.
    const entries = parseScopeChanges(parseDossierMarkdown(row.body)).filter(
      (entry) => (!from || entry.at >= from) && (!to || entry.at <= to),
    );
    if (entries.length === 0) continue;
    const firstScopeChangeAt = entries.reduce((earliest, entry) => (entry.at < earliest ? entry.at : earliest), entries[0]!.at);
    results.push({ issueId: row.issueId, firstScopeChangeAt, count: entries.length });
  }
  return results;
}
