import { expect, test, type Page } from "@playwright/test";

/**
 * Independent QA of the company-aware route contract for the T3 scheduling
 * release (t_131dc015). Regression: Today/Schedule nav links were emitted
 * without the company segment, and route words ('today'/'schedule') were
 * misread as company prefixes, producing `/SCHEDULE/goals`-style URLs and the
 * "Company not found: No company matches prefix \"SCHEDULE\"" 404.
 *
 * Contract under test:
 *   1. Every board nav link (Today, Schedule, Scheduling Routines, Routines,
 *      Goals, Projects, Artifacts) renders a company-prefixed href
 *      `/<PREFIX>/<route>` where <PREFIX> is the selected company's real
 *      issuePrefix — never a route word.
 *   2. Prefixed direct loads (/PREFIX/today, ...) resolve and survive a hard
 *      refresh without "Company not found / No company matches prefix".
 *   3. Unprefixed direct loads (/today, /schedule, ...) redirect to a valid
 *      company-prefixed URL and render the page (no 404).
 *   4. Route words never appear as the company segment in generated hrefs.
 */

const ROUTE_WORD_ERROR = /No company matches prefix|Company not found/i;

// A valid company prefix is a short uppercase token; route words are lowercase
// or capitalized route names. Anything else means the company segment resolved
// to a route word.
function isPlausibleCompanyPrefix(segment: string): boolean {
  return /^[A-Z0-9]{1,8}$/.test(segment) && !ROUTE_WORD_ERROR.test(segment);
}

async function createCompany(page: Page, name: string): Promise<string> {
  const res = await page.request.post("/api/companies", { data: { name } });
  expect(res.ok(), `create company failed ${res.status()}: ${await res.text()}`).toBe(true);
  const company = await res.json();
  // Goals sidebar link is experimental-flag-gated (default off); enable it so the
  // Goals nav item renders and can be exercised alongside the other board routes.
  await page.request.patch("/api/instance/settings/experimental", {
    data: { enableGoalsSidebarLink: true },
  });
  return company.issuePrefix ?? company.prefix ?? company.urlKey ?? "E2E";
}

function collectFatalErrors(page: Page): string[] {
  const fatal: string[] = [];
  page.on("pageerror", (err) => {
    fatal.push(`PAGEERROR: ${err.message}`);
  });
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    if (ROUTE_WORD_ERROR.test(msg.text()) || /App shell crashed|Page render failed/.test(msg.text())) {
      fatal.push(`CONSOLE: ${msg.text().slice(0, 300)}`);
    }
  });
  return fatal;
}

/**
 * A freshly API-created company auto-opens the onboarding wizard ("Define your
 * mission", steps 1-5) which renders a full-screen modal that blocks clicks on
 * the sidebar. Wait for it to render (it can take a moment after route mount),
 * dismiss it via its Close button, and confirm the modal is gone.
 */
async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const close = page.getByRole("button", { name: "Close", exact: true });
  try {
    await close.waitFor({ state: "visible", timeout: 8_000 });
    await close.click();
    // Wait for the modal to unmount before the sidebar is treated as clickable.
    await close.waitFor({ state: "hidden", timeout: 8_000 });
  } catch {
    // No onboarding wizard appeared (or it was already dismissed) — proceed.
  }
  await page.waitForTimeout(300);
}

test.describe.serial("company-aware route contract (Today/Schedule/Routines/Goals/Projects/Artifacts)", () => {
  test.setTimeout(300_000);

  // Board routes that must all carry a company prefix and resolve.
  const BOARD_ROUTES: Array<{ label: string; path: string }> = [
    { label: "Today", path: "/today" },
    { label: "Schedule", path: "/schedule" },
    { label: "Scheduling Routines", path: "/schedule/routines" },
    { label: "Routines", path: "/routines" },
    { label: "Goals", path: "/goals" },
    { label: "Projects", path: "/projects" },
    { label: "Artifacts", path: "/artifacts" },
  ];

  // One shared company + prefix for the whole serial group; navigating to its
  // dashboard first establishes it as the selected company so redirects and
  // sidebar links resolve to a known prefix.
  let prefix = "QA";
  test.beforeAll(async ({ request }) => {
    const res = await request.post("/api/companies", { data: { name: `Route Contract QA ${Date.now()}` } });
    expect(res.ok(), `beforeAll create company failed ${res.status()}`).toBe(true);
    const company = await res.json();
    prefix = company.issuePrefix ?? company.prefix ?? company.urlKey ?? "QA";
    await request.patch("/api/instance/settings/experimental", { data: { enableGoalsSidebarLink: true } });
  });

  test("sidebar emits company-prefixed hrefs for every board route and never route words", async ({ page }) => {
    const fatal = collectFatalErrors(page);
    await page.goto(`/${prefix}/dashboard`);
    await page.waitForURL(new RegExp(`/${prefix}/`), { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);

    // Wait for sidebar hydration, then read every sidebar nav href.
    await page.getByRole("link", { name: "Today", exact: true }).waitFor({ timeout: 20_000 });
    const hrefs = await page.getByRole("navigation").locator("a").evaluateAll((anchors) =>
      anchors.map((a) => a.getAttribute("href")).filter((h): h is string => Boolean(h)),
    );

    for (const { label, path } of BOARD_ROUTES) {
      expect(
        hrefs.some((href) => href === `/${prefix}${path}`),
        `expected a nav link with href /${prefix}${path} (for ${label}); got: ${hrefs.join(", ")}`,
      ).toBe(true);
    }

    // Route words must never appear as the company segment in any nav href.
    for (const href of hrefs) {
      expect(href.startsWith("/SCHEDULE/"), `route word used as company segment: ${href}`).toBe(false);
      expect(href.startsWith("/TODAY/"), `route word used as company segment: ${href}`).toBe(false);
      expect(href.startsWith("/GOALS/"), `route word used as company segment: ${href}`).toBe(false);
    }

    expect(fatal, `console/page errors while rendering sidebar:\n${fatal.join("\n")}`).toEqual([]);
  });

  test("prefixed direct loads and hard refreshes resolve without company-not-found", async ({ page }) => {
    const fatal = collectFatalErrors(page);

    for (const { label, path } of BOARD_ROUTES) {
      const prefixed = `/${prefix}${path}`;
      await page.goto(prefixed);
      await page.waitForURL(new RegExp(`/${prefix}${path}(/|$)`), { timeout: 20_000 });
      await expect(page.getByText(ROUTE_WORD_ERROR)).toHaveCount(0);
      // Hard refresh on the same prefixed URL (simulates reload / deep link).
      await page.reload();
      await page.waitForLoadState("domcontentloaded");
      await page.waitForURL(new RegExp(`/${prefix}${path}(/|$)`), { timeout: 20_000 });
      expect(page.url()).toContain(prefixed);
      await expect(page.getByText(ROUTE_WORD_ERROR)).toHaveCount(0);
    }
    expect(fatal, `console/page errors during prefixed loads/refreshes:\n${fatal.join("\n")}`).toEqual([]);
  });

  test("navigation from sidebar lands on the company-prefixed page (no 404)", async ({ page }) => {
    const fatal = collectFatalErrors(page);
    await page.goto(`/${prefix}/dashboard`);
    await page.waitForURL(new RegExp(`/${prefix}/`), { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    const sidebar = page.getByRole("navigation");
    await sidebar.getByRole("link", { name: "Today", exact: true }).waitFor({ timeout: 20_000 });

    for (const { label, path } of BOARD_ROUTES) {
      // Scope to the sidebar <nav> landmark: the page content can render its
      // own links with the same label (e.g. Schedule page has a "Routines"
      // link to /schedule/routines).
      const sidebar = page.getByRole("navigation");
      await sidebar.getByRole("link", { name: label, exact: true }).click();
      await page.waitForURL(new RegExp(`/${prefix}${path}(/|$)`), { timeout: 20_000 });
      expect(page.url()).toContain(`/${prefix}${path}`);
      await expect(page.getByText(ROUTE_WORD_ERROR)).toHaveCount(0);
    }
    expect(fatal, `console/page errors during nav:\n${fatal.join("\n")}`).toEqual([]);
  });

  test("unprefixed direct loads redirect to a company-prefixed URL and render", async ({ page }) => {
    const fatal = collectFatalErrors(page);

    // Establish selection at the company dashboard first so the unprefixed
    // redirect target is our known company (UnprefixedBoardRedirect uses
    // selectedCompany ?? companies[0]).
    await page.goto(`/${prefix}/dashboard`);
    await page.waitForURL(new RegExp(`/${prefix}/`), { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);

    for (const { label, path } of BOARD_ROUTES) {
      await page.goto(path);
      await page.waitForURL(new RegExp(`/${prefix}${path}(/|$)`), { timeout: 20_000 });
      expect(page.url()).toContain(`/${prefix}${path}`);
      await expect(page.getByText(ROUTE_WORD_ERROR)).toHaveCount(0);
    }
    expect(fatal, `console/page errors during direct loads:\n${fatal.join("\n")}`).toEqual([]);
  });
});
