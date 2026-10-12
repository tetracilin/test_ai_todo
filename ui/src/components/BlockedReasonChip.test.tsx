// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BlockedReasonChip } from "./BlockedReasonChip";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("BlockedReasonChip", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("renders the canonical group label and exposes severity via aria-label", () => {
    const root = createRoot(container);
    act(() => {
      root.render(
        <BlockedReasonChip reason="pending_board_decision" severity="high" />,
      );
    });
    const chip = container.querySelector('[data-testid="blocked-reason-chip"]');
    expect(chip).not.toBeNull();
    expect(chip?.getAttribute("data-variant")).toBe("needs_decision");
    expect(chip?.getAttribute("data-severity")).toBe("high");
    expect(chip?.getAttribute("aria-label")).toBe("Reason: Needs decision, severity high");
    expect(chip?.textContent).toContain("Needs decision");
    act(() => {
      root.unmount();
    });
  });

  it("includes a severity dot for critical and high but not medium/low", () => {
    // The dot is the only severity-coloured span; the icon is an svg, so the
    // dot is identified by its colour class rather than by aria-hidden alone.
    const cases: Array<["critical" | "high" | "medium" | "low", string | null]> = [
      ["critical", "bg-red-500"],
      ["high", "bg-orange-500"],
      ["medium", null],
      ["low", null],
    ];
    for (const [severity, dotClass] of cases) {
      const local = document.createElement("div");
      document.body.appendChild(local);
      const root = createRoot(local);
      act(() => {
        root.render(<BlockedReasonChip reason="blocked_chain_stalled" severity={severity} />);
      });
      const chip = local.querySelector('[data-testid="blocked-reason-chip"]');
      const dot = chip?.querySelector('span[aria-hidden="true"]');
      if (dotClass) {
        expect(dot, `${severity} dot`).not.toBeNull();
        expect(dot?.className).toContain(dotClass);
      } else {
        expect(dot, `${severity} dot`).toBeNull();
      }
      act(() => {
        root.unmount();
      });
      local.remove();
    }
  });

  it("hides the icon when compact is true", () => {
    const root = createRoot(container);
    act(() => {
      root.render(
        <BlockedReasonChip reason="external_owner_action" severity="low" compact />,
      );
    });
    const chip = container.querySelector('[data-testid="blocked-reason-chip"]');
    const svg = chip?.querySelector("svg");
    expect(svg).toBeNull();
    act(() => {
      root.unmount();
    });
  });
});
