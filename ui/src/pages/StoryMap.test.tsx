// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryMapTree } from "@paperclipai/shared";
import { StoryMap } from "./StoryMap";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const companyState = vi.hoisted(() => ({ selectedCompanyId: "company-1" as string | null }));
const breadcrumbState = vi.hoisted(() => ({ setBreadcrumbs: vi.fn() }));
const storyMapApiMock = vi.hoisted(() => ({
  get: vi.fn(),
  createActivity: vi.fn(),
  updateActivity: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  createRelease: vi.fn(),
  updateRelease: vi.fn(),
  createEpic: vi.fn(),
  updateEpic: vi.fn(),
  createStory: vi.fn(),
  updateStory: vi.fn(),
}));

vi.mock("../context/CompanyContext", () => ({ useCompany: () => companyState }));
vi.mock("../context/BreadcrumbContext", () => ({ useBreadcrumbs: () => breadcrumbState }));
vi.mock("../api/storyMap", () => ({ storyMapApi: storyMapApiMock }));

const NOW = new Date("2026-11-26T00:00:00Z");
const base = { companyId: "company-1", mapId: "map-1", createdAt: NOW, updatedAt: NOW };
const story = {
  ...base,
  epicId: null,
  description: null,
  acceptanceCriteria: null,
  size: null,
  status: "planned" as const,
};

const fullTree: StoryMapTree = {
  map: { id: "map-1", companyId: "company-1", name: "Story map", createdAt: NOW, updatedAt: NOW },
  activities: [{ ...base, id: "a1", name: "Plan work", position: 0 }],
  tasks: [
    { ...base, id: "t1", activityId: "a1", name: "Create project", position: 0 },
    { ...base, id: "t2", activityId: "a1", name: "Invite team", position: 1 },
  ],
  releases: [{ ...base, id: "r1", name: "Release 1", targetDate: "2026-12-31", position: 0 }],
  epics: [{ ...base, id: "e1", taskId: "t1", name: "Project templates", description: null, position: 0 }],
  stories: [
    { ...story, id: "s1", taskId: "t1", epicId: "e1", releaseId: "r1", title: "Pick a template", position: 0 },
    { ...story, id: "s2", taskId: "t1", releaseId: null, title: "Save as template", position: 0 },
  ],
};

const emptyTree: StoryMapTree = { map: null, activities: [], tasks: [], releases: [], epics: [], stories: [] };

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function setValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("Story map page", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  async function render(tree: StoryMapTree) {
    storyMapApiMock.get.mockResolvedValue(tree);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <StoryMap />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await flush();
  }

  const byLabel = (label: string) => container.querySelector<HTMLElement>(`[aria-label="${label}"]`);

  async function click(label: string) {
    const element = byLabel(label);
    expect(element, label).not.toBeNull();
    await act(async () => {
      element!.click();
    });
  }

  async function typeInto(label: string, value: string) {
    const input = byLabel(label) as HTMLInputElement | null;
    expect(input, label).not.toBeNull();
    await act(async () => setValue(input!, value));
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    companyState.selectedCompanyId = "company-1";
    for (const mock of Object.values(storyMapApiMock)) mock.mockReset();
    breadcrumbState.setBreadcrumbs.mockReset();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("draws the backbone left to right and the release rows with an Unscheduled row last", async () => {
    await render(fullTree);

    const text = container.textContent ?? "";
    expect(text.indexOf("Create project")).toBeGreaterThan(-1);
    expect(text.indexOf("Create project")).toBeLessThan(text.indexOf("Invite team"));
    expect(text).toContain("Project templates");
    expect(text).toContain("31 Dec 2026");

    const rows = [...container.querySelectorAll('[role="row"]')].map((row) => row.getAttribute("aria-label"));
    expect(rows).toEqual(["Release 1", "Unscheduled"]);

    const release = byLabel("Release 1")!;
    const unscheduled = byLabel("Unscheduled")!;
    expect(release.textContent).toContain("Pick a template");
    expect(release.textContent).not.toContain("Save as template");
    expect(unscheduled.textContent).toContain("Save as template");
    expect(release.textContent).toContain("Project templates");
  });

  it("asks for a first activity when the map is empty", async () => {
    await render(emptyTree);
    expect(container.textContent).toContain("No activities yet");
    expect(byLabel("Add activity")).not.toBeNull();
  });

  it("adds an activity", async () => {
    storyMapApiMock.createActivity.mockResolvedValue({});
    await render(emptyTree);

    await click("Add activity");
    await typeInto("Add activity: name", "Plan work");
    await act(async () => {
      container.querySelector("form")!.requestSubmit();
    });

    expect(storyMapApiMock.createActivity).toHaveBeenCalledWith("company-1", { name: "Plan work" });
  });

  it("adds a release with a target date", async () => {
    storyMapApiMock.createRelease.mockResolvedValue({});
    await render(fullTree);

    await click("Add release");
    await typeInto("Add release: name", "Release 2");
    await typeInto("Add release: target date", "2027-03-01");
    await act(async () => {
      container.querySelector("form")!.requestSubmit();
    });

    expect(storyMapApiMock.createRelease).toHaveBeenCalledWith("company-1", {
      name: "Release 2",
      targetDate: "2027-03-01",
    });
  });

  it("adds a story to the clicked task and release, or to none for Unscheduled", async () => {
    storyMapApiMock.createStory.mockResolvedValue({});
    await render(fullTree);

    await click("Add story to Invite team in Release 1");
    await typeInto("Add story to Invite team in Release 1: name", "Send invites");
    await act(async () => {
      container.querySelector("form")!.requestSubmit();
    });
    expect(storyMapApiMock.createStory).toHaveBeenLastCalledWith("company-1", {
      taskId: "t2",
      title: "Send invites",
      releaseId: "r1",
    });

    await click("Add story to Create project in Unscheduled");
    await typeInto("Add story to Create project in Unscheduled: name", "Later idea");
    await act(async () => {
      container.querySelector("form")!.requestSubmit();
    });
    expect(storyMapApiMock.createStory).toHaveBeenLastCalledWith("company-1", {
      taskId: "t1",
      title: "Later idea",
      releaseId: null,
    });
  });

  it("adds a task under an activity and an epic under a task", async () => {
    storyMapApiMock.createTask.mockResolvedValue({});
    storyMapApiMock.createEpic.mockResolvedValue({});
    await render(fullTree);

    await click("Add task to Plan work");
    await typeInto("Add task to Plan work: name", "Set budget");
    await act(async () => {
      container.querySelector("form")!.requestSubmit();
    });
    expect(storyMapApiMock.createTask).toHaveBeenCalledWith("company-1", { activityId: "a1", name: "Set budget" });

    await click("Add epic to Invite team");
    await typeInto("Add epic to Invite team: name", "Roles");
    await act(async () => {
      container.querySelector("form")!.requestSubmit();
    });
    expect(storyMapApiMock.createEpic).toHaveBeenCalledWith("company-1", { taskId: "t2", name: "Roles" });
  });

  it("renames an item in place and saves on Enter", async () => {
    storyMapApiMock.updateTask.mockResolvedValue({});
    await render(fullTree);

    await click("Rename task Create project");
    await typeInto("Name of task Create project", "Start project");
    await act(async () => {
      byLabel("Name of task Create project")!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(storyMapApiMock.updateTask).toHaveBeenCalledWith("company-1", "t1", { name: "Start project" });
  });

  it("does not save a rename that was cancelled with Escape", async () => {
    await render(fullTree);

    await click("Rename activity Plan work");
    await typeInto("Name of activity Plan work", "Changed");
    await act(async () => {
      byLabel("Name of activity Plan work")!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(storyMapApiMock.updateActivity).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Plan work");
  });

  it("asks to select a company when none is selected", async () => {
    companyState.selectedCompanyId = null;
    await render(emptyTree);
    expect(container.textContent).toContain("Select a company");
    expect(storyMapApiMock.get).not.toHaveBeenCalled();
  });
});
