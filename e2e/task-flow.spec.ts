import { test, expect } from '@playwright/test';

// The app gates all task/work-package data behind local authentication (see
// hooks/useTaskStore.ts — it never fetches without a signed-in userId), so
// there is no local-state task journey to exercise pre-login. The golden
// path we can drive without real credentials is the auth form itself:
// switching modes and submitting, which is exactly the flow a new user
// hits before any task ever exists.
test.describe('login / signup flow', () => {
  test('golden path: switches from sign-in to sign-up and back', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();

    await page.getByRole('button', { name: 'Sign Up' }).click();
    await expect(page.getByRole('heading', { name: 'Create an Account' })).toBeVisible();
    await expect(page.getByLabel(/full name/i)).toBeVisible();

    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();
  });

  test('edge case: sign-up rejects a mismatched password confirmation client-side', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign Up' }).click();

    await page.getByLabel(/full name/i).fill('Ada Lovelace');
    await page.locator('#email-signup').fill('ada@example.com');
    await page.locator('#password-signup').fill('longenoughpassword');
    await page.locator('#confirm-password').fill('doesnotmatch');
    await page.getByRole('button', { name: 'Sign Up' }).click();

    await expect(page.getByText('Passwords do not match.')).toBeVisible();
    // No network call should have been attempted, so the form stays on the sign-up mode.
    await expect(page.getByRole('heading', { name: 'Create an Account' })).toBeVisible();
  });

  test('forgot-password mode only asks for an email', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Forgot password?' }).click();

    await expect(page.getByRole('heading', { name: 'Forgot Password' })).toBeVisible();
    await expect(page.locator('#email-forgot')).toBeVisible();
    await expect(page.locator('#password')).toHaveCount(0);
  });
});
