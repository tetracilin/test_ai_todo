import { describe, expect, it } from "vitest";
import {
  isEnabledAdapterType,
  isValidAdapterType,
  isVisualAdapterChoice,
  listAdapterOptions,
  listSelectableAdapterOptions,
} from "./metadata";
import type { UIAdapterModule } from "./types";

const externalAdapter: UIAdapterModule = {
  type: "external_test",
  label: "External Test",
  parseStdoutLine: () => [],
  ConfigFields: () => null,
  buildAdapterConfig: () => ({}),
};

describe("adapter metadata", () => {
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

  it("offers Hermes Gateway as the sole agent AI option", () => {
    expect(
      listSelectableAdapterOptions((type) => type, [
        externalAdapter,
        { ...externalAdapter, type: "claude_local" },
        { ...externalAdapter, type: "hermes_gateway" },
      ]).map((option) => option.value),
    ).toEqual(["hermes_gateway"]);
    expect(isValidAdapterType("hermes_gateway")).toBe(true);
    expect(isValidAdapterType("claude_local")).toBe(false);
    expect(isValidAdapterType("external_test")).toBe(false);
  });

  it("keeps intentionally withheld built-in adapters marked as coming soon", () => {
    expect(isEnabledAdapterType("process")).toBe(false);
    expect(isEnabledAdapterType("http")).toBe(false);
  });

  it("marks the retired ACPX adapter as unavailable for new selections", () => {
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
