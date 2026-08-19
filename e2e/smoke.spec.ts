import { test, expect } from '@playwright/test';

// Unauthenticated golden path: the app must never require real Firebase/Gemini
// credentials to boot and show its shell (the login screen).
test.describe('app shell', () => {
  test('loads and renders the login shell with no console errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();
    await expect(page.getByLabel(/email address/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();

    expect(consoleErrors, `unexpected console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  });
});
