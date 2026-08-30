// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/queryKeys";
import { useTaskChatRedesignEnabled } from "./useTaskChatRedesignEnabled";

const mockInstanceSettingsApi = vi.hoisted(() => ({ getExperimental: vi.fn() }));

vi.mock("@/api/instanceSettings", () => ({
  instanceSettingsApi: mockInstanceSettingsApi,
}));

async function flushReact() {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
  flushSync(() => {});
}

describe("useTaskChatRedesignEnabled", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  function Probe() {
    const { enabled, loaded } = useTaskChatRedesignEnabled();
    return <output data-enabled={String(enabled)} data-loaded={String(loaded)} />;
  }

  function readGate() {
    const output = container.querySelector("output");
    return {
      enabled: output?.getAttribute("data-enabled"),
      loaded: output?.getAttribute("data-loaded"),
    };
  }

  async function renderWithSettings(settings: Record<string, boolean>) {
    mockInstanceSettingsApi.getExperimental.mockResolvedValue(settings);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(queryKeys.instance.experimentalSettings, settings);
    root = createRoot(container);
    flushSync(() => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    flushSync(() => root?.unmount());
    root = null;
    container.remove();
    vi.clearAllMocks();
  });

  it.each([
    [false, false, false],
    [true, false, true],
    [true, true, false],
    [false, true, false],
  ])(
    "uses positive=%s and classic=%s to resolve enabled=%s",
    async (enableTaskChatRedesign, enableClassicTaskInterface, expectedEnabled) => {
      await renderWithSettings({ enableTaskChatRedesign, enableClassicTaskInterface });

      expect(readGate()).toEqual({ enabled: String(expectedEnabled), loaded: "true" });
    },
  );

  it("fails closed while settings are loading or error", async () => {
    let rejectFetch: (error: Error) => void = () => {};
    mockInstanceSettingsApi.getExperimental.mockImplementation(
      () => new Promise((_resolve, reject) => {
        rejectFetch = reject;
      }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    root = createRoot(container);
    flushSync(() => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });
    expect(readGate()).toEqual({ enabled: "false", loaded: "false" });

    rejectFetch(new Error("settings unavailable"));
    await flushReact();

    expect(readGate()).toEqual({ enabled: "false", loaded: "false" });
  });

  it("fails closed without a QueryClientProvider", () => {
    root = createRoot(container);
    flushSync(() => root!.render(<Probe />));

    expect(readGate()).toEqual({ enabled: "false", loaded: "false" });
  });
});