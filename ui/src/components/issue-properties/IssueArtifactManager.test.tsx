// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IssueArtifactManager } from "./IssueArtifactManager";

const api = vi.hoisted(() => ({
  addArtifactComment: vi.fn(),
  createArtifactEditorSession: vi.fn(),
  listArtifactComments: vi.fn(),
  listArtifactStorageSources: vi.fn(),
  listArtifactVersions: vi.fn(),
  listArtifacts: vi.fn(),
  listExternalArtifactObjects: vi.fn(),
  openArtifact: vi.fn(),
  saveMarkdownArtifact: vi.fn(),
  uploadArtifact: vi.fn(),
  uploadArtifactVersion: vi.fn(),
}));

vi.mock("@/api/issues", () => ({ issuesApi: api }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div data-slot="dialog">{children}</div> : null,
  DialogContent: ({ children, className }: { children: React.ReactNode; className?: string }) => <div data-slot="dialog-content" className={className}>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children, className }: { children: React.ReactNode; className?: string }) => <footer className={className}>{children}</footer>,
  DialogHeader: ({ children, className }: { children: React.ReactNode; className?: string }) => <header className={className}>{children}</header>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

const artifacts = [
  {
    id: "markdown-id", companyId: "company-1", issueId: "issue-1", kind: "document", format: "markdown", name: "notes.md", contentType: "text/markdown",
    currentVersionId: "markdown-v1", currentVersionNumber: 1, createdByUserId: "user-1", createdByAgentId: null, createdAt: "2026-08-29T00:00:00.000Z", updatedAt: "2026-08-29T00:00:00.000Z",
  },
  {
    id: "docx-id", companyId: "company-1", issueId: "issue-1", kind: "document", format: "docx", name: "report.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    currentVersionId: "docx-v1", currentVersionNumber: 1, createdByUserId: "user-1", createdByAgentId: null, createdAt: "2026-08-29T00:00:00.000Z", updatedAt: "2026-08-29T00:00:00.000Z",
  },
  {
    id: "xlsx-id", companyId: "company-1", issueId: "issue-1", kind: "document", format: "xlsx", name: "budget.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    currentVersionId: "xlsx-v1", currentVersionNumber: 1, createdByUserId: "user-1", createdByAgentId: null, createdAt: "2026-08-29T00:00:00.000Z", updatedAt: "2026-08-29T00:00:00.000Z",
  },
  {
    id: "attachment-id", companyId: "company-1", issueId: "issue-1", kind: "attachment", format: null, name: "scan.pdf", contentType: "application/pdf",
    currentVersionId: "attachment-v1", currentVersionNumber: 1, createdByUserId: "user-1", createdByAgentId: null, createdAt: "2026-08-29T00:00:00.000Z", updatedAt: "2026-08-29T00:00:00.000Z",
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

function clickByText(container: HTMLElement, text: string) {
  const button = [...container.querySelectorAll("button")].find((element) => element.textContent?.includes(text));
  expect(button, `button ${text}`).toBeDefined();
  flushSync(() => button!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function clickArtifactAction(container: HTMLElement, artifactName: string, action: string) {
  const name = [...container.querySelectorAll("p")].find((element) => element.textContent === artifactName);
  const artifactRow = name?.parentElement?.parentElement;
  const button = [...(artifactRow?.querySelectorAll("button") ?? [])].find((element) => element.textContent?.includes(action));
  expect(button, `${artifactName} ${action}`).toBeDefined();
  flushSync(() => button!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function renderManager(container: HTMLDivElement) {
  const root = createRoot(container);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  flushSync(() => {
    root.render(<QueryClientProvider client={queryClient}><IssueArtifactManager companyId="company-1" issueId="issue-1" /></QueryClientProvider>);
  });
  return root;
}

describe("IssueArtifactManager", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "# saved Markdown" }));
    HTMLFormElement.prototype.requestSubmit = vi.fn();
    api.listArtifacts.mockResolvedValue({ artifacts });
    api.listArtifactStorageSources.mockResolvedValue({ sources: [{ id: "internal", label: "Internal storage", provider: "local", configured: true }, { id: "external", label: "External storage", provider: "s3", configured: true }] });
    api.listExternalArtifactObjects.mockResolvedValue({ objects: [{ key: "company-1/inbox/brief.docx", name: "brief.docx", byteSize: 2048 }] });
    api.listArtifactVersions.mockImplementation(async (_companyId: string, artifactId: string) => ({ artifact: artifacts.find((artifact) => artifact.id === artifactId), versions: [{ id: `${artifactId}-v1`, versionNumber: 1, versionName: "Draft", isAutomatic: false, byteSize: 24, createdAt: "2026-08-29T00:00:00.000Z" }] }));
    api.listArtifactComments.mockResolvedValue({ comments: [{ id: "comment-1", body: "Document feedback", createdAt: "2026-08-29T00:00:00.000Z" }] });
    api.createArtifactEditorSession.mockResolvedValue({ actionUrl: "https://office.example.test/browser/edit", formParameters: { access_token: "opaque-short-lived-token", access_token_ttl: "123" } });
    api.saveMarkdownArtifact.mockResolvedValue({ id: "markdown-v2" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    container.remove();
  });

  it("offers internal and externally scoped open-file sources", async () => {
    const root = renderManager(container);
    await waitForAssertion(() => expect(container.textContent).toContain("notes.md"));
    clickByText(container, "Open file");
    expect(container.textContent).toContain("Internal storage");
    expect(container.textContent).toContain("External NAS MinIO");
    clickByText(container, "External NAS MinIO");
    await waitForAssertion(() => expect(container.textContent).toContain("brief.docx"));
    expect(api.listExternalArtifactObjects).toHaveBeenCalledWith("company-1", "");
    flushSync(() => root.unmount());
  });

  it("renders Markdown automatic-version UI and document-only comments", async () => {
    const root = renderManager(container);
    await waitForAssertion(() => expect(container.textContent).toContain("notes.md"));
    clickByText(container, "Edit");
    await waitForAssertion(() => expect(container.querySelector("textarea[aria-label='Edit notes.md']")).not.toBeNull());
    expect(container.textContent).toContain("each save creates an automatic version");
    expect(container.textContent).toContain("Comments");
    await waitForAssertion(() => expect(container.textContent).toContain("Document feedback"));
    expect([...container.querySelectorAll("button")].some((button) => button.textContent?.includes("Save automatic version"))).toBe(true);
    flushSync(() => root.unmount());
  });

  it("requires names for DOCX/XLSX and attachment replacement versions without attachment comments", async () => {
    const root = renderManager(container);
    await waitForAssertion(() => expect(container.textContent).toContain("report.docx"));
    clickArtifactAction(container, "report.docx", "Open editor");
    await waitForAssertion(() => expect(container.textContent).toContain("Save new version"));
    const docxInput = container.querySelector("input[placeholder='Required version name']") as HTMLInputElement;
    expect(docxInput).not.toBeNull();
    expect(container.querySelector("input[type='file']")?.getAttribute("accept")).toBe(".docx");
    clickByText(container, "Close");

    clickArtifactAction(container, "budget.xlsx", "Open editor");
    await waitForAssertion(() => expect(container.textContent).toContain("budget.xlsx"));
    expect(container.querySelector("input[type='file']")?.getAttribute("accept")).toBe(".xlsx");
    clickByText(container, "Close");

    clickByText(container, "View versions");
    await waitForAssertion(() => expect(container.textContent).toContain("Attachment-only artifact"));
    expect(container.textContent).toContain("Save new version");
    expect(container.textContent).not.toContain("Document feedback");
    flushSync(() => root.unmount());
  });

  it("requires a user name, posts into the named iframe, and keeps editor geometry uncapped", async () => {
    const root = renderManager(container);
    await waitForAssertion(() => expect(container.textContent).toContain("report.docx"));
    clickByText(container, "Open editor");
    const versionName = container.querySelector("input[aria-label='Version name for OpenOffice save']") as HTMLInputElement;
    const openEditor = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Edit with OpenOffice"));
    expect(versionName).not.toBeNull();
    expect(openEditor).toHaveProperty("disabled", true);
    flushSync(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(versionName, "Legal approval");
      versionName.dispatchEvent(new Event("input", { bubbles: true }));
    });
    clickByText(container, "Edit with OpenOffice");
    await waitForAssertion(() => expect(container.querySelector("iframe")).not.toBeNull());
    expect(api.createArtifactEditorSession).toHaveBeenCalledWith("company-1", "docx-id", "Legal approval");
    const form = container.querySelector("form") as HTMLFormElement;
    const iframe = container.querySelector("[data-testid='artifact-editor-frame']") as HTMLIFrameElement;
    const canvas = container.querySelector("[data-slot='dialog-content']") as HTMLElement;
    const primary = container.querySelector("[data-testid='artifact-editor-primary']") as HTMLElement;
    expect(form.action).toBe("https://office.example.test/browser/edit");
    expect(form.method).toBe("post");
    expect(form.target).toBe(iframe.name);
    expect(form.querySelector("input[name='access_token']")?.getAttribute("value")).toBe("opaque-short-lived-token");
    expect(canvas.className).toContain("w-(--artifact-editor-canvas-w)");
    expect(canvas.className).toContain("h-(--artifact-editor-canvas-h)");
    expect(canvas.className).toContain("sm:!max-w-none");
    expect(primary).not.toBeNull();
    expect(iframe.className).toContain("min-h-0 flex-1");
    flushSync(() => root.unmount());
  });
});
