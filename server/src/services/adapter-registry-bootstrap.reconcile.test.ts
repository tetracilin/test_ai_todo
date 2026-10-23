import { beforeEach, describe, expect, it, vi } from "vitest";

const setAdapterDisabled = vi.fn();

vi.mock("../adapters/registry.js", async (orig) => ({
  ...(await orig()),
  listServerAdapters: () => [
    { type: "claude_local" },
    { type: "opencode_local" },
    { type: "pi_local" },
  ],
}));

vi.mock("./adapter-plugin-store.js", () => ({
  listAdapterPlugins: () => [],
  setAdapterDisabled: (type: string, disabled: boolean) => setAdapterDisabled(type, disabled),
}));

const { reconcileAdapterAvailability } = await import("./adapter-registry-bootstrap.js");

describe("reconcileAdapterAvailability", () => {
  beforeEach(() => {
    setAdapterDisabled.mockReset();
  });

  it("is a no-op when registry is null", () => {
    expect(reconcileAdapterAvailability(null)).toEqual({ enabled: [], disabled: [] });
    expect(setAdapterDisabled).not.toHaveBeenCalled();
  });

  it("enables declared, disables everything else (e.g. drops claude_local)", () => {
    const result = reconcileAdapterAvailability([
      { adapterType: "opencode_local", enabled: true },
    ]);
    expect(result.enabled).toEqual(["opencode_local"]);
    expect(result.disabled.sort()).toEqual(["claude_local", "pi_local"]);
    expect(setAdapterDisabled).toHaveBeenCalledWith("claude_local", true);
    expect(setAdapterDisabled).toHaveBeenCalledWith("opencode_local", false);
  });

  it("throws when a declared adapter has no installed implementation", () => {
    expect(() =>
      reconcileAdapterAvailability([{ adapterType: "ghost_adapter", enabled: true }]),
    ).toThrow(/no installed adapter: ghost_adapter/);
    // Fail loud before mutating any availability state.
    expect(setAdapterDisabled).not.toHaveBeenCalled();
  });

  it("disables a declared adapter that is explicitly marked enabled: false", () => {
    const result = reconcileAdapterAvailability([
      { adapterType: "opencode_local", enabled: true },
      { adapterType: "pi_local", enabled: false },
    ]);
    expect(result.enabled).toEqual(["opencode_local"]);
    expect(result.disabled.sort()).toEqual(["claude_local", "pi_local"]);
    expect(setAdapterDisabled).toHaveBeenCalledWith("pi_local", true);
  });
});
