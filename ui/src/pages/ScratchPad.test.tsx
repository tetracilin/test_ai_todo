// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScratchNoteList, ScratchNoteView } from "@paperclipai/shared";
import { ScratchPad } from "./ScratchPad";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const companyState = vi.hoisted(() => ({ selectedCompanyId: "company-1" as string | null }));
const breadcrumbState = vi.hoisted(() => ({ setBreadcrumbs: vi.fn() }));
const scratchPadApiMock = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  promote: vi.fn(),
  archive: vi.fn(),
}));

vi.mock("../context/CompanyContext", () => ({ useCompany: () => companyState }));
vi.mock("../context/BreadcrumbContext", () => ({ useBreadcrumbs: () => breadcrumbState }));
vi.mock("../api/scratchPad", () => ({ scratchPadApi: scratchPadApiMock }));

const NOW = new Date();
function note(overrides: Partial<ScratchNoteView>): ScratchNoteView {
  return {
    id: "n1",
    companyId: "company-1",
    authorUserId: "me",
    authorName: "Tester",
    body: "Dark mode for the kanban",
    status: "active",
    promotedStoryId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function list(notes: ScratchNoteView[], canModerate = false): ScratchNoteList {
  return { notes, viewerUserId: "me", canModerate };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("Scratch pad page", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  async function render(data: ScratchNoteList) {
    scratchPadApiMock.list.mockResolvedValue(data);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <ScratchPad />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await flush();
  }

  const text = () => container.textContent ?? "";
  const buttons = (scope: ParentNode = container) => [...scope.querySelectorAll("button")];
  const button = (label: string, scope: ParentNode = container) => buttons(scope).find((b) => b.textContent === label);

  async function typeNote(value: string, label = "New note") {
    const area = container.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`)!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, value);
      area.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    companyState.selectedCompanyId = "company-1";
    for (const mock of Object.values(scratchPadApiMock)) mock.mockReset();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("asks not to write client names or confidential material", async () => {
    await render(list([]));
    expect(container.querySelector('[role="note"]')?.textContent).toContain("client names or confidential material");
  });

  it("takes text only: no file or image field", async () => {
    await render(list([note({})]));
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(text().toLowerCase()).not.toContain("attach");
    expect(text().toLowerCase()).not.toContain("upload");
  });

  it("saves a new note and clears the box", async () => {
    scratchPadApiMock.create.mockResolvedValue({});
    await render(list([]));
    await typeNote("Dark mode for the kanban");
    await act(async () => {
      container.querySelector("form")!.requestSubmit();
    });
    expect(scratchPadApiMock.create).toHaveBeenCalledWith("company-1", { body: "Dark mode for the kanban" });
    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="New note"]')!.value).toBe("");
  });

  it("does not save an empty note and caps the text at 2,000 characters", async () => {
    await render(list([]));
    expect(button("Save")!.disabled).toBe(true);
    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="New note"]')!.maxLength).toBe(2000);
    await typeNote("   ");
    expect(button("Save")!.disabled).toBe(true);
  });

  it("keeps the typed note when saving fails, and clears the box only after it is saved", async () => {
    scratchPadApiMock.create.mockRejectedValueOnce(new Error("Could not save the note"));
    await render(list([]));
    await typeNote("An idea worth keeping");
    await act(async () => {
      container.querySelector("form")!.requestSubmit();
    });
    await flush();
    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="New note"]')!.value).toBe("An idea worth keeping");
    expect(text()).toContain("Could not save the note");

    scratchPadApiMock.create.mockResolvedValueOnce({});
    await act(async () => {
      container.querySelector("form")!.requestSubmit();
    });
    await flush();
    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="New note"]')!.value).toBe("");
  });

  it("keeps the editor open with the text when an edit fails", async () => {
    scratchPadApiMock.update.mockRejectedValue(new Error("Edit failed"));
    await render(list([note({})]));
    const card = container.querySelector<HTMLElement>('[data-note-id="n1"]')!;
    await act(async () => button("Edit", card)!.click());
    await typeNote("Changed text", "Edit note");
    await act(async () => button("Save", card)!.click());
    await flush();
    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Edit note"]')!.value).toBe("Changed text");
  });

  it("disables the note editor while its save is pending", async () => {
    let finish!: (value: unknown) => void;
    scratchPadApiMock.update.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await render(list([note({})]));
    const card = container.querySelector<HTMLElement>('[data-note-id="n1"]')!;
    await act(async () => button("Edit", card)!.click());
    await typeNote("Changed text", "Edit note");
    await act(async () => button("Save", card)!.click());

    // Editing is blocked, so text typed after submitting cannot be dropped when
    // the successful save closes the editor.
    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Edit note"]')!.disabled).toBe(true);

    await act(async () => finish({}));
    await flush();
    expect(container.querySelector('textarea[aria-label="Edit note"]')).toBeNull();
  });

  it("does not carry a draft or an open editor into another company", async () => {
    scratchPadApiMock.create.mockResolvedValue({});
    await render(list([note({})]));
    await typeNote("Draft written in company one");
    const card = container.querySelector<HTMLElement>('[data-note-id="n1"]')!;
    await act(async () => button("Edit", card)!.click());
    expect(container.querySelector('textarea[aria-label="Edit note"]')).not.toBeNull();

    companyState.selectedCompanyId = "company-2";
    await render(list([]));
    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="New note"]')!.value).toBe("");
    expect(container.querySelector('textarea[aria-label="Edit note"]')).toBeNull();
    expect(scratchPadApiMock.create).not.toHaveBeenCalled();
  });

  it("saves a note once when Save is pressed twice while the first request is open", async () => {
    scratchPadApiMock.create.mockReturnValue(new Promise(() => undefined));
    await render(list([]));
    await typeNote("One idea");
    await act(async () => {
      container.querySelector("form")!.requestSubmit();
    });
    await act(async () => {
      container.querySelector("form")!.requestSubmit();
    });
    expect(scratchPadApiMock.create).toHaveBeenCalledTimes(1);
    await flush();
    expect(button("Save")!.disabled).toBe(true);
  });

  it("keeps text typed while a save was in flight", async () => {
    let finish!: (value: unknown) => void;
    scratchPadApiMock.create.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await render(list([]));
    await typeNote("First");
    await act(async () => {
      container.querySelector("form")!.requestSubmit();
    });
    await typeNote("First, and more typed meanwhile");
    await act(async () => finish({}));
    await flush();
    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="New note"]')!.value).toBe(
      "First, and more typed meanwhile",
    );
  });

  it("shows each note with its author and time", async () => {
    await render(list([note({})]));
    const card = container.querySelector('[data-note-id="n1"]')!;
    expect(card.textContent).toContain("Dark mode for the kanban");
    expect(card.textContent).toContain("Tester");
    expect(card.querySelector("time")).not.toBeNull();
  });

  it("lets the author edit and delete their own note", async () => {
    scratchPadApiMock.update.mockResolvedValue({});
    scratchPadApiMock.remove.mockResolvedValue({});
    await render(list([note({})]));
    const card = container.querySelector<HTMLElement>('[data-note-id="n1"]')!;

    await act(async () => button("Edit", card)!.click());
    await typeNote("Dark mode for every page", "Edit note");
    await act(async () => button("Save", card)!.click());
    expect(scratchPadApiMock.update).toHaveBeenCalledWith("company-1", "n1", { body: "Dark mode for every page" });

    await act(async () => button("Delete", card)!.click());
    expect(scratchPadApiMock.remove).toHaveBeenCalledWith("company-1", "n1");
  });

  it("gives no Edit or Delete on a note written by someone else", async () => {
    await render(list([note({ id: "n2", authorUserId: "someone-else", authorName: "Ana" })]));
    const card = container.querySelector<HTMLElement>('[data-note-id="n2"]')!;
    expect(button("Edit", card)).toBeUndefined();
    expect(button("Delete", card)).toBeUndefined();
    expect(button("Promote to story", card)).toBeUndefined();
    expect(card.textContent).toContain("Ana");
  });

  it("lets an owner or admin promote or archive an active note", async () => {
    scratchPadApiMock.promote.mockResolvedValue({});
    scratchPadApiMock.archive.mockResolvedValue({});
    await render(list([note({ id: "n3", authorUserId: "someone-else" })], true));
    const card = container.querySelector<HTMLElement>('[data-note-id="n3"]')!;

    await act(async () => button("Promote to story", card)!.click());
    expect(scratchPadApiMock.promote).toHaveBeenCalledWith("company-1", "n3");
    await act(async () => button("Archive", card)!.click());
    expect(scratchPadApiMock.archive).toHaveBeenCalledWith("company-1", "n3");
    // Moderators still cannot edit someone else's text.
    expect(button("Edit", card)).toBeUndefined();
  });

  it("shows that a promoted note was promoted, with a link to the story map", async () => {
    await render(list([note({ status: "promoted", promotedStoryId: "s1" })], true));
    const card = container.querySelector<HTMLElement>('[data-note-id="n1"]')!;
    expect(card.textContent).toContain("Promoted to a story");
    expect(card.querySelector("a")?.getAttribute("href")).toBe("/story-map");
    expect(button("Promote to story", card)).toBeUndefined();
  });

  it("hides archived notes unless a moderator asks to see them", async () => {
    await render(list([note({ id: "n4", status: "archived", body: "Old idea" }), note({ id: "n5", body: "New idea" })], true));
    expect(text()).not.toContain("Old idea");
    expect(text()).toContain("New idea");

    await act(async () => {
      container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    });
    expect(text()).toContain("Old idea");
  });

  it("says when there are no notes, and asks to select a company when none is selected", async () => {
    await render(list([]));
    expect(text()).toContain("No notes yet");

    await act(async () => root.unmount());
    root = createRoot(container);
    companyState.selectedCompanyId = null;
    await render(list([]));
    expect(text()).toContain("Select a company");
  });
});
