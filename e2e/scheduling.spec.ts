import { test, expect } from '@playwright/test';

// K11 scheduling workflow, driven against the real built SPA booted with
// ?e2e=1 (see services/runtimeMode.ts): auth is short-circuited to a local
// demo user and the task store runs on in-memory state — no Firebase, no
// backend. The SchedulingBoard itself always exercises its real data-loading
// path (fetch against /api/...), which the static server answers with 404,
// so these specs verify the error/empty UX end-to-end in Chromium.

test.describe('K11 scheduling surfaces', () => {
    test('Today view shows the scheduling board with a handled API failure', async ({ page }) => {
        await page.goto('/?e2e=1');
        // Signed straight into the app shell (no login wall in e2e mode).
        await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();

        const board = page.getByTestId('scheduling-board');
        await expect(board).toBeVisible();

        // The static preview server cannot serve /api/companies/... so the
        // board must land in its error state (never a blank screen or hang).
        await expect(page.getByTestId('error-state')).toBeVisible({ timeout: 10_000 });
        await expect(page.getByRole('button', { name: /retry/i })).toBeVisible();
    });

    test('Schedule view shows the scheduling board with error state when API is unreachable', async ({ page }) => {
        await page.goto('/?e2e=1');
        await page.getByRole('button', { name: 'Schedule' }).first().click();
        await expect(page.getByTestId('scheduling-board')).toBeVisible();

        // Navigate to the Schedule tab. The static preview server cannot
        // serve /api/companies/... so the board falls into its error state.
        await page.getByRole('tab', { name: 'Schedule' }).click();
        await expect(page.getByTestId('error-state')).toBeVisible({ timeout: 10_000 });
        await expect(page.getByRole('button', { name: /retry/i })).toBeVisible();
    });

    test('Routines view shows routine management plus the routines tab with error state', async ({ page }) => {
        await page.goto('/?e2e=1');
        await page.getByRole('button', { name: 'Routines' }).first().click();

        await expect(page.getByRole('heading', { name: 'Manage Routines' })).toBeVisible();
        await expect(page.getByTestId('scheduling-board')).toBeVisible();

        // The board's routine CRUD list renders after a successful load, but
        // the static preview server returns HTML for unknown API routes, so
        // the SchedulingBoard falls into its error state with the fetch error.
        await page.getByRole('tab', { name: 'Routines' }).click();
        await expect(page.getByTestId('error-state')).toBeVisible({ timeout: 10_000 });
        await expect(page.getByRole('button', { name: /retry/i })).toBeVisible();
    });

    test('scheduling tabs are keyboard operable (focus + arrow keys)', async ({ page }) => {
        await page.goto('/?e2e=1');
        const board = page.getByTestId('scheduling-board');
        await expect(board).toBeVisible();

        const todayTab = page.getByRole('tab', { name: 'Today' });
        await todayTab.focus();
        await page.keyboard.press('ArrowRight');
        await expect(page.getByRole('tab', { name: 'Schedule' })).toHaveAttribute('aria-selected', 'true');
        await page.keyboard.press('ArrowRight');
        await expect(page.getByRole('tab', { name: 'Routines' })).toHaveAttribute('aria-selected', 'true');
    });
});
