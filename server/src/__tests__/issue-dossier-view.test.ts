import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseDossierView } from "@paperclipai/shared";
import {
  DOSSIER_SECTION_HEADINGS,
  parseChatCorrelation,
  parseDossierMarkdown,
  parseEvidenceLog,
  parseScopeChanges,
} from "../services/issue-dossier.js";

/**
 * F-002-5 drift guard.
 *
 * The dossier now has two parsers: the server's, which validates and writes, and
 * `@paperclipai/shared`'s read model, which the card UI renders from. They are separate on
 * purpose — the reader must never throw at a card, and the writer must never accept a bad line
 * — but they must not DISAGREE, and a disagreement would show up as a card silently missing an
 * evidence item rather than as an error anyone notices.
 *
 * So both are run over the same checked-in PC-002 AC5 fixture and compared field by field.
 * This is the test that fails when someone edits one grammar and forgets the other.
 */
const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "dossier-example.md");
const fixture = readFileSync(fixturePath, "utf8");

describe("dossier read model agrees with the server grammar", () => {
  const document = parseDossierMarkdown(fixture);
  const view = parseDossierView(fixture);

  it("parses the fixture at all", () => {
    expect(view).not.toBeNull();
  });

  it("agrees on the title, the preamble and every section body", () => {
    expect(view!.title).toBe(document.title);
    expect(view!.preamble).toBe(document.preamble ?? "");
    expect(view!.sections.map((section) => section.heading)).toEqual([...DOSSIER_SECTION_HEADINGS]);
    for (const section of view!.sections) {
      expect(section.body).toBe(document.sections[section.heading]);
    }
  });

  it("agrees on the evidence log, entry for entry", () => {
    expect(view!.evidence.entries).toEqual(parseEvidenceLog(document));
    // Every line of the fixture's Evidence log is an AC5 filing act, so the card renders the
    // structured list rather than falling back to markdown.
    expect(view!.evidence.complete).toBe(true);
    expect(view!.evidence.entries.length).toBeGreaterThan(0);
  });

  it("agrees on the scope-change timeline, entry for entry", () => {
    expect(view!.scopeChanges.entries).toEqual(parseScopeChanges(document));
    expect(view!.scopeChanges.complete).toBe(true);
    expect(view!.scopeChanges.entries.length).toBeGreaterThan(0);
  });

  it("agrees on the chat correlation line", () => {
    expect(view!.chatCorrelation).toEqual(parseChatCorrelation(document));
    expect(view!.chatCorrelation).not.toBeNull();
  });

  it("reports the fixture's free-form Clarifications as an unstructured section", () => {
    // Clarifications carries no closed grammar the writer actually uses — the fixture's entries
    // are multi-line agent/engineer exchanges. Asserting that here records WHY the panel renders
    // that section as markdown: it is not an oversight, there is no line contract to render.
    const clarifications = view!.sections.find((section) => section.heading === "Clarifications");
    expect(clarifications!.body).toContain("Agent:");
    expect(clarifications!.body.split("\n").length).toBeGreaterThan(1);
  });
});
