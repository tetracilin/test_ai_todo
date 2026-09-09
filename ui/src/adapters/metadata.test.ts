import { afterEach, describe, expect, it } from "vitest";
import {
  isEnabledAdapterType,
  isValidAdapterType,
  isVisualAdapterChoice,
  listAdapterOptions,
  listSelectableAdapterOptions,
} from "./metadata";
import { setSelectableAdapterTypes } from "./selectable-store";
import type { UIAdapterModule } from "./types";

const externalAdapter: UIAdapterModule = {
  type: "external_test",
  label: "External Test",
  parseStdoutLine: () => [],
  ConfigFields: () => null,
  buildAdapterConfig: () => ({}),
};

const agentAdapters: UIAdapterModule[] = [
  externalAdapter,
  { ...externalAdapter, type: "claude_local" },
  { ...externalAdapter, type: "hermes_gateway" },
];

describe("adapter metadata", () => {
  // The selectable store is module state hydrated from GET /api/adapters.
  afterEach(() => setSelectableAdapterTypes(null));

  it("treats registered external adapters as enabled by default", () => {
    expect(isEnabledAdapterType("external_test")).toBe(true);

    expect(
      listAdapterOptions((type) => type, [externalAdapter]),
    ).toEqual([
      {
        value: "external_test",
        label: "external_test",
        comingSoon: false,
        hidden: false,
        experimental: false,
      },
    ]);
  });

  it("offers exactly the adapters the server reports as selectable", () => {
    setSelectableAdapterTypes(["hermes_gateway", "claude_local"]);

    expect(
      listSelectableAdapterOptions((type) => type, agentAdapters).map(
        (option) => option.value,
      ),
    ).toEqual(["claude_local", "hermes_gateway"]);
    expect(isValidAdapterType("hermes_gateway")).toBe(true);
    expect(isValidAdapterType("claude_local")).toBe(true);
    // Registered but not offered by this instance — the server decides, not
    // the presence of a UI adapter module.
    expect(isValidAdapterType("external_test")).toBe(false);
  });

  it("narrows to the server's own default before the adapter list arrives", () => {
    // Nothing hydrated yet: match `listSelectableServerAdapters()`'s fallback
    // rather than offering every registered adapter.
    expect(
      listSelectableAdapterOptions((type) => type, agentAdapters).map(
        (option) => option.value,
      ),
    ).toEqual(["hermes_gateway"]);
    expect(isValidAdapterType("claude_local")).toBe(false);
  });

  it("still withholds coming-soon adapters the server offers", () => {
    setSelectableAdapterTypes(["hermes_gateway", "openclaw_gateway"]);

    expect(isValidAdapterType("openclaw_gateway")).toBe(false);
    expect(
      listSelectableAdapterOptions((type) => type, [
        { ...externalAdapter, type: "openclaw_gateway" },
        { ...externalAdapter, type: "hermes_gateway" },
      ]).map((option) => option.value),
    ).toEqual(["hermes_gateway"]);
  });

  it("keeps intentionally withheld built-in adapters marked as coming soon", () => {
    expect(isEnabledAdapterType("process")).toBe(false);
    expect(isEnabledAdapterType("http")).toBe(false);
  });

  it("marks the retired ACPX adapter as unavailable for new selections", () => {
    // Even a stale PAPERCLIP_SELECTABLE_ADAPTER_TYPES entry cannot revive it.
    setSelectableAdapterTypes(["hermes_gateway", "acpx_local"]);

    expect(isEnabledAdapterType("acpx_local")).toBe(false);
    expect(isValidAdapterType("acpx_local")).toBe(false);
    expect(isVisualAdapterChoice("acpx_local")).toBe(false);

    expect(
      listAdapterOptions((type) => type, [
        {
          ...externalAdapter,
          type: "acpx_local",
        },
      ]),
    ).toEqual([
      {
        value: "acpx_local",
        label: "acpx_local",
        comingSoon: true,
        hidden: false,
        experimental: false,
      },
    ]);
  });
});
