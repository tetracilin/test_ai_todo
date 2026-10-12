// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function TestHarness({
  onNewIssue,
  onSearch,
  onToggleCollapse,
  onGoToInbox,
}: {
  onNewIssue: () => void;
  onSearch?: () => void;
  onToggleCollapse?: () => void;
  onGoToInbox?: () => void;
}) {
  useKeyboardShortcuts({
    enabled: true,
    onNewIssue,
    onSearch,
    onToggleCollapse,
    onGoToInbox,
  });

  return <div>keyboard shortcuts test</div>;
}

describe("useKeyboardShortcuts", () => {
  let container: HTMLDivElement;
  const roots: Root[] = [];

  // Every test mounts through here so a failed assertion cannot leave a root's
  // document-level keydown listener attached for the tests that follow.
  function mount() {
    const root = createRoot(container);
    roots.push(root);
    return root;
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => {
      for (const root of roots.splice(0)) root.unmount();
    });
    document.querySelectorAll("[data-page-search-target]").forEach((node) => node.remove());
    container.remove();
  });

  it("ignores events already claimed by another handler", () => {
    const root = mount();
    const onNewIssue = vi.fn();

    act(() => {
      root.render(<TestHarness onNewIssue={onNewIssue} />);
    });

    const event = new KeyboardEvent("keydown", {
      key: "c",
      bubbles: true,
      cancelable: true,
    });
    event.preventDefault();
    document.dispatchEvent(event);

    expect(onNewIssue).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
  });

  it("focuses the current page search target on slash", () => {
    const root = mount();
    const onSearch = vi.fn();
    const input = document.createElement("input");
    input.setAttribute("data-page-search-target", "true");
    vi.spyOn(input, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
    document.body.appendChild(input);

    act(() => {
      root.render(<TestHarness onNewIssue={vi.fn()} onSearch={onSearch} />);
    });

    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "/",
      bubbles: true,
      cancelable: true,
    }));

    expect(document.activeElement).toBe(input);
    expect(onSearch).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
    input.remove();
  });

  it("falls back to quick search when the page has no search target", () => {
    const root = mount();
    const onSearch = vi.fn();

    act(() => {
      root.render(<TestHarness onNewIssue={vi.fn()} onSearch={onSearch} />);
    });

    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "/",
      bubbles: true,
      cancelable: true,
    }));

    expect(onSearch).toHaveBeenCalledTimes(1);

    act(() => {
      root.unmount();
    });
  });

  it("fires onToggleCollapse on Cmd/Ctrl+B", () => {
    const root = mount();
    const onToggleCollapse = vi.fn();

    act(() => {
      root.render(<TestHarness onNewIssue={vi.fn()} onToggleCollapse={onToggleCollapse} />);
    });

    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "b",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    }));
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "b",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }));
    expect(onToggleCollapse).toHaveBeenCalledTimes(2);

    act(() => {
      root.unmount();
    });
  });

  const pressKey = (key: string) => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    return event;
  };

  it("navigates to the inbox on the g \u2192 i chord", () => {
    const root = mount();
    const onGoToInbox = vi.fn();
    const onNewIssue = vi.fn();

    act(() => {
      root.render(<TestHarness onNewIssue={onNewIssue} onGoToInbox={onGoToInbox} />);
    });

    // Bare "i" does nothing.
    pressKey("i");
    expect(onGoToInbox).not.toHaveBeenCalled();

    pressKey("g");
    const chordEvent = pressKey("i");
    expect(onGoToInbox).toHaveBeenCalledTimes(1);
    expect(chordEvent.defaultPrevented).toBe(true);

    // Chord disarms after firing.
    pressKey("i");
    expect(onGoToInbox).toHaveBeenCalledTimes(1);
    expect(onNewIssue).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
  });

  it("swallows armed chord keys instead of firing bare shortcuts", () => {
    const root = mount();
    const onGoToInbox = vi.fn();
    const onNewIssue = vi.fn();

    act(() => {
      root.render(<TestHarness onNewIssue={onNewIssue} onGoToInbox={onGoToInbox} />);
    });

    // g \u2192 c is the issue-detail focus-comment chord; globally it must not
    // open the new-issue dialog.
    pressKey("g");
    pressKey("c");
    expect(onNewIssue).not.toHaveBeenCalled();
    expect(onGoToInbox).not.toHaveBeenCalled();

    // Bare "c" still creates.
    pressKey("c");
    expect(onNewIssue).toHaveBeenCalledTimes(1);

    act(() => {
      root.unmount();
    });
  });

  it("does not fire onToggleCollapse for a bare 'b' keypress", () => {
    const root = mount();
    const onToggleCollapse = vi.fn();

    act(() => {
      root.render(<TestHarness onNewIssue={vi.fn()} onToggleCollapse={onToggleCollapse} />);
    });

    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "b",
      bubbles: true,
      cancelable: true,
    }));
    expect(onToggleCollapse).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
  });
});
