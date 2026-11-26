// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryMapTree } from "@paperclipai/shared";
import { StoryMapBacklog } from "./StoryMapBacklog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const companyState = vi.hoisted(() => ({ selectedCompanyId: "company-1" as string | null }));
const breadcrumbState = vi.hoisted(() => ({ setBreadcrumbs: vi.fn() }));
const storyMapApiMock = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("../context/CompanyContext", () => ({ useCompany: () => companyState }));
vi.mock("../context/BreadcrumbContext", () => ({ useBreadcrumbs: () => breadcrumbState }));
vi.mock("../api/storyMap", () => ({ storyMapApi: storyMapApiMock }));

const NOW = new Date("2026-11-26T00:00:00Z");
const base = { companyId: "company-1", mapId: "map-1", createdAt: NOW, updatedAt: NOW };
const story = (
  id: string,
  title: string,
  epicId: string | null,
  releaseId: string | null,
  status: "planned" | "in_progress" | "done",
  position: number,
) => ({
  ...base,
  id,
  taskId: "t1",
  epicId,
  releaseId,
  title,
  description: null,
  acceptanceCriteria: null,
  size: null,
  status,
  position,
});

const tree: StoryMapTree = {
  map: null,
  activities: [{ ...base, id: "a1", name: "Plan work", position: 0 }],
  tasks: [{ ...base, id: "t1", activityId: "a1", name: "Create project", position: 0 }],
  releases: [{ ...base, id: "r1", name: "Release 1", targetDate: null, position: 0 }],
  epics: [{ ...base, id: "e1", taskId: "t1", name: "Project templates", description: null, position: 0 }],
  stories: [
    story("s1", "Pick a template", "e1", "r1", "planned", 0),
    story("s2", "Save as template", "e1", null, "done", 1),
  ],
};

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("Product backlog page", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  async function render(data: StoryMapTree) {
    storyMapApiMock.get.mockResolvedValue(data);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <StoryMapBacklog />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await flush();
  }

  async function choose(label: string, value: string) {
    const select = container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
      setter.call(select, value);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  const text = () => container.textContent ?? "";

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    companyState.selectedCompanyId = "company-1";
    storyMapApiMock.get.mockReset();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("lists the tree as activity, task, epic, then stories in order", async () => {
    await render(tree);
    const order = ["Plan work", "Create project", "Project templates", "Pick a template", "Save as template"].map(
      (name) => text().indexOf(name),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(container.querySelector('[data-testid="backlog-count"]')?.textContent).toBe("2 stories");
  });

  it("shows each story's release and status", async () => {
    await render(tree);
    expect(text()).toContain("Release 1");
    expect(text()).toContain("Unscheduled");
    expect(text()).toContain("Planned");
    expect(text()).toContain("Done");
  });

  it("filters by release", async () => {
    await render(tree);
    await choose("Filter by release", "r1");
    expect(text()).toContain("Pick a template");
    expect(text()).not.toContain("Save as template");

    await choose("Filter by release", "unscheduled");
    expect(text()).toContain("Save as template");
    expect(text()).not.toContain("Pick a template");
  });

  it("filters by status and says so when nothing matches", async () => {
    await render(tree);
    await choose("Filter by status", "done");
    expect(text()).toContain("Save as template");
    expect(text()).not.toContain("Pick a template");

    await choose("Filter by status", "in_progress");
    expect(text()).toContain("No stories match these filters.");
  });

  it("resets the filters when the company changes, so a stale release id cannot hide every story", async () => {
    await render(tree);
    await choose("Filter by release", "r1");
    expect(text()).not.toContain("Save as template");

    companyState.selectedCompanyId = "company-2";
    await render({ ...tree, releases: [] });
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="Filter by release"]')!.value).toBe("all");
    expect(text()).toContain("Pick a template");
    expect(text()).toContain("Save as template");
  });

  it("shows an empty message for a map with nothing in it", async () => {
    await render({ map: null, activities: [], tasks: [], releases: [], epics: [], stories: [] });
    expect(text()).toContain("The backlog is empty");
  });

  it("links to both views", async () => {
    await render(tree);
    const hrefs = [...container.querySelectorAll("nav a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/story-map", "/story-map/backlog"]);
  });

  it("asks to select a company when none is selected", async () => {
    companyState.selectedCompanyId = null;
    await render(tree);
    expect(text()).toContain("Select a company");
    expect(storyMapApiMock.get).not.toHaveBeenCalled();
  });
});
