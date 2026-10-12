/**
 * Dossier READ model (F-002-5, PC-002 AD-034).
 *
 * The dossier's writer and its closed grammars live server-side in
 * `server/src/services/issue-dossier.ts`, which owns formatting, validation, and the 422s
 * that keep a malformed line out of the stored document. This module is the other half: the
 * shape a *reader* needs to render one, and nothing else. It lives in `@paperclipai/shared`
 * because the card UI is now a consumer of the same grammar the server writes, and the two
 * must not drift — `server/src/__tests__/issue-dossier-view.test.ts` re-parses the checked-in
 * fixture through both and asserts they agree.
 *
 * Three rules separate this module from the server's:
 *
 *   1. **It never throws.** The server rejects a malformed dossier at write time; by the time
 *      one reaches a card it is already stored, and a card that renders an exception instead
 *      of a record is worse than a card that renders plain markdown. `parseDossierView`
 *      returns `null` when the body is not a dossier at all, and the caller falls back.
 *   2. **It never hides a line.** Where a section has a grammar, the parse reports
 *      `complete: false` the moment one non-empty line does not match it, so the renderer can
 *      fall back to that section's raw body. A line the grammar has not learned yet — a
 *      hand-edit, a future writer version — stays visible on the card instead of silently
 *      disappearing from a structured list.
 *   3. **It invents no grammar.** Only the three line shapes the server actually writes are
 *      parsed here (evidence log, scope changes, the chat-correlation line). Job order,
 *      Clarifications, and Related Teable rows carry no closed server grammar, so they stay
 *      markdown and are rendered as such — a display-only grammar for them would be a second
 *      contract with no writer bound to it.
 */

/**
 * `issue_documents.key` for the per-card dossier. The key IS the discriminator — there is no
 * `kind` column. Deliberately NOT a member of `SYSTEM_ISSUE_DOCUMENT_KEYS`: the dossier is a
 * first-class card document, so the generic documents surface renders and indexes it.
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

/** One parsed `## Evidence log` bullet. Mirrors the server's `DossierEvidenceLine`. */
export type DossierViewEvidenceEntry = {
  /** ISO 8601 UTC, verbatim from the line — not re-parsed into a Date, so a bad one still shows. */
  at: string;
  providerKey: string;
  /** `external_objects.external_id` verbatim: a NAS UNC path, a `<tableId>/<recordId>`, a commit hash. */
  ref: string;
  /** Captured content — stays verbatim Vietnamese, never translated or truncated for display. */
  caption: string;
};

/** One parsed `## Scope changes` bullet. Mirrors the server's `DossierScopeChangeLine`. */
export type DossierViewScopeChangeEntry = {
  at: string;
  note: string;
};

/** The `## Job order` correlation line. Mirrors the server's `DossierChatCorrelation`. */
export type DossierViewChatCorrelation = {
  chatOriginId: string;
  issueIdentifier: string;
  originKind: string;
};

/**
 * A section's parsed bullets plus whether the parse covered all of them.
 *
 * `complete: false` is the renderer's instruction to show the section's raw `body` instead of
 * `entries`: at least one non-empty line did not match the grammar, and dropping it from the
 * card would lose a record. It is not an error state — it is the honest state.
 */
export type DossierViewEntryList<T> = {
  entries: T[];
  complete: boolean;
};

export type DossierViewSection = {
  heading: DossierSectionHeading;
  /** Raw section markdown, heading-escapes already undone. Empty string when the section is empty. */
  body: string;
};

export type DossierView = {
  /** The H1 line without its `# ` prefix: card identifier + job-order title. */
  title: string;
  /** Free prose between the H1 and the first section heading. Empty when there is none. */
  preamble: string;
  /** All five sections, always present and always in `DOSSIER_SECTION_HEADINGS` order. */
  sections: DossierViewSection[];
  /** The Job order chat-correlation line, when the dossier carries one. */
  chatCorrelation: DossierViewChatCorrelation | null;
  evidence: DossierViewEntryList<DossierViewEvidenceEntry>;
  scopeChanges: DossierViewEntryList<DossierViewScopeChangeEntry>;
};

// The three grammars below are character-for-character the server's. Any change to
// `server/src/services/issue-dossier.ts` must land here in the same commit; the fixture
// agreement test is what makes forgetting that a red build rather than a blank card.
const EVIDENCE_LINE_RE = /^- (\S+) · ([^ ·]+) · `([^`]+)` — (.+)$/;
const SCOPE_CHANGE_LINE_RE = /^- (\S+) — (.+)$/;
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const PROVIDER_KEY_RE = /^[a-z][a-z0-9_.-]*$/;
const CHAT_CORRELATION_LINE_RE = /^- Source: chat message `([^`]+)` -> card `([^`]+)` \(origin_kind=`([^`]+)`\)$/;
/** A body line the writer escaped because the parser would otherwise read it as a section heading. */
const ESCAPED_HEADING_RE = /^\\+## /;

function unescapeSectionBody(body: string): string {
  return body
    .split("\n")
    .map((line) => (ESCAPED_HEADING_RE.test(line) ? line.slice(1) : line))
    .join("\n");
}

/**
 * `complete` means "every non-empty line in this section became an entry" — deliberately
 * stricter than the server's own leniency, which skips free-form prose in the Evidence log
 * without complaint. The server is answering "is this document valid?"; this is answering "can
 * a structured list show everything that is here?", and prose between the bullets is exactly
 * the case where the answer is no. `entries` is filled either way, so the two parsers still
 * agree on the entries themselves.
 */
function parseEntries<T>(body: string, parseLine: (line: string) => T | null): DossierViewEntryList<T> {
  const entries: T[] = [];
  let complete = true;
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const parsed = parseLine(line);
    if (parsed === null) {
      complete = false;
      continue;
    }
    entries.push(parsed);
  }
  return { entries, complete };
}

export function parseDossierEvidenceLine(line: string): DossierViewEvidenceEntry | null {
  const match = EVIDENCE_LINE_RE.exec(line.trim());
  if (!match) return null;
  const [, at, providerKey, ref, caption] = match;
  if (!ISO_UTC_RE.test(at!) || !PROVIDER_KEY_RE.test(providerKey!)) return null;
  return { at: at!, providerKey: providerKey!, ref: ref!, caption: caption!.trim() };
}

export function parseDossierScopeChangeLine(line: string): DossierViewScopeChangeEntry | null {
  const match = SCOPE_CHANGE_LINE_RE.exec(line.trim());
  if (!match || !ISO_UTC_RE.test(match[1]!)) return null;
  return { at: match[1]!, note: match[2]!.trim() };
}

export function parseDossierChatCorrelationLine(line: string): DossierViewChatCorrelation | null {
  const match = CHAT_CORRELATION_LINE_RE.exec(line.trim());
  if (!match) return null;
  const [, chatOriginId, issueIdentifier, originKind] = match;
  return { chatOriginId: chatOriginId!, issueIdentifier: issueIdentifier!, originKind: originKind! };
}

/**
 * Parses a stored dossier body into the read model, or returns `null` when `body` is not a
 * dossier: no `# ` title, or not exactly the five PC-002 AC1 headings in order. `null` is the
 * signal to render the document however an ordinary card document is rendered — it is a
 * legitimate outcome, not a failure, because the same `issue_documents` row could have been
 * hand-edited into something else entirely and the card still has to show it.
 */
export function parseDossierView(body: string): DossierView | null {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const titleLine = lines.findIndex((line) => line.startsWith("# "));
  if (titleLine < 0) return null;
  if (lines.slice(0, titleLine).some((line) => line.trim())) return null;

  const found: { heading: string; start: number }[] = [];
  for (const [index, line] of lines.entries()) {
    if (line.startsWith("## ")) found.push({ heading: line.slice(3).trim(), start: index });
  }
  const expected = [...DOSSIER_SECTION_HEADINGS];
  if (found.length !== expected.length) return null;
  if (found.some((entry, index) => entry.heading !== expected[index])) return null;

  const bodies = {} as Record<DossierSectionHeading, string>;
  for (const [index, entry] of found.entries()) {
    const end = found[index + 1]?.start ?? lines.length;
    bodies[entry.heading as DossierSectionHeading] = unescapeSectionBody(
      lines.slice(entry.start + 1, end).join("\n").trim(),
    );
  }

  // The correlation line is the FIRST line of Job order, never scanned for — the same rule the
  // server's `parseChatCorrelation` follows, so the two cannot disagree about which line it is.
  const [correlationLine] = bodies["Job order"].split("\n");

  return {
    title: lines[titleLine]!.slice(2).trim(),
    preamble: unescapeSectionBody(lines.slice(titleLine + 1, found[0]!.start).join("\n").trim()),
    sections: expected.map((heading) => ({ heading, body: bodies[heading] })),
    chatCorrelation: correlationLine ? parseDossierChatCorrelationLine(correlationLine) : null,
    evidence: parseEntries(bodies["Evidence log"], parseDossierEvidenceLine),
    scopeChanges: parseEntries(bodies["Scope changes"], parseDossierScopeChangeLine),
  };
}
