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

describe("DocumentPopoverPanel tabs", () => {
  const tabs = () => [...document.querySelectorAll('[data-testid="document-panel-edit"] [role="tab"]')];
  const click = async (selector: string) => {
    await act(async () => {
      (document.querySelector(selector) as HTMLElement).click();
    });
  };
  const key = async (el: Element, name: string) => {
    await act(async () => {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
    });
  };
  async function openFiles(names: string[], unsavedIds?: Set<string>, onClose: () => void = () => {}) {
    mockList.mockResolvedValue({
      artifacts: [artifact("a1", "budget.xlsx"), artifact("a2", "spec.docx")],
      nextCursor: null,
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = document.createElement("div");
    document.body.appendChild(container);
    await act(async () => {
      createRoot(container).render(
        <QueryClientProvider client={queryClient}>
          <DocumentPopoverPanel documentKey="plan" onClose={onClose} companyId="c1" projectId="p1" unsavedIds={unsavedIds} />
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await click('[data-file-tree-path="T-1"]');
    for (const name of names) await click('[data-file-tree-path="T-1/' + name + '"]');
  }

  it("does not open a second tab for an open file and shows its name in the pane", async () => {
    await openFiles(["budget.xlsx", "spec.docx", "budget.xlsx"]);
    expect(tabs().map((t) => t.textContent)).toEqual(["budget.xlsx", "spec.docx"]);
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector('[data-testid="document-panel-edit"] .mt-3')?.textContent).toBe("budget.xlsx");
  });

  it("closes a tab with the close control and with the Delete key", async () => {
    await openFiles(["budget.xlsx", "spec.docx"]);
    await click('[aria-label="Close budget.xlsx"]');
    expect(tabs().map((t) => t.textContent)).toEqual(["spec.docx"]);
    await key(tabs()[0], "Delete");
    expect(tabs()).toHaveLength(0);
  });

  it("moves between tabs with the arrow keys", async () => {
    await openFiles(["budget.xlsx", "spec.docx"]);
    await key(tabs()[1], "ArrowRight");
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
  });

  it("asks before closing a tab with unsaved changes", async () => {
    await openFiles(["budget.xlsx"], new Set(["a1"]));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await click('[aria-label="Close budget.xlsx"]');
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(tabs()).toHaveLength(1);
    confirm.mockReturnValue(true);
    await click('[aria-label="Close budget.xlsx"]');
    expect(tabs()).toHaveLength(0);
    confirm.mockRestore();
  });

  it("keeps the active tab when Delete on an unsaved tab is cancelled", async () => {
    await openFiles(["budget.xlsx", "spec.docx"], new Set(["a1"]));
    await click('[data-tab-id="a1"]');
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await key(tabs()[0], "Delete");
    expect(tabs()).toHaveLength(2);
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
    confirm.mockRestore();
  });

  it("asks before closing the panel with an unsaved tab", async () => {
    const onClose = vi.fn();
    await openFiles(["budget.xlsx"], new Set(["a1"]), onClose);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const dialog = document.querySelector('[data-testid="document-popover-panel"]') as HTMLElement;
    await key(dialog, "Escape");
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(tabs()).toHaveLength(1);
    confirm.mockReturnValue(true);
    await key(dialog, "Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
    confirm.mockRestore();
  });
});
