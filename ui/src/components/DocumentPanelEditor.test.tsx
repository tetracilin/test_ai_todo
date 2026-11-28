// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentPanelEditor } from "./DocumentPanelEditor";

const api = vi.hoisted(() => ({
  listDocuments: vi.fn(),
  getDocument: vi.fn(),
  upsertDocument: vi.fn(),
}));
vi.mock("../api/issues", () => ({ issuesApi: api }));
vi.mock("./MarkdownEditor", () => ({
  MarkdownEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea data-testid="md" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const artifact = { id: "document:d1", title: "plan", issue: { id: "i1", identifier: "T-1", title: "Task" } } as never;
const doc = { id: "d1", key: "plan", title: null, format: "markdown", body: "old", latestRevisionId: "r1" };

async function setup(onDirtyChange = vi.fn()) {
  api.listDocuments.mockResolvedValue([doc]);
  api.getDocument.mockResolvedValue(doc);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(
      <QueryClientProvider client={queryClient}>
        <DocumentPanelEditor artifact={artifact} onDirtyChange={onDirtyChange} />
      </QueryClientProvider>,
    );
  });
  // The document list and then the document load one after the other.
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  return onDirtyChange;
}

async function type(value: string) {
  const el = document.querySelector('[data-testid="md"]') as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const saveButton = () => [...document.querySelectorAll("button")].find((b) => b.textContent === "Save") as HTMLButtonElement;

afterEach(() => {
  document.body.innerHTML = "";
  Object.values(api).forEach((fn) => fn.mockReset());
});

describe("DocumentPanelEditor", () => {
  it("reports unsaved changes and saves a new revision on top of the latest one", async () => {
    const onDirty = await setup();
    expect(saveButton().disabled).toBe(true);
    await type("new");
    expect(onDirty).toHaveBeenLastCalledWith("document:d1", true);
    api.upsertDocument.mockResolvedValue({ ...doc, body: "new", latestRevisionId: "r2" });
    await act(async () => saveButton().click());
    expect(api.upsertDocument).toHaveBeenCalledWith("i1", "plan", expect.objectContaining({ format: "markdown", body: "new", baseRevisionId: "r1" }));
    expect(onDirty).toHaveBeenLastCalledWith("document:d1", false);
  });

  it("shows a save error in the panel and keeps the changes", async () => {
    const onDirty = await setup();
    await type("new");
    api.upsertDocument.mockRejectedValue(new Error("Conflict"));
    await act(async () => saveButton().click());
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("Conflict");
    expect((document.querySelector('[data-testid="md"]') as HTMLTextAreaElement).value).toBe("new");
    expect(onDirty).toHaveBeenLastCalledWith("document:d1", true);
  });
});
