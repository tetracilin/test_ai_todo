import { expect, test } from "@playwright/test";

const LEGACY_HOST_PATTERNS = [
  /generativelanguage\.googleapis\.com/i,
  /firebaseio\.com/i,
  /firebasestorage\.(?:app|googleapis\.com)/i,
  /firebaseapp\.com/i,
  /gstatic\.com/i,
];

test("Paperclip shell makes no requests to removed provider infrastructure", async ({ page }) => {
  const violations: string[] = [];
  const inspectUrl = (url: string) => {
    if (LEGACY_HOST_PATTERNS.some((pattern) => pattern.test(url))) violations.push(url);
  };

  page.on("request", (request) => inspectUrl(request.url()));
  page.on("websocket", (socket) => inspectUrl(socket.url()));

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("#root")).not.toBeEmpty();
  await page.waitForTimeout(500);

  expect(violations, `forbidden network requests:\n${violations.join("\n")}`).toEqual([]);
});
