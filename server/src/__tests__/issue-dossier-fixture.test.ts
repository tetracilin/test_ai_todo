import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isSystemIssueDocumentKey } from "@paperclipai/shared";
import type { IssueEvidenceLinkRow } from "../services/issue-evidence-links.js";
import {
  DOSSIER_SECTION_HEADINGS,
  ISSUE_DOSSIER_DOCUMENT_KEY,
  createSeededDossier,
  evidenceLineFromLink,
  formatChatCorrelationLine,
  formatEvidenceLine,
  formatScopeChangeLine,
  parseChatCorrelation,
  parseDossierMarkdown,
  parseEvidenceLine,
  parseEvidenceLog,
  parseScopeChanges,
  renderDossierMarkdown,
  toDossierTimestamp,
} from "../services/issue-dossier.js";

// PC-002 AC5: one checked-in example dossier, shared by its three consumers — the agent that
// writes it, the markdown export that emits it verbatim, and the CTO retrieval test. These
// assertions are what stop the three drifting apart.
const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixturePath = path.join(fixturesDir, "dossier-example.md");
const fixture = readFileSync(fixturePath, "utf8");

describe("dossier example fixture", () => {
  it("is stored on disk with LF line endings, like everything the renderer emits", () => {
    // The byte-for-byte round trip below is the lane's one load-bearing guarantee, and it is
    // only meaningful if the checked-out bytes are the bytes an export would write. With
    // core.autocrlf=true (the Windows default) a checkout rewrites this file as CRLF unless
    // .gitattributes pins it — `server/src/__tests__/fixtures/** text eol=lf` does. Reading
    // the raw bytes here is what makes the pin fail loudly instead of silently regressing.
    const raw = readFileSync(fixturePath);
    expect(raw.includes(0x0d)).toBe(false);
    expect(raw.includes(0x0a)).toBe(true);
  });

  it("is stored under the non-system document key the card UI renders", () => {
    expect(ISSUE_DOSSIER_DOCUMENT_KEY).toBe("dossier");
    // Deliberately NOT in SYSTEM_ISSUE_DOCUMENT_KEYS: that list is a hide-list, and adding
    // "dossier" to it would drop the dossier out of company search, company artifacts and
    // pipeline case outputs — breaking PC-002 AC4 and the CTO retrieval test. Assert the
    // property, not just the string, so that one-line edit fails here.
    expect(isSystemIssueDocumentKey(ISSUE_DOSSIER_DOCUMENT_KEY)).toBe(false);
  });

  it("carries exactly the PC-002 AC1 sections, in order", () => {
    const document = parseDossierMarkdown(fixture);
    expect(Object.keys(document.sections)).toEqual([...DOSSIER_SECTION_HEADINGS]);
    expect(document.title).toBe("T3-142 — Replace NaOH dosing pump #2, Bình Dương wastewater plant");
  });

  it("round-trips byte for byte through the section contract", () => {
    // The identity is the contract: a writer that renders and a reader that parses cannot
    // disagree about blank lines, heading depth or trailing newline.
    expect(renderDossierMarkdown(parseDossierMarkdown(fixture))).toBe(fixture);
  });

  it("keeps captured content verbatim Vietnamese", () => {
    const document = parseDossierMarkdown(fixture);
    expect(document.sections["Job order"]).toContain("Bơm định lượng NaOH số 2 ở trạm Bình Dương bị rò trục");
    expect(document.sections.Clarifications).toContain("Tương đương được, miễn đầu bơm PVDF");
  });

  it("exposes a machine-readable chat-message-id ↔ card correlation line", () => {
    const document = parseDossierMarkdown(fixture);
    const correlation = parseChatCorrelation(document);
    expect(correlation).toEqual({
      chatOriginId: "1279344401920000512",
      issueIdentifier: "T3-142",
      originKind: "discord",
    });
    // The same three fields are what `issues.origin_kind` / `issues.origin_id` hold, so the
    // reverse lookup (chat event -> card) is an index hit, not a text search.
    expect(formatChatCorrelationLine(correlation!)).toBe(document.sections["Job order"].split("\n")[0]);
  });

  it("keeps the evidence-log line shape stable across providers", () => {
    const entries = parseEvidenceLog(parseDossierMarkdown(fixture));
    expect(entries.map((entry) => entry.providerKey)).toEqual(["teable", "nas", "minio", "git"]);
    expect(entries[0]).toEqual({
      at: "2026-09-01T04:12:08Z",
      providerKey: "teable",
      ref: "tblEquipment/recCONC0223",
      caption: "Bản ghi thiết bị bơm cũ, serial 2019-CONC-0442",
    });
    // PC-007 AC3 / AD-021: the NAS entry records a path reference only — no bytes leave NAS.
    expect(entries[1]!.ref.startsWith("//nas-t3/")).toBe(true);
    // format and parse must be inverses, or an appended line stops being readable.
    for (const entry of entries) expect(parseEvidenceLine(formatEvidenceLine(entry))).toEqual(entry);
  });

  it("uses the reference shape the PC-007 write path actually stores", () => {
    // Drift guard for the two lanes that must agree: `ref` is `external_objects.external_id`
    // verbatim. The typed shape below is a Pick of PC-007's own row type, so a rename there
    // fails typecheck here; the assertion pins the byte shape against the fixture.
    const nasLink: Pick<IssueEvidenceLinkRow, "providerKey" | "externalId" | "createdAt"> = {
      providerKey: "nas",
      externalId: "//nas-t3/plant-binhduong/confidential/pid/WWTP-BD-PID-rev4.pdf",
      // A real row's timestamp carries milliseconds; the grammar is second-precision.
      createdAt: new Date("2026-09-01T06:40:21.482Z"),
    };
    const line = evidenceLineFromLink(
      nasLink,
      "P&ID rev4, chỉ ghi đường dẫn tham chiếu, không tải bytes ra khỏi NAS",
    );
    expect(line.ref).toBe(nasLink.externalId);
    expect(line.at).toBe("2026-09-01T06:40:21Z");
    const fixtureLine = parseDossierMarkdown(fixture).sections["Evidence log"].split("\n")[1];
    expect(formatEvidenceLine(line)).toBe(fixtureLine);
    expect(toDossierTimestamp("2026-09-02T01:55:00.000Z")).toBe("2026-09-02T01:55:00Z");
  });

  it("re-renders every evidence line exactly as it appears in the fixture", () => {
    const section = parseDossierMarkdown(fixture).sections["Evidence log"].split("\n");
    const entries = parseEvidenceLog(parseDossierMarkdown(fixture));
    expect(entries).toHaveLength(section.length);
    for (const [index, entry] of entries.entries()) expect(formatEvidenceLine(entry)).toBe(section[index]);
  });

  it("timestamps every scope change so the replanning-latency signal is queryable", () => {
    // PC-002 AC2/AC3. Timestamps are ISO 8601 UTC and appear in ascending document order.
    const changes = parseScopeChanges(parseDossierMarkdown(fixture));
    expect(changes).toHaveLength(2);
    expect(changes.map((change) => change.at)).toEqual(["2026-09-01T07:22:19Z", "2026-09-02T03:48:05Z"]);
    const timestamps = changes.map((change) => Date.parse(change.at));
    expect(timestamps.every((value) => Number.isFinite(value))).toBe(true);
    expect([...timestamps].sort((a, b) => a - b)).toEqual(timestamps);
    expect(changes[0]!.note).toContain("Thêm hạng mục thay chân đế và ống hút PVC");
    for (const [index, change] of changes.entries()) {
      expect(formatScopeChangeLine(change)).toBe(parseDossierMarkdown(fixture).sections["Scope changes"].split("\n")[index]);
    }
  });

  it("rejects a dossier that drops or reorders a section", () => {
    const withoutScopeChanges = fixture.replace(/\n## Scope changes\n[\s\S]*?(?=\n## )/, "");
    expect(() => parseDossierMarkdown(withoutScopeChanges)).toThrow(/Dossier sections must be exactly/);
    const reordered = renderDossierMarkdown(parseDossierMarkdown(fixture))
      .replace("## Clarifications", "## Scope changes ")
      .replace("## Scope changes\n-", "## Clarifications\n-");
    expect(() => parseDossierMarkdown(reordered)).toThrow(/Dossier sections must be exactly/);
  });

  it("rejects an evidence or scope-change timestamp that is not ISO 8601 UTC", () => {
    expect(() =>
      formatEvidenceLine({ at: "2026-09-01 04:12", providerKey: "teable", ref: "x", caption: "y" }),
    ).toThrow(/ISO 8601 UTC/);
    expect(() => formatScopeChangeLine({ at: "hôm qua", note: "y" })).toThrow(/ISO 8601 UTC/);
  });
});

describe("dossier section contract", () => {
  it("represents a freshly seeded card, whose sections are empty but present", () => {
    // PC-002 AC1 + PC-004 AC1: at intake there is a job order and nothing else. All five
    // headings still have to be there, so an empty body is legal and the seeding path never
    // invents a placeholder line the other consumers would each have to know about.
    const seeded = createSeededDossier({
      title: "T3-143 — Thay van bướm DN200 tuyến nước thải",
      jobOrder: formatChatCorrelationLine({
        chatOriginId: "1279344401920000513",
        issueIdentifier: "T3-143",
        originKind: "discord",
      }),
    });
    const body = renderDossierMarkdown(seeded);
    expect(body).toContain("## Clarifications\n\n## Evidence log\n\n## Scope changes\n\n## Related Teable rows\n");
    const parsed = parseDossierMarkdown(body);
    expect(Object.keys(parsed.sections)).toEqual([...DOSSIER_SECTION_HEADINGS]);
    expect(parsed.sections.Clarifications).toBe("");
    expect(parseEvidenceLog(parsed)).toEqual([]);
    expect(parseScopeChanges(parsed)).toEqual([]);
    expect(parseChatCorrelation(parsed)?.issueIdentifier).toBe("T3-143");
    expect(renderDossierMarkdown(parsed)).toBe(body);
  });

  it("survives captured content whose own lines look like section headings", () => {
    // AD-034 captures messages verbatim, so a forwarded quote sheet headed `## Báo giá` is a
    // legitimate body. Rendered raw it would produce a sixth section and every later read of
    // the card would 422 with no recovery. The escape is reversible, so the round trip holds.
    const document = parseDossierMarkdown(fixture);
    const captured = '## Báo giá\n# Công ty TNHH Cấp Thoát Nước Bình Dương\n## Evidence log';
    const withCapture = {
      ...document,
      sections: { ...document.sections, Clarifications: `${document.sections.Clarifications}\n${captured}` },
    };
    const body = renderDossierMarkdown(withCapture);
    const reparsed = parseDossierMarkdown(body);
    expect(Object.keys(reparsed.sections)).toEqual([...DOSSIER_SECTION_HEADINGS]);
    expect(reparsed.sections.Clarifications.endsWith(captured)).toBe(true);
    expect(renderDossierMarkdown(reparsed)).toBe(body);
    // Already-escaped text keeps its own backslash rather than being silently unescaped.
    const preEscaped = { ...document, sections: { ...document.sections, "Related Teable rows": "\\## literal" } };
    expect(parseDossierMarkdown(renderDossierMarkdown(preEscaped)).sections["Related Teable rows"]).toBe("\\## literal");
    // The fixture itself carries one, so the shared example documents the mechanism.
    expect(fixture).toContain("\\## Báo giá thiết bị");
  });

  it("escapes only what parseDossierMarkdown would read as a section heading", () => {
    // The parser's section test is `line.startsWith("## ")` and nothing else, so nothing else
    // may be escaped: a `### Chi tiết khảo sát` sub-heading an agent writes into Clarifications
    // has to reach the card UI and the markdown export as itself (PC-002 AC4), not as a literal
    // `\###`. A broader escape is cosmetic damage on every line it touches and fixes no brick.
    const document = parseDossierMarkdown(fixture);
    const untouched = [
      "### Chi tiết khảo sát",
      "# Công ty TNHH Cấp Thoát Nước Bình Dương",
      "###### h6",
      "####### bảy dấu thăng",
      "#nospace",
      "##",
      "  ## thụt lề",
      "> ## trong trích dẫn",
    ];
    // `## ` with nothing after it still satisfies startsWith("## ") and so still bricks the
    // parser; it is kept off the end of the block because a section body is trimmed as a whole.
    const escapedOnly = ["## Báo giá", "## ", "##  hai khoảng trắng"];
    const captured = [...untouched, ...escapedOnly].join("\n");
    const body = renderDossierMarkdown({
      ...document,
      sections: { ...document.sections, Clarifications: captured },
    });
    for (const line of untouched) expect(body).toContain(`\n${line}\n`);
    for (const line of escapedOnly) expect(body).toContain(`\n\\${line}\n`);

    // Narrowing must not cost the bijection: parse still recovers every line verbatim, and
    // both round-trip identities still hold, including for already-backslashed input.
    const reparsed = parseDossierMarkdown(body);
    expect(reparsed.sections.Clarifications).toBe(captured);
    expect(renderDossierMarkdown(reparsed)).toBe(body);
    const backslashed = ["\\## Báo giá", "\\\\## Báo giá", "\\### phụ đề", "\\# H1", "\\##"].join("\n");
    const withBackslashes = renderDossierMarkdown({
      ...document,
      sections: { ...document.sections, "Related Teable rows": backslashed },
    });
    const backReparsed = parseDossierMarkdown(withBackslashes);
    expect(backReparsed.sections["Related Teable rows"]).toBe(backslashed);
    expect(renderDossierMarkdown(backReparsed)).toBe(withBackslashes);
  });

  it("rejects a caption or note that cannot fit on its one line", () => {
    // PC-007 AC5 is "every linkage appends ONE line". A newline used to render a second line
    // the parser could not see, so the entry existed on the card and nowhere in the counts.
    expect(() =>
      formatEvidenceLine({
        at: "2026-09-02T01:00:00Z",
        providerKey: "minio",
        ref: "evidence/x.pdf",
        caption: "Báo giá\nĐã gửi khách",
      }),
    ).toThrow(/single line/);
    expect(() => formatScopeChangeLine({ at: "2026-09-02T01:00:00Z", note: "a\nb" })).toThrow(/single line/);
    expect(() =>
      formatEvidenceLine({ at: "2026-09-02T01:00:00Z", providerKey: "minio", ref: "evidence/x.pdf", caption: "  " }),
    ).toThrow(/caption is required/);
    expect(() => formatScopeChangeLine({ at: "2026-09-02T01:00:00Z", note: " " })).toThrow(/note is required/);
  });

  it("raises on a malformed scope-change entry instead of dropping it from the count", () => {
    // PC-002 AC3 reads these timestamps as the CTO's replanning-latency signal, and the bullet
    // grammar of this section is closed, so a silently skipped bullet reads as a true low number.
    const document = parseDossierMarkdown(fixture);
    const withLooseTimestamp = {
      ...document,
      sections: {
        ...document.sections,
        "Scope changes": `${document.sections["Scope changes"]}\n- 2026-09-03 05:00 — khách đổi phạm vi lần 3`,
      },
    };
    expect(() => parseScopeChanges(withLooseTimestamp)).toThrow(/scope-change entry is malformed/);
    // Non-bullet prose around the entries stays allowed — only a bullet claims to be an entry.
    const withProse = {
      ...document,
      sections: { ...document.sections, "Scope changes": `Ghi chú chung.\n${document.sections["Scope changes"]}` },
    };
    expect(parseScopeChanges(withProse)).toHaveLength(2);
  });

  it("keeps the Evidence log readable when it carries a bullet that is not an AC5 line", () => {
    // Deliberate asymmetry with Scope changes above. PC-007 AC6 puts the unlink/move correction
    // line in this same section, and that grammar is not EVIDENCE_LINE_RE and is not specified
    // yet. If an unrecognised bullet raised here, the first unlink on a card would 422 every
    // later read of it — the export, the CTO retrieval test, the next AC5 append — with no
    // recovery short of hand-editing documents.latestBody. So it is skipped, not raised on, and
    // the four real filing acts still come back.
    const document = parseDossierMarkdown(fixture);
    const baseline = parseEvidenceLog(document);
    expect(baseline).toHaveLength(4);
    const corrections = [
      "- 2026-09-02T08:15:00Z — gỡ liên kết: `evidence/y.pdf` nộp nhầm sang thẻ T3-143",
      "- Correction: moved minio evidence/y.pdf to T3-143",
      "- minio evidence/y.pdf",
    ];
    for (const correction of corrections) {
      const withCorrection = {
        ...document,
        sections: { ...document.sections, "Evidence log": `${document.sections["Evidence log"]}\n${correction}` },
      };
      expect(parseEvidenceLog(withCorrection)).toEqual(baseline);
    }
    // All three at once, and the document still renders and re-parses unchanged around them.
    const withAll = {
      ...document,
      sections: {
        ...document.sections,
        "Evidence log": `${document.sections["Evidence log"]}\n${corrections.join("\n")}`,
      },
    };
    expect(parseEvidenceLog(withAll)).toEqual(baseline);
    const body = renderDossierMarkdown(withAll);
    expect(parseEvidenceLog(parseDossierMarkdown(body))).toEqual(baseline);
    expect(parseDossierMarkdown(body).sections["Evidence log"]).toBe(withAll.sections["Evidence log"]);
  });

  it("preserves prose between the title and the first section", () => {
    // The first consumer to append an evidence line will do it as parse -> mutate -> render.
    // If the parser forgot the preamble, that append would silently delete it.
    const withPreamble = renderDossierMarkdown({
      ...parseDossierMarkdown(fixture),
      preamble: "Tóm tắt do agent viết trước khi mở hồ sơ.",
    });
    expect(withPreamble).toContain("\n\nTóm tắt do agent viết trước khi mở hồ sơ.\n\n## Job order");
    const reparsed = parseDossierMarkdown(withPreamble);
    expect(reparsed.preamble).toBe("Tóm tắt do agent viết trước khi mở hồ sơ.");
    expect(renderDossierMarkdown(reparsed)).toBe(withPreamble);
    // Anything ABOVE the title has nowhere to live, so it raises rather than disappearing.
    expect(() => parseDossierMarkdown(`stray line\n\n${fixture}`)).toThrow(/content before its title/);
  });

  it("rejects a backtick or newline in any interpolated correlation field", () => {
    // All three land between backticks, so an unguarded one forges the line: the reader sees
    // the card attributed to T3-999 and the parser sees nothing at all.
    expect(() =>
      formatChatCorrelationLine({
        chatOriginId: "1` -> card `T3-999",
        issueIdentifier: "T3-142",
        originKind: "discord",
      }),
    ).toThrow(/cannot contain a backtick/);
    expect(() =>
      formatChatCorrelationLine({ chatOriginId: "1", issueIdentifier: "T3-142`", originKind: "discord" }),
    ).toThrow(/cannot contain a backtick/);
    expect(() =>
      formatChatCorrelationLine({ chatOriginId: "1", issueIdentifier: "T3-142", originKind: "dis\ncord" }),
    ).toThrow(/single line/);
  });
});
