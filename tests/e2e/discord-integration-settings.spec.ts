import { expect, test, type APIRequestContext } from "@playwright/test";

const BRIDGE_TOKEN = process.env.PAPERCLIP_DISCORD_BRIDGE_TOKEN ?? "playwright-e2e-discord-bridge-token";
const COMPANY_NAME_PREFIX = "E2E Discord Settings";

async function createCompany(request: APIRequestContext) {
  const response = await request.post("/api/companies", { data: { name: `${COMPANY_NAME_PREFIX} ${Date.now()}` } });
  expect(response.ok(), `create company failed ${response.status()}: ${await response.text()}`).toBe(true);
  const company = await response.json();
  return { id: company.id as string, prefix: (company.issuePrefix ?? company.prefix ?? "E2E") as string };
}

test.describe("Discord account settings", () => {
  test("links, saves notification preferences, and reflects a Discord disconnect", async ({ page, request }) => {
    const company = await createCompany(request);
    const discordUserId = `discord-e2e-${Date.now()}`;

    try {
      await page.goto(`/${company.prefix}/company/settings/instance/profile`);
      await expect(page.getByRole("heading", { name: "Discord" })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText("Not connected", { exact: true })).toBeVisible();

      await page.getByRole("button", { name: "Generate link code" }).click();
      const linkCode = await page.locator("code").filter({ hasText: /^[A-Za-z0-9_-]+$/ }).last().textContent();
      expect(linkCode).toBeTruthy();

      const connectResponse = await request.post("/api/integrations/discord/link-codes/consume", {
        data: { code: linkCode, discordUserId, guildId: null },
        headers: { Authorization: `Bearer ${BRIDGE_TOKEN}` },
      });
      expect(connectResponse.ok(), `link failed ${connectResponse.status()}: ${await connectResponse.text()}`).toBe(true);

      await page.getByRole("button", { name: "Refresh status" }).click();
      await expect(page.getByText("Connected", { exact: true })).toBeVisible();
      await expect(page.getByRole("switch", { name: "Enable Task completed notification" })).toHaveAttribute("aria-checked", "false");

      await page.getByRole("switch", { name: "Enable Task completed notification" }).click();
      await page.getByRole("button", { name: "Save notifications" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();

      const saved = await request.get(`/api/integrations/discord/settings?companyId=${company.id}`);
      expect(saved.ok(), `read settings failed ${saved.status()}: ${await saved.text()}`).toBe(true);
      const settings = await saved.json();
      expect(settings.preferences.find((preference: { eventType: string }) => preference.eventType === "issue.completed")).toMatchObject({
        enabled: true,
        deliveryMode: "dm",
      });

      await page.getByRole("button", { name: "Disconnect Discord" }).click();
      await expect(page.getByText("Not connected", { exact: true })).toBeVisible();
      await expect(page.getByRole("switch", { name: "Enable Task completed notification" })).toBeDisabled();
    } finally {
      await request.delete(`/api/companies/${company.id}`).catch(() => undefined);
    }
  });
});
