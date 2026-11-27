// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPANY_ARTIFACTS_MAX_LIMIT } from "@paperclipai/shared";
import { DocumentPopoverPanel } from "./DocumentPopoverPanel";
import { artifactTreePaths } from "./DocumentPanelFileTree";

const mockList = vi.hoisted(() => vi.fn());
vi.mock("../api/artifacts", () => ({ artifactsApi: { list: mockList } }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function artifact(id: string, title: string, identifier = "T-1") {
  return { id, title, issue: { id: "i1", identifier, title: "Task" } };
}

async function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <DocumentPopoverPanel documentKey="plan" onClose={() => {}} companyId="c1" projectId="p1" />
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return root;
}

afterEach(() => {
  document.body.innerHTML = "";
  mockList.mockReset();
});

describe("DocumentPopoverPanel file tree", () => {
  it("lists project artifacts, toggles folders by keyboard and opens a file as a tab", async () => {
    mockList.mockResolvedValue({
      artifacts: [artifact("a1", "budget.xlsx"), artifact("a2", "spec.docx")],
      nextCursor: null,
    });
    await renderPanel();
    expect(mockList).toHaveBeenCalledWith("c1", expect.objectContaining({ projectId: "p1" }));

    const folder = document.querySelector('[data-file-tree-path="T-1"]') as HTMLElement;
    expect(folder).not.toBeNull();
    expect(document.querySelector('[data-file-tree-path="T-1/budget.xlsx"]')).toBeNull();

    await act(async () => {
      folder.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    const file = document.querySelector('[data-file-tree-path="T-1/budget.xlsx"]') as HTMLElement;
    expect(file).not.toBeNull();

    await act(async () => {
      file.click();
    });
    const tab = document.querySelector('[data-testid="document-panel-edit"] [role="tab"]');
    expect(tab?.textContent).toBe("budget.xlsx");

    await act(async () => {
      folder.click();
    });
    expect(document.querySelector('[data-file-tree-path="T-1/budget.xlsx"]')).toBeNull();
  });

  it("requests no more files than the server allows", async () => {
    mockList.mockResolvedValue({ artifacts: [], nextCursor: null });
    await renderPanel();
    const options = mockList.mock.calls[0][1] as { limit: number };
    expect(options.limit).toBeLessThanOrEqual(COMPANY_ARTIFACTS_MAX_LIMIT);
  });

  it("keeps three same-named attachments of one task apart", () => {
    const paths = artifactTreePaths([
      artifact("attachment:11111111-aaaa", "same.docx"),
      artifact("attachment:22222222-bbbb", "same.docx"),
      artifact("attachment:33333333-cccc", "same.docx"),
    ] as never);
    expect(paths.size).toBe(3);
  });

  it("shows an empty message when the project has no artifacts", async () => {
    mockList.mockResolvedValue({ artifacts: [], nextCursor: null });
    await renderPanel();
    expect(document.querySelector('[data-testid="document-panel-file-tree"]')?.textContent).toContain("No artifacts");
  });
});
