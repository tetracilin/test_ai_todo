// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryMapTree } from "@paperclipai/shared";
import { StoryDetailPanel, type DetailTarget } from "./StoryDetailPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Render the sheet inline (no radix portal) so the form is reachable in jsdom.
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div>{children}</div> : null),
  SheetContent: ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div>,
  SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  SheetDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));

const NOW = new Date("2026-11-26T00:00:00Z");
const base = { companyId: "c", mapId: "m", createdAt: NOW, updatedAt: NOW };
const storyBase = { ...base, taskId: "t1", description: null, acceptanceCriteria: null, size: null, status: "planned" as const };

const tree: StoryMapTree = {
  map: null,
  activities: [],
  tasks: [{ ...base, id: "t1", activityId: "a1", name: "Create project", position: 0 }],
  releases: [{ ...base, id: "r1", name: "Release 1", targetDate: null, position: 0 }],
  epics: [
    { ...base, id: "e1", taskId: "t1", name: "Project templates", description: "All about templates", position: 0 },
    { ...base, id: "e2", taskId: "t1", name: "Sharing", description: null, position: 1 },
  ],
  stories: [
    { ...storyBase, id: "s1", epicId: "e1", releaseId: "r1", title: "Pick a template", description: "Choose one", size: "M", position: 0 },
    { ...storyBase, id: "s2", epicId: "e1", releaseId: null, title: "Save as template", status: "done" as const, position: 1 },
    { ...storyBase, id: "s3", epicId: null, releaseId: null, title: "Loose story", position: 2 },
  ],
};

describe("StoryDetailPanel", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const onSaveStory = vi.fn();
  const onSaveEpic = vi.fn();
  const onClose = vi.fn();

  async function render(target: DetailTarget | null) {
    await act(async () => {
      root.render(
        <StoryDetailPanel
          tree={tree}
          target={target}
          onClose={onClose}
          onSaveStory={onSaveStory}
          onSaveEpic={onSaveEpic}
        />,
      );
    });
  }

  function field(label: string) {
    const labelEl = [...container.querySelectorAll("label")].find((l) => l.textContent?.startsWith(label));
    return labelEl!.querySelector("input, textarea, select") as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  }

  async function setField(label: string, value: string) {
    const el = field(label);
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : el instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    await act(async () => {
      Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
      el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
    });
  }

  async function submit() {
    await act(async () => {
      container.querySelector("form")!.requestSubmit();
    });
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    onSaveStory.mockReset();
    onSaveEpic.mockReset();
    onClose.mockReset();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("shows nothing when no item is open", async () => {
    await render(null);
    expect(container.textContent).toBe("");
  });

  it("shows the saved details of a story", async () => {
    await render({ kind: "story", id: "s1" });
    expect((field("Title") as HTMLInputElement).value).toBe("Pick a template");
    expect((field("Description") as HTMLTextAreaElement).value).toBe("Choose one");
    expect((field("Size") as HTMLSelectElement).value).toBe("M");
    expect((field("Status") as HTMLSelectElement).value).toBe("planned");
    expect((field("Epic") as HTMLSelectElement).value).toBe("e1");
  });

  it("saves the edited fields of a story", async () => {
    await render({ kind: "story", id: "s1" });
    await setField("Description", "Choose a template for the project");
    await setField("Acceptance criteria", "The project uses the chosen template");
    await setField("Size", "L");
    await setField("Status", "in_progress");
    await setField("Epic", "e2");
    await submit();

    expect(onSaveStory).toHaveBeenCalledWith("s1", {
      title: "Pick a template",
      description: "Choose a template for the project",
      acceptanceCriteria: "The project uses the chosen template",
      size: "L",
      status: "in_progress",
      epicId: "e2",
    });
  });

  it("turns empty fields into null and refuses an empty title", async () => {
    await render({ kind: "story", id: "s1" });
    await setField("Description", "   ");
    await setField("Size", "");
    await setField("Epic", "");
    await submit();
    expect(onSaveStory).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ description: null, acceptanceCriteria: null, size: null, epicId: null }),
    );

    onSaveStory.mockReset();
    await setField("Title", "  ");
    await submit();
    expect(onSaveStory).not.toHaveBeenCalled();
  });

  it("lists the child stories of an epic with release and status", async () => {
    await render({ kind: "epic", id: "e1" });
    const children = container.querySelector('[aria-label="Child stories"]')!;
    expect(children.textContent).toContain("Child stories (2)");
    expect(children.textContent).toContain("Pick a template");
    expect(children.textContent).toContain("Release 1");
    expect(children.textContent).toContain("Save as template");
    expect(children.textContent).toContain("Unscheduled");
    expect(children.textContent).toContain("Done");
    expect(children.textContent).not.toContain("Loose story");
  });

  it("says so when an epic has no stories, and saves the epic", async () => {
    await render({ kind: "epic", id: "e2" });
    expect(container.textContent).toContain("No stories in this epic yet.");
    await setField("Epic name", "Sharing and export");
    await setField("Description", "Share the project");
    await submit();
    expect(onSaveEpic).toHaveBeenCalledWith("e2", { name: "Sharing and export", description: "Share the project" });
  });

  it("handles an item that was deleted while the panel was open", async () => {
    await render({ kind: "story", id: "gone" });
    expect(container.textContent).toContain("no longer exists");
  });
});
