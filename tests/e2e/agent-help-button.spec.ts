import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * E2E: Get agent help button states on the task detail surface.
 *
 * The agent-help backend endpoint is merged on a sibling branch, so this
 * suite mocks `POST /api/issues/:issueId/agent-help` at the network layer
 * (browser route interception). It exercises the real UI in a real browser:
 *   - button visible on the desktop task header
 *   - launching state (disabled button + "Launching agent help..." label)
 *   - duplicate-click prevention while the request is in flight
 *   - queued success state with safe copy
 *   - failure state with safe code-mapped copy (never the raw error body)
 *   - payload privacy: request body is empty, task metadata never transmitted
 *
 * Requires local_trusted deployment mode (set in playwright.config.ts).
 */

type Seed = {
  companyId: string;
  prefix: string;
  issueId: string;
  identifier: string;
};

const QUEUED_BODY = {
  launch_id: "ahl-e2e-1",
  issue_id: "",
  status: "queued",
  accepted_at: "2026-08-30T00:00:00.000Z",
};

async function expectOk(response: Awaited<ReturnType<APIRequestContext["post"]>>) {
  const text = await response.text();
  expect(response.ok(), `${response.url()} failed ${response.status()}: ${text}`).toBe(true);
  return JSON.parse(text) as Record<string, string>;
}

async function createAgentHelpSeed(request: APIRequestContext): Promise<Seed> {
  const company = await expectOk(await request.post("/api/companies", {
    data: { name: `AH E2E ${Date.now()}` },
  }));
  const issue = await expectOk(await request.post(`/api/companies/${company.id}/issues`, {
    data: { title: "Verify agent help button states", status: "todo" },
  }));
  return {
    companyId: company.id,
    prefix: company.issuePrefix ?? company.prefix ?? company.urlKey ?? "E2E",
    issueId: issue.id,
    identifier: issue.identifier ?? issue.id,
  };
}

/** Open the canonical task URL (identifier form, as the app links tasks) so
 * IssueDetail mounts exactly once — navigating via the raw UUID triggers a
 * client-side redirect to the identifier URL that remounts the route and
 * resets the launch state mid-test. */
async function openTask(page: import("@playwright/test").Page, seed: Seed) {
  await page.goto(`/${seed.prefix}/issues/${seed.identifier}`);
  const button = page.getByRole("button", { name: "Get agent help", exact: true });
  await expect(button).toBeVisible({ timeout: 30_000 });
  return button;
}

test("Get agent help button shows launching + queued states and blocks duplicate launches", async ({ page }) => {
  const seed = await createAgentHelpSeed(page.request);

  let releaseLaunch!: () => void;
  let capturedRequest: { postData: string | null; idempotencyKey: string | null } | null = null;
  let requestCount = 0;
  const launchGate = new Promise<void>((resolve) => {
    releaseLaunch = resolve;
  });

  await page.route("**/api/issues/*/agent-help", async (route) => {
    const req = route.request();
    expect(req.method()).toBe("POST");
    requestCount += 1;
    capturedRequest = {
      postData: req.postData(),
      idempotencyKey: req.headers()["idempotency-key"] ?? null,
    };
    await launchGate;
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ ...QUEUED_BODY, issue_id: seed.issueId }),
    });
  });

  await page.goto(`/${seed.prefix}/issues/${seed.identifier}`);
  const button = page.getByRole("button", { name: "Get agent help", exact: true });
  await expect(button).toBeVisible({ timeout: 30_000 });
  await button.click();
  await expect(button).toBeDisabled();
  await expect(button).toHaveText("Launching agent help...");

  // Duplicate-click prevention: a second click while pending must not fire
  // another request. Playwright will wait for the disabled state to clear if
  // we click normally, so assert directly against the pending guard instead.
  await button.click({ force: true });
  await page.waitForTimeout(250);

  releaseLaunch();
  await expect(page.getByRole("status")).toHaveText("Agent help queued");
  await expect(button).not.toBeDisabled();

  // Exactly one launch request, empty body, UUID idempotency key: no task
  // metadata (title, description, goal, status) leaves the client.
  expect(requestCount).toBe(1);
  expect(capturedRequest).not.toBeNull();
  expect(capturedRequest!.postData).toBe("{}");
  expect(capturedRequest!.idempotencyKey).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
});

test("Get agent help button shows already-queued state when the server dedupes", async ({ page }) => {
  const seed = await createAgentHelpSeed(page.request);

  await page.route("**/api/issues/*/agent-help", (route) =>
    route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ ...QUEUED_BODY, issue_id: seed.issueId, status: "already_queued" }),
    }),
  );

  await page.goto(`/${seed.prefix}/issues/${seed.identifier}`);
  const button = page.getByRole("button", { name: "Get agent help", exact: true });
  await expect(button).toBeVisible({ timeout: 30_000 });

  await button.click();
  await expect(page.getByRole("status")).toHaveText("Agent help queued");
});

test("Get agent help button shows safe failure state without leaking the raw error", async ({ page }) => {
  const seed = await createAgentHelpSeed(page.request);

  const routeUrls: string[] = [];
  await page.route("**/api/issues/*/agent-help", (route) => {
    routeUrls.push(route.request().url());
    return route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: "provider token unavailable for hermes_gateway",
        code: "AGENT_LAUNCH_UNAVAILABLE",
      }),
    });
  });

  await page.goto(`/${seed.prefix}/issues/${seed.identifier}`);
  const button = page.getByRole("button", { name: "Get agent help", exact: true });
  await expect(button).toBeVisible({ timeout: 30_000 });

  await button.click();
  await expect(page.getByRole("alert")).toHaveText("Agent help failed. Retry.");

  // Safe code-mapped copy only; the raw server error string never renders.
  await expect(page.getByText(/provider token unavailable/)).toHaveCount(0);
  await expect(button).not.toBeDisabled();
  // The launch request targeted exactly this issue (identifier form, as the
  // route param uses it after navigating to the canonical URL).
  expect(routeUrls).toHaveLength(1);
  expect(routeUrls[0]).toContain(`/api/issues/${seed.identifier}/agent-help`);
});
