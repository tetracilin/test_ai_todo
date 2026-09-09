/**
 * Reader half of the PC-002 dossier contract.
 *
 * The dossier is an ordinary `issue_documents` row under the key `dossier` — the key IS the
 * discriminator, and it is deliberately NOT a system key, so `listDocuments` already returns
 * it alongside every other card document. The writer of record is
 * `server/src/services/issue-dossier.ts`; this module only has to read what that writer
 * renders, so it mirrors the two parts of the body shape a reader can see (the five ordered
 * section headings and the heading-escape) and nothing else. The per-line grammars
 * (evidence-log, scope-change, clarification, chat-correlation lines) stay on the server: the
 * UI renders those lines as markdown rather than re-parsing them, so a second copy of a
 * grammar that can drift is not worth carrying.
 */
export const ISSUE_DOSSIER_DOCUMENT_KEY = "dossier" as const;

/** PC-002 AC1, in the order the server renders them. */
export const DOSSIER_SECTION_HEADINGS = [
  "Job order",
  "Clarifications",
  "Evidence log",
  "Scope changes",
  "Related Teable rows",
] as const;
export type DossierSectionHeading = (typeof DOSSIER_SECTION_HEADINGS)[number];

export type DossierSection = {
  heading: DossierSectionHeading;
  /** Section body markdown, trimmed and unescaped. Empty until content accrues. */
  body: string;
};

export type ParsedDossier = {
  /** The H1 line without its `# ` prefix. */
  title: string;
  /** Free prose between the H1 and the first section heading. Usually empty. */
  preamble: string;
  /** The five sections, in contract order. */
  sections: DossierSection[];
};

/**
 * The server escapes a body line it would otherwise re-read as a section heading by prefixing
 * backslashes (`escapeSectionBody`), so a forwarded quote sheet whose own header line is
 * `## Báo giá` cannot brick the document. Undo exactly that on the way to the renderer —
 * otherwise the card shows a literal backslash the author never typed.
 */
function unescapeSectionBody(body: string): string {
  return body
    .split("\n")
    .map((line) => (/^\\+## /.test(line) ? line.slice(1) : line))
    .join("\n");
}

/**
 * Parses a stored dossier body into its sections, or returns `null` when the body is not in
 * the canonical shape.
 *
 * Null is a "render this as plain markdown instead" signal, never an error: a hand-edited or
 * future-version dossier must still be readable on the card. Only a body carrying exactly the
 * five headings in contract order gets the sectioned treatment, which is the same test the
 * server's `parseDossierMarkdown` applies before it will write to one — so anything this
 * function accepts is also something the append hooks can still write to.
 */
export function parseDossierSections(body: string): ParsedDossier | null {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const titleLine = lines.findIndex((line) => line.startsWith("# "));
  if (titleLine < 0) return null;

  const found: { heading: string; start: number }[] = [];
  for (const [index, line] of lines.entries()) {
    if (line.startsWith("## ")) found.push({ heading: line.slice(3).trim(), start: index });
  }
  const expected = [...DOSSIER_SECTION_HEADINGS];
  if (found.length !== expected.length || found.some((entry, index) => entry.heading !== expected[index])) {
    return null;
  }

  const sections = found.map((entry, index) => ({
    heading: entry.heading as DossierSectionHeading,
    body: unescapeSectionBody(lines.slice(entry.start + 1, found[index + 1]?.start ?? lines.length).join("\n").trim()),
  }));

  return {
    title: lines[titleLine]!.slice(2).trim(),
    preamble: unescapeSectionBody(lines.slice(titleLine + 1, found[0]!.start).join("\n").trim()),
    sections,
  };
}
