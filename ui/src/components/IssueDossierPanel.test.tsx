// @vitest-environment jsdom

import { act } from "react";
import type { ComponentProps, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { IssueDocument } from "@paperclipai/shared";
import { DOSSIER_SECTION_HEADINGS, ISSUE_DOSSIER_DOCUMENT_KEY } from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IssueDossierPanel } from "./IssueDossierPanel";

vi.mock("./MarkdownBody", () => ({
  MarkdownBody: ({ children, className }: { children: string; className?: string }) => (
    <div className={className} data-testid="markdown-body">{children}</div>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, type = "button", ...props }: ComponentProps<"button">) => (
    <button type={type} onClick={onClick} {...props}>{children}</button>
  ),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const FIXTURE_BODY = [
  "# T3-142 — Replace NaOH dosing pump #2",
  "",
  "## Job order",
  "- Source: chat message `1279344401920000512` -> card `T3-142` (origin_kind=`discord`)",
  "- Received: 2026-09-01T02:14:33Z",
  "",
  "## Clarifications",
  '- 2026-09-01T02:31:10Z — Agent: "Bơm số 2 là bơm chạy chính hay bơm dự phòng?"',
  "",
  "## Evidence log",
  "- 2026-09-01T04:12:08Z · teable · `tblEquipment/recCONC0223` — Bản ghi thiết bị bơm cũ",
  "- 2026-09-02T01:55:00Z · minio · `evidence/T3-142/bao-gia.pdf` — Báo giá đã gửi khách",
  "",
  "## Scope changes",
  "- 2026-09-01T07:22:19Z — Thêm hạng mục thay chân đế.",
  "",
  "## Related Teable rows",
  "- `https://teable.example/table/tblEquipment/recCONC0223` — Thiết bị",
  "",
].join("\n");

function dossierDocument(body = FIXTURE_BODY): IssueDocument {
  return {
    id: "document-dossier",
    companyId: "company-1",
    issueId: "issue-1",
    key: ISSUE_DOSSIER_DOCUMENT_KEY,
    title: "Dossier",
    format: "markdown",
    body,
    latestRevisionId: "revision-7",
    latestRevisionNumber: 7,
    createdByAgentId: "agent-1",
    createdByUserId: null,
    updatedByAgentId: "agent-1",
    updatedByUserId: null,
    lockedAt: null,
    lockedByAgentId: null,
    lockedByUserId: null,
    createdAt: new Date("2026-09-01T02:14:33.000Z"),
    updatedAt: new Date("2026-09-02T01:55:00.000Z"),
  };
}

describe("IssueDossierPanel", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  function render(node: ReactNode) {
    const root = createRoot(container);
    act(() => {
      root.render(node);
    });
    return root;
  }

  function expand() {
    const toggle = container.querySelector<HTMLButtonElement>('button[aria-expanded="false"]');
    act(() => {
      toggle!.click();
    });
  }

  it("renders nothing when the card has no dossier", () => {
    // Only the chat-intake path seeds one, so most cards legitimately have none and the panel
    // must not leave an empty frame behind on every other card in the product.
    render(<IssueDossierPanel document={null} />);
    expect(container.querySelector('[data-testid="issue-dossier-panel"]')).toBeNull();
  });

  it("shows the evidence and scope-change counts without being expanded", () => {
    render(<IssueDossierPanel document={dossierDocument()} />);
    const text = container.textContent ?? "";
    expect(text).toContain("2 evidence");
    expect(text).toContain("1 scope change");
    // Collapsed is the default: the card is dense, and the counts are the at-a-glance answer.
    expect(container.querySelector('button[aria-expanded="false"]')).toBeTruthy();
    expect(text).not.toContain("Bản ghi thiết bị bơm cũ");
  });

  it("does not claim the generic documents surface's anchor id", () => {
    // `IssueDocumentsSection` renders this same document under id `document-dossier`. Two
    // elements sharing that id would break its deep links and scroll-to behaviour.
    render(<IssueDossierPanel document={dossierDocument()} />);
    expect(container.querySelector(`#document-${ISSUE_DOSSIER_DOCUMENT_KEY}`)).toBeNull();
    expect(container.querySelector("#issue-dossier-panel")).toBeTruthy();
  });

  it("renders every PC-002 section heading when expanded, empty ones included", () => {
    render(<IssueDossierPanel document={dossierDocument()} />);
    expand();
    const text = container.textContent ?? "";
    for (const heading of DOSSIER_SECTION_HEADINGS) {
      expect(text).toContain(heading);
    }
  });

  it("renders evidence entries with provider, reference and verbatim caption", () => {
    render(<IssueDossierPanel document={dossierDocument()} />);
    expand();
    const text = container.textContent ?? "";
    expect(text).toContain("teable");
    expect(text).toContain("tblEquipment/recCONC0223");
    // Captured content stays verbatim Vietnamese — never translated, never truncated.
    expect(text).toContain("Bản ghi thiết bị bơm cũ");
    expect(text).toContain("Thêm hạng mục thay chân đế.");
    const timestamps = container.querySelectorAll("time");
    expect(timestamps.length).toBe(3);
    // The exact stored string is always recoverable, whatever the locale renders.
    expect(Array.from(timestamps).map((node) => node.getAttribute("dateTime"))).toContain(
      "2026-09-01T04:12:08Z",
    );
  });

  it("shows the chat message the card came from", () => {
    render(<IssueDossierPanel document={dossierDocument()} />);
    expect(container.textContent).toContain("discord message 1279344401920000512");
  });

  it("falls back to raw markdown for a section it cannot fully parse", () => {
    // One unparseable line must not turn into one missing evidence item.
    const body = FIXTURE_BODY.replace(
      "- 2026-09-02T01:55:00Z · minio · `evidence/T3-142/bao-gia.pdf` — Báo giá đã gửi khách",
      "- gỡ liên kết nhầm thẻ, đã chuyển sang T3-143",
    );
    render(<IssueDossierPanel document={dossierDocument(body)} />);
    expand();
    const markdownBlocks = Array.from(container.querySelectorAll('[data-testid="markdown-body"]'));
    expect(markdownBlocks.some((node) => node.textContent?.includes("gỡ liên kết nhầm thẻ"))).toBe(true);
    expect(markdownBlocks.some((node) => node.textContent?.includes("Bản ghi thiết bị bơm cũ"))).toBe(true);
  });

  it("renders a hand-edited document as plain markdown instead of failing", () => {
    render(<IssueDossierPanel document={dossierDocument("Someone replaced this with a note.")} />);
    expand();
    expect(container.textContent).toContain("Someone replaced this with a note.");
  });
});
