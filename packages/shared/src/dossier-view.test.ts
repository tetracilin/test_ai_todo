import { describe, expect, it } from "vitest";
import {
  DOSSIER_SECTION_HEADINGS,
  ISSUE_DOSSIER_DOCUMENT_KEY,
  parseDossierChatCorrelationLine,
  parseDossierEvidenceLine,
  parseDossierScopeChangeLine,
  parseDossierView,
} from "./dossier-view.js";
import { isSystemIssueDocumentKey } from "./constants.js";

function dossier(sections: Partial<Record<string, string>> = {}, title = "T3-1 — Test card"): string {
  const blocks = [`# ${title}`];
  for (const heading of DOSSIER_SECTION_HEADINGS) {
    const body = sections[heading]?.trim() ?? "";
    blocks.push(body ? `## ${heading}\n${body}` : `## ${heading}`);
  }
  return `${blocks.join("\n\n")}\n`;
}

describe("parseDossierView", () => {
  it("keeps the dossier out of the system-key hide list", () => {
    // The panel only exists because the dossier is an ordinary card document. Adding its key
    // to SYSTEM_ISSUE_DOCUMENT_KEYS would hide it from the generic documents surface and from
    // company search, so assert the property here too, not only server-side.
    expect(ISSUE_DOSSIER_DOCUMENT_KEY).toBe("dossier");
    expect(isSystemIssueDocumentKey(ISSUE_DOSSIER_DOCUMENT_KEY)).toBe(false);
  });

  it("returns all five sections in contract order, empty ones included", () => {
    const view = parseDossierView(dossier({ "Job order": "Thay bơm định lượng NaOH." }));
    expect(view?.sections.map((section) => section.heading)).toEqual([...DOSSIER_SECTION_HEADINGS]);
    expect(view?.sections.find((section) => section.heading === "Job order")?.body).toBe(
      "Thay bơm định lượng NaOH.",
    );
    // PC-002 AC1: the headings are the contract and the content accrues, so an empty section is
    // a normal state the card has to render — it is how "no evidence filed yet" is visible.
    expect(view?.sections.find((section) => section.heading === "Evidence log")?.body).toBe("");
  });

  it("parses the evidence log and the scope-change timeline", () => {
    const view = parseDossierView(
      dossier({
        "Evidence log": [
          "- 2026-09-01T04:12:08Z · teable · `tblEquipment/recCONC0223` — Bản ghi thiết bị bơm cũ",
          "- 2026-09-02T01:55:00Z · minio · `evidence/T3-1/bao-gia.pdf` — Báo giá đã gửi khách",
        ].join("\n"),
        "Scope changes": "- 2026-09-01T07:22:19Z — Thêm hạng mục thay chân đế.",
      }),
    );
    expect(view?.evidence.complete).toBe(true);
    expect(view?.evidence.entries).toEqual([
      {
        at: "2026-09-01T04:12:08Z",
        providerKey: "teable",
        ref: "tblEquipment/recCONC0223",
        caption: "Bản ghi thiết bị bơm cũ",
      },
      {
        at: "2026-09-02T01:55:00Z",
        providerKey: "minio",
        ref: "evidence/T3-1/bao-gia.pdf",
        caption: "Báo giá đã gửi khách",
      },
    ]);
    expect(view?.scopeChanges.complete).toBe(true);
    expect(view?.scopeChanges.entries).toEqual([
      { at: "2026-09-01T07:22:19Z", note: "Thêm hạng mục thay chân đế." },
    ]);
  });

  it("reports an incomplete section instead of dropping the line it could not parse", () => {
    // The unlink/move correction line (PC-007 AC6) has no grammar yet, and hand-edits happen.
    // Either way the line is a record: the renderer must be told to fall back to raw markdown
    // rather than show a list that is quietly one item short.
    const view = parseDossierView(
      dossier({
        "Evidence log": [
          "- 2026-09-01T04:12:08Z · teable · `tblEquipment/recCONC0223` — Bản ghi thiết bị",
          "- gỡ liên kết nhầm thẻ, đã chuyển sang T3-143",
        ].join("\n"),
      }),
    );
    expect(view?.evidence.complete).toBe(false);
    expect(view?.evidence.entries).toHaveLength(1);
    expect(view?.sections.find((section) => section.heading === "Evidence log")?.body).toContain(
      "gỡ liên kết nhầm thẻ",
    );
  });

  it("undoes the writer's heading escape so captured text reads as it was captured", () => {
    const view = parseDossierView(dossier({ Clarifications: "\\## Báo giá thiết bị" }));
    expect(view?.sections.find((section) => section.heading === "Clarifications")?.body).toBe(
      "## Báo giá thiết bị",
    );
  });

  it("reads the chat correlation from the first Job order line", () => {
    const view = parseDossierView(
      dossier({
        "Job order": [
          "- Source: chat message `1279344401920000512` -> card `T3-142` (origin_kind=`discord`)",
          "- Received: 2026-09-01T02:14:33Z",
        ].join("\n"),
      }),
    );
    expect(view?.chatCorrelation).toEqual({
      chatOriginId: "1279344401920000512",
      issueIdentifier: "T3-142",
      originKind: "discord",
    });
  });

  it("preserves prose written between the title and the first heading", () => {
    const view = parseDossierView(`# T3-1 — Test card\n\nHand-written note.\n\n${dossier().split("\n\n").slice(1).join("\n\n")}`);
    expect(view?.preamble).toBe("Hand-written note.");
  });

  it("returns null for a document that is not a dossier, rather than throwing", () => {
    // A card document under this key can be hand-edited into anything. The panel still has to
    // show it, so "not a dossier" is an outcome the reader reports, never an exception.
    expect(parseDossierView("Just some text, no heading at all.")).toBeNull();
    expect(parseDossierView("# Title\n\n## Job order\n\n## Evidence log\n")).toBeNull();
    expect(parseDossierView(dossier().replace("## Scope changes", "## Scope change"))).toBeNull();
  });
});

describe("dossier line grammars", () => {
  it("rejects a timestamp that is not ISO 8601 UTC", () => {
    expect(parseDossierScopeChangeLine("- yesterday — Thêm hạng mục")).toBeNull();
    expect(parseDossierEvidenceLine("- yesterday · minio · `a/b.pdf` — Báo giá")).toBeNull();
  });

  it("rejects a provider key that is not a provider key", () => {
    expect(parseDossierEvidenceLine("- 2026-09-01T04:12:08Z · MinIO · `a/b.pdf` — Báo giá")).toBeNull();
  });

  it("rejects a correlation line missing any of its three parts", () => {
    expect(parseDossierChatCorrelationLine("- Source: chat message `123` -> card `T3-1`")).toBeNull();
  });
});
