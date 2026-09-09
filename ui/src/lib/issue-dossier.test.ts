import { describe, expect, it } from "vitest";
import { DOSSIER_SECTION_HEADINGS, parseDossierSections } from "./issue-dossier";

/** The canonical body shape `renderDossierMarkdown` emits, in miniature. */
function renderDossier(sections: Record<string, string>, title = "T3-142 — Replace dosing pump") {
  const blocks = [`# ${title}`];
  for (const heading of DOSSIER_SECTION_HEADINGS) {
    const body = sections[heading] ?? "";
    blocks.push(body ? `## ${heading}\n${body}` : `## ${heading}`);
  }
  return `${blocks.join("\n\n")}\n`;
}

describe("parseDossierSections", () => {
  it("returns the five contract sections in order", () => {
    const parsed = parseDossierSections(
      renderDossier({
        "Job order": "- Source: chat message `1279` -> card `T3-142` (origin_kind=`discord`)",
        "Evidence log": "- 2026-09-02T01:55:00Z · minio · `evidence/T3-142/bao-gia.pdf` — Báo giá",
      }),
    );

    expect(parsed?.title).toBe("T3-142 — Replace dosing pump");
    expect(parsed?.preamble).toBe("");
    expect(parsed?.sections.map((section) => section.heading)).toEqual([...DOSSIER_SECTION_HEADINGS]);
    expect(parsed?.sections[2]?.body).toContain("Báo giá");
    // A section with no content yet is empty, not absent — the headings are the contract.
    expect(parsed?.sections[1]?.body).toBe("");
  });

  it("keeps the preamble the server preserves", () => {
    const parsed = parseDossierSections(renderDossier({}).replace("\n\n## Job order", "\n\nForwarded verbatim.\n\n## Job order"));
    expect(parsed?.preamble).toBe("Forwarded verbatim.");
  });

  it("unescapes a captured line the server escaped so it would not read as a heading", () => {
    const parsed = parseDossierSections(
      renderDossier({ Clarifications: "Khách gửi lại đầu trang báo giá cũ:\n\\## Báo giá thiết bị" }),
    );
    expect(parsed?.sections[1]?.body).toBe("Khách gửi lại đầu trang báo giá cũ:\n## Báo giá thiết bị");
    expect(parsed?.sections).toHaveLength(DOSSIER_SECTION_HEADINGS.length);
  });

  it("returns null for a body that is not in the canonical shape", () => {
    expect(parseDossierSections("Just some notes, no headings at all.")).toBeNull();
    expect(parseDossierSections("# Title\n\n## Job order\nonly one section")).toBeNull();
    expect(
      parseDossierSections(renderDossier({}).replace("## Related Teable rows", "## Related rows")),
    ).toBeNull();
  });
});
