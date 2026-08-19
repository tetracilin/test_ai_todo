import { test, expect } from '@playwright/test';

// Exercises server.cjs's SPA fallback end-to-end: a deep link or a hard
// refresh on a client-side route must still return the app shell (200 +
// index.html), not a 404, since there is no server-side router.
test.describe('SPA fallback routing', () => {
  test('golden path: a deep, non-root URL still serves the app shell', async ({ page }) => {
    const response = await page.goto('/inbox/today');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();
  });

  test('edge case: reloading on a deep URL keeps serving the app shell', async ({ page }) => {
    await page.goto('/projects/some-project-id');
    await page.reload();

    await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();
  });

  test('the health endpoint used by deploys stays reachable', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });
});
