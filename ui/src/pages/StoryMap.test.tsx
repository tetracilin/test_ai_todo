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
  move: vi.fn(),
}));

const dndState = vi.hoisted(() => ({ onDragEnd: null as null | ((event: unknown) => void) }));

vi.mock("../context/CompanyContext", () => ({ useCompany: () => companyState }));
vi.mock("../context/BreadcrumbContext", () => ({ useBreadcrumbs: () => breadcrumbState }));
const scratchPadApiMock = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock("../api/storyMap", () => ({ storyMapApi: storyMapApiMock }));
vi.mock("../api/scratchPad", () => ({ scratchPadApi: scratchPadApiMock }));

// Render the menu inline (no radix portal) so menu items are clickable in jsdom.
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onSelect,
    disabled,
  }: {
    children: React.ReactNode;
    onSelect?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" disabled={disabled} data-menu-item onClick={onSelect}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div>{children}</div> : null),
  SheetContent: ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div>,
  SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  SheetDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));

// Keep the real drag hooks, but let the test call the drop handler directly.
vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    DndContext: ({ children, onDragEnd }: { children: React.ReactNode; onDragEnd: (event: unknown) => void }) => {
      dndState.onDragEnd = onDragEnd;
      return <actual.DndContext>{children}</actual.DndContext>;
    },
  };
});

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

let scratchNotes: unknown = { notes: [], viewerUserId: "me", canModerate: false };

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
    scratchPadApiMock.list.mockResolvedValue(scratchNotes);
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
    scratchNotes = { notes: [], viewerUserId: "me", canModerate: false };
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

  function menuItem(scopeLabel: string, text: string) {
    const scope = byLabel(scopeLabel)!.closest("[data-drag-key]")!;
    return [...scope.querySelectorAll<HTMLButtonElement>("[data-menu-item]")].find((b) => b.textContent === text);
  }

  it("moves a task left or right from its menu, and disables a move at the end", async () => {
    storyMapApiMock.move.mockResolvedValue({});
    await render(fullTree);

    // "Create project" is first: it cannot move left, but it can move right (before the one after next, so the end).
    expect(menuItem("Rename task Create project", "Move left")?.disabled).toBe(true);
    await act(async () => menuItem("Rename task Create project", "Move right")!.click());
    expect(storyMapApiMock.move).toHaveBeenCalledWith("company-1", "tasks", "t1", { beforeId: null });

    // "Invite team" is last: move left puts it before "Create project".
    await act(async () => menuItem("Rename task Invite team", "Move left")!.click());
    expect(storyMapApiMock.move).toHaveBeenLastCalledWith("company-1", "tasks", "t2", { beforeId: "t1" });
    expect(menuItem("Rename task Invite team", "Move right")?.disabled).toBe(true);
  });

  it("moves an activity from its menu", async () => {
    storyMapApiMock.move.mockResolvedValue({});
    await render({
      ...fullTree,
      activities: [...fullTree.activities, { ...base, id: "a2", name: "Review work", position: 1 }],
    });
    await act(async () => menuItem("Rename activity Review work", "Move left")!.click());
    expect(storyMapApiMock.move).toHaveBeenCalledWith("company-1", "activities", "a2", { beforeId: "a1" });
  });

  it("moves a story to a release or back to Unscheduled from its menu", async () => {
    storyMapApiMock.move.mockResolvedValue({});
    await render(fullTree);

    // "Save as template" sits in Unscheduled: Release 1 is open to it, Unscheduled is its own row.
    expect(menuItem("Rename story Save as template", "Unscheduled")?.disabled).toBe(true);
    await act(async () => menuItem("Rename story Save as template", "Release 1")!.click());
    expect(storyMapApiMock.move).toHaveBeenCalledWith("company-1", "stories", "s2", { releaseId: "r1" });

    await act(async () => menuItem("Rename story Pick a template", "Unscheduled")!.click());
    expect(storyMapApiMock.move).toHaveBeenLastCalledWith("company-1", "stories", "s1", { releaseId: null });
  });

  it("saves a drop: dragging a task onto the one before it moves it in front", async () => {
    storyMapApiMock.move.mockResolvedValue({});
    await render(fullTree);

    await act(async () => {
      dndState.onDragEnd!({ active: { id: "task:t2" }, over: { id: "task:t1" } });
    });
    expect(storyMapApiMock.move).toHaveBeenCalledWith("company-1", "tasks", "t2", { beforeId: "t1" });
  });

  it("saves a drop of a story on a cell as a release change, and ignores a drop on nothing", async () => {
    storyMapApiMock.move.mockResolvedValue({});
    await render(fullTree);

    await act(async () => {
      dndState.onDragEnd!({ active: { id: "story:s2" }, over: { id: "cell:t1|r1" } });
    });
    expect(storyMapApiMock.move).toHaveBeenCalledWith("company-1", "stories", "s2", { releaseId: "r1" });

    storyMapApiMock.move.mockClear();
    await act(async () => {
      dndState.onDragEnd!({ active: { id: "story:s2" }, over: null });
    });
    expect(storyMapApiMock.move).not.toHaveBeenCalled();
  });

  it("opens a story in the detail panel, saves it and closes the panel", async () => {
    storyMapApiMock.updateStory.mockResolvedValue({});
    await render(fullTree);

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await click("Open story Pick a template");
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();

    const description = [...container.querySelectorAll("label")]
      .find((l) => l.textContent?.startsWith("Description"))!
      .querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(description, "Choose one");
      description.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector('[role="dialog"] form')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(storyMapApiMock.updateStory).toHaveBeenCalledWith(
      "company-1",
      "s1",
      expect.objectContaining({ title: "Pick a template", description: "Choose one", epicId: "e1" }),
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("opens an epic and lists its stories", async () => {
    await render(fullTree);
    await click("Open epic Project templates");
    const dialog = container.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Epic details");
    expect(dialog.textContent).toContain("Pick a template");
  });

  it("links a story promoted from the scratch pad back to the scratch pad", async () => {
    scratchNotes = {
      notes: [{ id: "n1", authorUserId: "me", authorName: "Tester", body: "x", status: "promoted", promotedStoryId: "s2", createdAt: NOW, updatedAt: NOW, companyId: "company-1" }],
      viewerUserId: "me",
      canModerate: true,
    };
    await render(fullTree);
    const links = [...container.querySelectorAll("a")].filter((a) => a.textContent === "From scratch pad");
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute("href")).toBe("/scratch-pad");
    expect(links[0]!.closest("[data-drag-key]")?.getAttribute("data-drag-key")).toBe("story:s2");
  });

  it("keeps what was typed when a save fails, and clears it when the save works", async () => {
    storyMapApiMock.createActivity.mockRejectedValueOnce(new Error("Server said no"));
    await render(emptyTree);

    await click("Add activity");
    await typeInto("Add activity: name", "Plan work");
    await act(async () => {
      container.querySelector("form")!.requestSubmit();
    });
    await flush();
    // The form is still open and still holds the text; the error is shown.
    expect((byLabel("Add activity: name") as HTMLInputElement).value).toBe("Plan work");
    expect(container.textContent).toContain("Server said no");

    storyMapApiMock.createActivity.mockResolvedValueOnce({});
    await act(async () => {
      container.querySelector("form")!.requestSubmit();
    });
    await flush();
    expect(byLabel("Add activity: name")).toBeNull();
  });

  it("keeps the rename box open with its text when the rename fails", async () => {
    storyMapApiMock.updateTask.mockRejectedValue(new Error("Rename failed"));
    await render(fullTree);
    await click("Rename task Create project");
    await typeInto("Name of task Create project", "Start project");
    await act(async () => {
      byLabel("Name of task Create project")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await flush();
    expect((byLabel("Name of task Create project") as HTMLInputElement).value).toBe("Start project");
  });

  it("keeps the detail panel open when saving a story fails", async () => {
    storyMapApiMock.updateStory.mockRejectedValue(new Error("Could not save"));
    await render(fullTree);
    await click("Open story Pick a template");
    await act(async () => {
      container.querySelector('[role="dialog"] form')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.textContent).toContain("Could not save");
  });

  it("asks to select a company when none is selected", async () => {
    companyState.selectedCompanyId = null;
    await render(emptyTree);
    expect(container.textContent).toContain("Select a company");
    expect(storyMapApiMock.get).not.toHaveBeenCalled();
  });
});
