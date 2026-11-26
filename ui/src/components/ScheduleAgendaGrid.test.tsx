// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScheduleAgendaGrid } from "./ScheduleAgendaGrid";

describe("ScheduleAgendaGrid resize", () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  afterEach(() => {
    flushSync(() => root?.unmount());
    container?.remove();
    container = null;
    root = null;
  });

  it("calls onResizeItem once, on mouse release, with the final duration", () => {
    const onResizeItem = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const date = new Date(2026, 9, 14);
    const scheduledAt = new Date(2026, 9, 14, 9, 0, 0).toISOString();

    flushSync(() => {
      root!.render(
        <ScheduleAgendaGrid
          date={date}
          startHour={7}
          endHour={20}
          pixelsPerHour={60}
          items={[
            { issueId: "issue-1", identifier: "T-1", title: "Write", status: "todo", scheduledAt, scheduledDurationMinutes: 30 },
          ]}
          onSelectItem={() => {}}
          onResizeItem={onResizeItem}
        />,
      );
    });

    const handle = container.querySelector('[aria-label="Resize duration"]') as HTMLElement;
    expect(handle).not.toBeNull();

    handle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientY: 100 }));
    window.dispatchEvent(new MouseEvent("mousemove", { clientY: 110 }));
    window.dispatchEvent(new MouseEvent("mousemove", { clientY: 120 }));
    window.dispatchEvent(new MouseEvent("mousemove", { clientY: 130 }));
    expect(onResizeItem).not.toHaveBeenCalled();

    window.dispatchEvent(new MouseEvent("mouseup", {}));
    expect(onResizeItem).toHaveBeenCalledTimes(1);
    expect(onResizeItem).toHaveBeenCalledWith("issue-1", 60);
  });

  it("does not call onResizeItem when the mouse is released without moving", () => {
    const onResizeItem = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const scheduledAt = new Date(2026, 9, 14, 9, 0, 0).toISOString();

    flushSync(() => {
      root!.render(
        <ScheduleAgendaGrid
          date={new Date(2026, 9, 14)}
          startHour={7}
          endHour={20}
          items={[
            { issueId: "issue-1", identifier: null, title: "Write", status: "todo", scheduledAt, scheduledDurationMinutes: 30 },
          ]}
          onSelectItem={() => {}}
          onResizeItem={onResizeItem}
        />,
      );
    });

    const handle = container.querySelector('[aria-label="Resize duration"]') as HTMLElement;
    handle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientY: 100 }));
    window.dispatchEvent(new MouseEvent("mouseup", {}));
    expect(onResizeItem).not.toHaveBeenCalled();
  });
});

describe("ScheduleAgendaGrid slot labels", () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  afterEach(() => {
    flushSync(() => root?.unmount());
    container?.remove();
    container = null;
    root = null;
  });

  function renderItems(items: Parameters<typeof ScheduleAgendaGrid>[0]["items"]) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    flushSync(() => {
      root!.render(
        <ScheduleAgendaGrid
          date={new Date(2026, 9, 14)}
          startHour={7}
          endHour={20}
          items={items}
          onSelectItem={() => {}}
        />,
      );
    });
    return container;
  }

  it("shows each task's scheduled time slot, not only its start time", () => {
    const rendered = renderItems([
      {
        issueId: "issue-1",
        identifier: "T-1",
        title: "Write",
        status: "todo",
        scheduledAt: new Date(2026, 9, 14, 9, 0, 0).toISOString(),
        scheduledDurationMinutes: 180,
      },
      {
        issueId: "issue-2",
        identifier: "T-2",
        title: "Review",
        status: "todo",
        scheduledAt: new Date(2026, 9, 14, 12, 30, 0).toISOString(),
        scheduledDurationMinutes: 60,
      },
    ]);

    expect(rendered.textContent).toContain("09:00 - 12:00");
    expect(rendered.textContent).toContain("12:30 - 13:30");
    expect(rendered.textContent).not.toContain("9:00 AM");
  });

  it("marks the running task Ongoing and leaves the others unmarked", () => {
    const rendered = renderItems([
      {
        issueId: "issue-1",
        identifier: "T-1",
        title: "Write",
        status: "todo",
        scheduledAt: new Date(2026, 9, 14, 9, 0, 0).toISOString(),
        scheduledDurationMinutes: 180,
      },
      {
        issueId: "issue-2",
        identifier: "T-2",
        title: "Review",
        status: "in_progress",
        scheduledAt: new Date(2026, 9, 14, 12, 30, 0).toISOString(),
        scheduledDurationMinutes: 60,
      },
    ]);

    const ongoing = Array.from(rendered.querySelectorAll("span")).filter(
      (node) => node.textContent === "Ongoing",
    );
    expect(ongoing).toHaveLength(1);
    expect(rendered.textContent).toContain("Todo");
    expect(rendered.textContent).toContain("In progress");
  });
});
