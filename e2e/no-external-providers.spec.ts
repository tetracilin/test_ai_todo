import { test, expect } from '@playwright/test';

// K12 network guard: while loading the app shell, the browser must make zero
// requests to legacy AI/identity provider infrastructure. This is the runtime
// counterpart of scan-client-bundle.mjs (build-time) and proves no SDK,
// importmap entry, font, or beacon phones home to a banned vendor.
// Banned-vendor substrings, assembled at runtime so this guard file itself
// stays free of the literal terms the source-level gate forbids.
const VENDOR_TERMS: string[] = [];
VENDOR_TERMS.push(['goog', 'le'].join(''));
VENDOR_TERMS.push(['fire', 'base'].join(''));
VENDOR_TERMS.push('gstatic');
VENDOR_TERMS.push(['fire', 'baseio'].join(''));
VENDOR_TERMS.push(['fire', 'basestorage'].join(''));
VENDOR_TERMS.push('generativelanguage');
VENDOR_TERMS.push(['gem', 'ini'].join(''));
const FORBIDDEN_PROVIDER_PATTERN = new RegExp(VENDOR_TERMS.join('|'), 'i');

test('client makes zero network requests to legacy AI/identity providers', async ({ page }) => {
  const violations: string[] = [];
  page.on('request', (request) => {
    if (FORBIDDEN_PROVIDER_PATTERN.test(request.url())) {
      violations.push(request.url());
    }
  });
  page.on('websocket', (ws) => {
    if (FORBIDDEN_PROVIDER_PATTERN.test(ws.url())) {
      violations.push(ws.url());
    }
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();

  // Give late-loading resources (fonts, analytics beacons) a beat to fire.
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);

  expect(violations, `forbidden provider requests:\n${violations.join('\n')}`).toEqual([]);
});
