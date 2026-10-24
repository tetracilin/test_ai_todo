// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import { IssueEvidenceLinkManager } from "./IssueEvidenceLinkManager";

const api = vi.hoisted(() => ({
  listAttachments: vi.fn(),
  listEvidenceLinks: vi.fn(),
  linkEvidence: vi.fn(),
  unlinkEvidence: vi.fn(),
  uploadEvidenceFile: vi.fn(),
}));

// evidence_gate_enabled defaults to FALSE on a real company, so the gate wording is
// conditional. Both states are covered below.
const companies = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@/api/issues", () => ({ issuesApi: api }));
vi.mock("@/api/companies", () => ({ companiesApi: companies }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div data-slot="dialog">{children}</div> : null,
  DialogContent: ({ children, className }: { children: React.ReactNode; className?: string }) => <div data-slot="dialog-content" className={className}>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children, className }: { children: React.ReactNode; className?: string }) => <footer className={className}>{children}</footer>,
  DialogHeader: ({ children, className }: { children: React.ReactNode; className?: string }) => <header className={className}>{children}</header>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

const links = [
  {
    id: "link-1", companyId: "company-1", issueId: "issue-1", externalObjectId: "object-1", source: "manual", createdAt: "2026-09-01T00:00:00.000Z",
    providerKey: "git", objectType: "commit", externalId: "a1b2c3d4e5f6", displayTitle: "commit a1b2c3d4e5f6", sanitizedCanonicalUrl: "https://github.com/org/repo/commit/a1b2c3d4e5f6",
    liveness: "unknown", statusCategory: "unknown", statusTone: "neutral", isTerminal: false,
  },
  {
    id: "link-2", companyId: "company-1", issueId: "issue-1", externalObjectId: "object-2", source: "bot", createdAt: "2026-09-01T00:00:00.000Z",
    providerKey: "nas", objectType: "path", externalId: "//nas/evidence/report.pdf", displayTitle: null, sanitizedCanonicalUrl: null,
    liveness: "unknown", statusCategory: "unknown", statusTone: "neutral", isTerminal: false,
  },
] as const;

async function flush() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitForAssertion(assertion: () => void, attempts = 40) {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await flush();
    }
  }
  throw lastError;
}

/** The dialog's submit repeats the trigger's label, so clicks target the LAST match. */
function clickByText(container: HTMLElement, text: string) {
  const buttons = [...container.querySelectorAll("button")].filter((element) => element.textContent?.includes(text));
  expect(buttons.length, `button ${text}`).toBeGreaterThan(0);
  flushSync(() => buttons[buttons.length - 1]!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function typeInto(input: HTMLInputElement, value: string) {
  flushSync(() => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    valueSetter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function renderManager(container: HTMLDivElement) {
  const root = createRoot(container);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  flushSync(() => {
    root.render(<QueryClientProvider client={queryClient}><IssueEvidenceLinkManager companyId="company-1" issueId="issue-1" /></QueryClientProvider>);
  });
  return root;
}

describe("IssueEvidenceLinkManager", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    api.listEvidenceLinks.mockResolvedValue(links);
    api.listAttachments.mockResolvedValue([{ id: "attachment-1" }]);
    api.linkEvidence.mockResolvedValue(links[0]);
    api.unlinkEvidence.mockResolvedValue({ ok: true });
    // gate ON for the two tests that assert done-gate wording; the gate-off case overrides.
    companies.get.mockResolvedValue({ id: "company-1", evidenceGateEnabled: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    container.remove();
  });

  it("lists links with provider and provenance, and counts attachments into the gate total", async () => {
    const root = renderManager(container);
    await waitForAssertion(() => expect(container.textContent).toContain("commit a1b2c3d4e5f6"));
    expect(container.textContent).toContain("Git commit");
    expect(container.textContent).toContain("Manual");
    // No displayTitle falls back to the recorded path, and provenance is per row.
    expect(container.textContent).toContain("//nas/evidence/report.pdf");
    expect(container.textContent).toContain("NAS path");
    expect(container.textContent).toContain("Bot");
    // 2 links + 1 attachment is what `countEvidenceForIssue` sums for the gate.
    await waitForAssertion(() => expect(container.textContent).toContain("3 evidence items counted by the done-gate"));
    flushSync(() => root.unmount());
  });

  it("shows an empty state naming the gate when nothing is filed", async () => {
    api.listEvidenceLinks.mockResolvedValue([]);
    api.listAttachments.mockResolvedValue([]);
    const root = renderManager(container);
    await waitForAssertion(() => expect(container.textContent).toContain("No evidence links."));
    expect(container.textContent).toContain("the done-gate blocks this task");
    flushSync(() => root.unmount());
  });

  // Regression guard: an earlier version asserted done-gate wording unconditionally, so a
  // stock instance -- where companies.evidence_gate_enabled defaults to false -- told every
  // user their task was blocked when nothing blocked it.
  it("stays silent about the gate when the company has not enabled it", async () => {
    companies.get.mockResolvedValue({ id: "company-1", evidenceGateEnabled: false });
    api.listEvidenceLinks.mockResolvedValue([]);
    api.listAttachments.mockResolvedValue([]);
    const root = renderManager(container);
    await waitForAssertion(() => expect(container.textContent).toContain("No evidence yet."));
    expect(container.textContent).not.toContain("done-gate");
    flushSync(() => root.unmount());
  });

  it("omits the gate clause from the count when the gate is off", async () => {
    companies.get.mockResolvedValue({ id: "company-1", evidenceGateEnabled: false });
    const root = renderManager(container);
    await waitForAssertion(() => expect(container.textContent).toContain("evidence items"));
    expect(container.textContent).not.toContain("counted by the done-gate");
    flushSync(() => root.unmount());
  });

  it("surfaces a load failure instead of rendering an empty list", async () => {
    api.listEvidenceLinks.mockRejectedValue(new ApiError("Issue not found", 404, null));
    const root = renderManager(container);
    await waitForAssertion(() => expect(container.textContent).toContain("Issue not found"));
    flushSync(() => root.unmount());
  });

  it("files a commit URL as a verified git descriptor", async () => {
    const root = renderManager(container);
    await waitForAssertion(() => expect(container.textContent).toContain("commit a1b2c3d4e5f6"));
    clickByText(container, "Link evidence");
    const commitInput = container.querySelector("#evidence-commit") as HTMLInputElement;
    expect(commitInput).not.toBeNull();
    typeInto(commitInput, "https://github.com/org/repo/commit/deadbeef1234");
    clickByText(container, "Link evidence");
    await waitForAssertion(() => expect(api.linkEvidence).toHaveBeenCalledWith("issue-1", {
      providerKey: "git",
      objectType: "commit",
      externalId: "deadbeef1234",
      url: "https://github.com/org/repo/commit/deadbeef1234",
    }));
    flushSync(() => root.unmount());
  });

  it("explains that external storage is unconfigured when the upload route replies 501", async () => {
    api.uploadEvidenceFile.mockRejectedValue(
      new ApiError("External evidence storage is not configured for this instance", 501, null),
    );
    const root = renderManager(container);
    await waitForAssertion(() => expect(container.textContent).toContain("commit a1b2c3d4e5f6"));
    clickByText(container, "Link evidence");
    clickByText(container, "Uploaded file");
    const fileInput = container.querySelector("input[type='file']") as HTMLInputElement;
    expect(fileInput).not.toBeNull();
    Object.defineProperty(fileInput, "files", {
      value: [new File(["bytes"], "receipt.pdf", { type: "application/pdf" })],
    });
    flushSync(() => fileInput.dispatchEvent(new Event("change", { bubbles: true })));
    clickByText(container, "Link evidence");
    await waitForAssertion(() =>
      expect(container.textContent).toContain("External evidence storage is not configured on this server"),
    );
    flushSync(() => root.unmount());
  });

  it("removes a link through the audited unlink route", async () => {
    const root = renderManager(container);
    await waitForAssertion(() => expect(container.textContent).toContain("commit a1b2c3d4e5f6"));
    const remove = [...container.querySelectorAll("button")].find(
      (button) => button.getAttribute("aria-label") === "Remove evidence commit a1b2c3d4e5f6",
    );
    expect(remove).toBeDefined();
    flushSync(() => remove!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await waitForAssertion(() => expect(api.unlinkEvidence).toHaveBeenCalledWith("issue-1", "link-1"));
    flushSync(() => root.unmount());
  });
});
