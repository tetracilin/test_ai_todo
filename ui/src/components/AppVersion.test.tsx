// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppVersion, formatAppVersion } from "./AppVersion";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const healthApiMock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/api/health", () => ({ healthApi: healthApiMock }));

const SHA = "2bfb9246abcdef0123456789abcdef0123456789";

describe("formatAppVersion", () => {
  it("shows the version and the first 8 characters of the commit", () => {
    expect(formatAppVersion("0.3.1", SHA)).toMatchObject({
      screenText: "v0.3.1 · 2bfb9246",
      copyText: `v0.3.1 · commit ${SHA}`,
      shortSha: "2bfb9246",
    });
  });

  it("does not double the v of a version that already has one", () => {
    expect(formatAppVersion("v1.2.0", SHA).versionText).toBe("v1.2.0");
  });

  it("shows only the version when the commit is null or missing", () => {
    expect(formatAppVersion("0.3.1", null).screenText).toBe("v0.3.1");
    expect(formatAppVersion("0.3.1", undefined).copyText).toBe("v0.3.1");
  });

  it("shows only the commit when there is no version, and nothing when there is neither", () => {
    expect(formatAppVersion(undefined, SHA).screenText).toBe("2bfb9246");
    expect(formatAppVersion(undefined, null).screenText).toBe("");
  });
});

describe("AppVersion", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const writeText = vi.fn();

  async function render() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <AppVersion />
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    healthApiMock.get.mockReset();
    writeText.mockReset();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("shows the running version and links the commit to GitHub", async () => {
    healthApiMock.get.mockResolvedValue({ status: "ok", version: "0.3.1", commit: SHA });
    await render();
    const text = container.querySelector('[data-testid="app-version"]')!.textContent;
    expect(text).toContain("v0.3.1");
    expect(text).toContain("2bfb9246");
    const link = container.querySelector("a")!;
    expect(link.getAttribute("href")).toBe(`https://github.com/tetracilin/test_ai_todo/commit/${SHA}`);
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });

  it("copies the version and the full commit for a bug report", async () => {
    healthApiMock.get.mockResolvedValue({ status: "ok", version: "0.3.1", commit: SHA });
    writeText.mockResolvedValue(undefined);
    await render();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Copy version"]')!.click();
    });
    expect(writeText).toHaveBeenCalledWith(`v0.3.1 · commit ${SHA}`);
    expect(container.querySelector('[role="status"]')!.textContent).toBe("Version copied");
  });

  it("shows only the version when the build has no commit, with no link", async () => {
    healthApiMock.get.mockResolvedValue({ status: "ok", version: "0.3.1", commit: null });
    await render();
    expect(container.textContent).toContain("v0.3.1");
    expect(container.querySelector("a")).toBeNull();
  });

  it("shows nothing, and does not throw, when the request fails", async () => {
    healthApiMock.get.mockRejectedValue(new Error("Failed to load health (503)"));
    await render();
    expect(container.querySelector('[data-testid="app-version"]')).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("does not fail when copying is blocked, and the version stays on screen", async () => {
    healthApiMock.get.mockResolvedValue({ status: "ok", version: "0.3.1", commit: SHA });
    writeText.mockRejectedValue(new Error("blocked"));
    await render();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Copy version"]')!.click();
    });
    expect(container.textContent).toContain("v0.3.1");
    expect(container.querySelector('[role="status"]')!.textContent).toBe("");
  });
});
