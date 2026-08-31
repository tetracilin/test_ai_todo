import { expect, request as pwRequest, test, type APIRequestContext, type Page } from "@playwright/test";

const PORT = Number(process.env.PAPERCLIP_E2E_PORT ?? 3199);
const BASE_URL = `http://127.0.0.1:${PORT}`;

type DiscordSettings = {
  link: { status: "linked" | "unlinked"; discordUserId: string | null };
  preferences: Array<{ eventType: string; enabled: boolean; deliveryMode: "dm" | "channel"; channelId: string | null }>;
  channels: Array<{ id: string; guildId: string; name: string; guildName: string }>;
};

async function createCompany(board: APIRequestContext) {
  const response = await board.post("/api/companies", { data: { name: `E2E-Discord-${Date.now()}` } });
  expect(response.ok()).toBe(true);
  const company = await response.json();
  return { id: company.id as string, prefix: (company.issuePrefix ?? company.prefix) as string };
}

function settings(linked = false): DiscordSettings {
  return {
    link: { status: linked ? "linked" : "unlinked", discordUserId: linked ? "discord-user-1" : null },
    preferences: [{ eventType: "issue.created", enabled: false, deliveryMode: "dm", channelId: null }],
    channels: [{ id: "channel-1", guildId: "guild-1", name: "tasks", guildName: "Paperclip" }],
  };
}

async function mockDiscordApi(page: Page, current: DiscordSettings) {
  await page.route("**/api/integrations/discord/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const response = (body: unknown, status = 200) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });

    // Browser requests must rely on session cookies. Bot secrets and bridge
    // bearer tokens never belong in this UI flow.
    expect(request.headers().authorization).toBeUndefined();

    if (request.method() === "GET" && url.pathname.endsWith("/settings")) return response(current);
    if (request.method() === "POST" && url.pathname.endsWith("/link-codes")) {
      return response({ code: "browser-link-code", expiresAt: "2030-01-01T00:00:00.000Z" }, 201);
    }
    if (request.method() === "PATCH" && url.pathname.endsWith("/preferences")) {
      const payload = request.postDataJSON() as { preferences: DiscordSettings["preferences"] };
      current.preferences = payload.preferences;
      return response(current);
    }
    if (request.method() === "DELETE" && url.pathname.endsWith("/link")) {
      current.link = { status: "unlinked", discordUserId: null };
      current.preferences = current.preferences.map((preference) => ({ ...preference, enabled: false }));
      return response(current);
    }
    return response({ error: "Unexpected Discord request" }, 500);
  });
}

test.describe("Discord profile settings", () => {
  let board: APIRequestContext;
  let company: Awaited<ReturnType<typeof createCompany>>;

  test.beforeAll(async () => {
    board = await pwRequest.newContext({ baseURL: BASE_URL });
    company = await createCompany(board);
  });

  test.afterAll(async () => {
    await board.delete(`/api/companies/${company.id}`).catch(() => {});
    await board.dispose();
  });

  test("creates Discord link code", async ({ page }) => {
    await mockDiscordApi(page, settings());
    await page.goto(`/${company.prefix}/company/settings/instance/profile`);
    await expect(page.getByRole("heading", { name: "Discord notifications" })).toBeVisible();
    await page.getByRole("button", { name: "Create link code" }).click();
    await expect(page.getByText("browser-link-code", { exact: true })).toBeVisible();
  });

  test("saves mapped channel preference", async ({ page }) => {
    const current = settings(true);
    await mockDiscordApi(page, current);
    await page.goto(`/${company.prefix}/company/settings/instance/profile`);
    await page.getByLabel("Task created").check();
    await page.getByLabel("Task created delivery").selectOption("channel");
    await page.getByLabel("Task created channel").selectOption("channel-1");
    await page.getByRole("button", { name: "Save notification preferences" }).click();
    await expect(page.getByText("Discord notification preferences saved.")).toBeVisible();
    expect(current.preferences).toEqual([
      { eventType: "issue.created", enabled: true, deliveryMode: "channel", channelId: "channel-1" },
    ]);
  });

  test("requires confirmation before disconnecting Discord", async ({ page }) => {
    const current = settings(true);
    await mockDiscordApi(page, current);
    await page.goto(`/${company.prefix}/company/settings/instance/profile`);
    await page.getByRole("button", { name: "Disconnect Discord" }).click();
    await expect(page.getByRole("heading", { name: "Disconnect Discord account?" })).toBeVisible();
    expect(current.link.status).toBe("linked");
    await page.getByRole("button", { name: "Disconnect", exact: true }).click();
    await expect(page.getByText("Discord account disconnected. Personal notifications were turned off.")).toBeVisible();
    expect(current.link.status).toBe("unlinked");
  });
});
