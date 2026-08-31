// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiscordSettingsPanel } from "./DiscordSettingsPanel";

const mockDiscordApi = vi.hoisted(() => ({
  getSettings: vi.fn(),
  createLinkCode: vi.fn(),
  updatePreferences: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock("@/api/discord", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/discord")>()),
  discordApi: mockDiscordApi,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const unlinkedSettings = {
  link: { status: "unlinked" as const, discordUserId: null },
  preferences: [
    { eventType: "issue.created" as const, enabled: false, deliveryMode: "dm" as const, channelId: null },
  ],
  channels: [{ id: "channel-1", guildId: "guild-1", name: "tasks", guildName: "Paperclip" }],
};

const linkedSettings = {
  ...unlinkedSettings,
  link: { status: "linked" as const, discordUserId: "discord-user-1" },
};

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

function click(element: Element) {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("DiscordSettingsPanel", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mockDiscordApi.getSettings.mockResolvedValue(unlinkedSettings);
    mockDiscordApi.createLinkCode.mockResolvedValue({ code: "link-code-123", expiresAt: "2030-01-01T00:00:00.000Z" });
    mockDiscordApi.updatePreferences.mockResolvedValue(linkedSettings);
    mockDiscordApi.disconnect.mockResolvedValue(unlinkedSettings);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  async function render() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <DiscordSettingsPanel companyId="company-1" />
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();
  }

  it("creates a 10-minute Discord link code without exposing credentials", async () => {
    await render();
    const button = [...container.querySelectorAll("button")].find((element) => element.textContent?.includes("Create link code"));
    expect(button).toBeTruthy();
    await act(async () => click(button!));
    await flushReact();

    expect(mockDiscordApi.createLinkCode).toHaveBeenCalledWith("company-1");
    expect(container.textContent).toContain("link-code-123");
    expect(container.textContent).not.toMatch(/bot token|client secret/i);
  });

  it("saves enabled notification with selected mapped channel", async () => {
    mockDiscordApi.getSettings.mockResolvedValue(linkedSettings);
    await render();

    const enabled = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => {
      click(enabled);
    });
    await flushReact();
    const delivery = container.querySelector('select[aria-label="Task created delivery"]') as HTMLSelectElement;
    await act(async () => {
      delivery.value = "channel";
      delivery.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flushReact();
    const channel = container.querySelector('select[aria-label="Task created channel"]') as HTMLSelectElement;
    expect(channel).not.toBeNull();
    await act(async () => {
      channel.value = "channel-1";
      channel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const save = [...container.querySelectorAll("button")].find((element) => element.textContent?.includes("Save notification preferences"));
    await act(async () => click(save!));
    await flushReact();

    expect(mockDiscordApi.updatePreferences).toHaveBeenCalledWith("company-1", [
      { eventType: "issue.created", enabled: true, deliveryMode: "channel", channelId: "channel-1" },
    ]);
    expect(container.textContent).toContain("Discord notification preferences saved.");
  });

  it("requires confirmation before disconnecting personal Discord identity", async () => {
    mockDiscordApi.getSettings.mockResolvedValue(linkedSettings);
    await render();

    const disconnect = [...container.querySelectorAll("button")].find((element) => element.textContent?.includes("Disconnect Discord"));
    await act(async () => click(disconnect!));
    await flushReact();
    expect(document.body.textContent).toContain("Disconnect Discord account?");
    expect(mockDiscordApi.disconnect).not.toHaveBeenCalled();

    const confirm = [...document.body.querySelectorAll("button")].find((element) => element.textContent === "Disconnect");
    await act(async () => click(confirm!));
    await flushReact();

    expect(mockDiscordApi.disconnect).toHaveBeenCalledWith("company-1");
    expect(container.textContent).toContain("Discord account disconnected. Personal notifications were turned off.");
  });
});
