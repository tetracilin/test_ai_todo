import { expect, test, type APIRequestContext, type Page, type Request, type Route } from "@playwright/test";

type JsonRecord = Record<string, unknown>;

type AgentHelpSeed = {
  companyId: string;
  prefix: string;
  issueId: string;
  identifier: string;
  title: string;
  description: string;
  status: string;
  projectId: string;
  projectGoal: string;
};

type CapturedLaunch = {
  url: string;
  method: string;
  body: unknown;
  idempotencyKey: string | undefined;
};

const ACCEPTED_AT = "2026-09-01T06:00:00.000Z";
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function json<T extends JsonRecord>(response: Awaited<ReturnType<APIRequestContext["get"]>>): Promise<T> {
  const text = await response.text();
  expect(response.ok(), `${response.url()} failed ${response.status()}: ${text}`).toBe(true);
  return JSON.parse(text) as T;
}

async function createAgentHelpSeed(request: APIRequestContext): Promise<AgentHelpSeed> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const company = await json(await request.post("/api/companies", {
    data: { name: `Agent help E2E ${suffix}` },
  }));
  const companyId = String(company.id);
  const goal = await json(await request.post(`/api/companies/${companyId}/goals`, {
    data: {
      title: "Ship approved agent-help context without rewriting it.",
      description: "E2E source goal",
      level: "task",
      status: "planned",
    },
  }));
  const project = await json(await request.post(`/api/companies/${companyId}/projects`, {
    data: {
      name: `Agent help project ${suffix}`,
      status: "in_progress",
      goalIds: [goal.id],
    },
  }));
  const title = "Preserve café task metadata — exactly";
  const description = "Line one.\nLine two keeps punctuation: [] {} & accents é.";
  const issue = await json(await request.post(`/api/companies/${companyId}/issues`, {
    data: {
      title,
      description,
      status: "todo",
      projectId: project.id,
      goalId: goal.id,
      allowDuplicate: true,
    },
  }));

  return {
    companyId,
    prefix: String(company.issuePrefix ?? company.prefix ?? company.urlKey ?? "E2E"),
    issueId: String(issue.id),
    identifier: String(issue.identifier ?? issue.id),
    title,
    description,
    status: "todo",
    projectId: String(project.id),
    projectGoal: String(goal.title),
  };
}

function approvedContextFromSources(seed: AgentHelpSeed) {
  return {
    schema_version: "agent_help.task_context.v1",
    task: {
      id: seed.issueId,
      title: seed.title,
      description: seed.description,
      current_status: seed.status,
    },
    project: {
      id: seed.projectId,
      goal: seed.projectGoal,
    },
  };
}

function captureLaunch(request: Request): CapturedLaunch {
  return {
    url: request.url(),
    method: request.method(),
    body: request.postDataJSON(),
    idempotencyKey: request.headers()["idempotency-key"],
  };
}

async function openSelectedTask(page: Page, seed: AgentHelpSeed) {
  const supplyEligibleAssignee = async (route: Route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    const response = await route.fetch();
    const body = await response.json() as JsonRecord | JsonRecord[];
    const patchIssue = (issue: JsonRecord) => (
      issue.id === seed.issueId || issue.identifier === seed.identifier
        ? { ...issue, assigneeAgentId: "11111111-1111-4111-8111-111111111111" }
        : issue
    );
    await route.fulfill({
      response,
      json: Array.isArray(body) ? body.map(patchIssue) : patchIssue(body),
    });
  };
  await page.route("**/api/issues/*", supplyEligibleAssignee);
  await page.route("**/api/companies/*/issues?*", supplyEligibleAssignee);
  await page.goto(`/${seed.prefix}/issues/${seed.identifier}`);
  const button = page.getByRole("button", { name: "Get agent help", exact: true });
  await expect(button).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: seed.title, exact: true })).toBeVisible();
  return button;
}

async function expectApprovedSourcesUnchanged(request: APIRequestContext, seed: AgentHelpSeed) {
  const [issue, project] = await Promise.all([
    json(await request.get(`/api/issues/${seed.issueId}`)),
    json(await request.get(`/api/projects/${seed.projectId}`)),
  ]);
  const projectGoals = Array.isArray(project.goals) ? project.goals as JsonRecord[] : [];
  const linkedGoal = projectGoals.find((goal) => goal.id === project.goalId)
    ?? projectGoals.find((goal) => goal.title === seed.projectGoal);

  expect({
    schema_version: "agent_help.task_context.v1",
    task: {
      id: issue.id,
      title: issue.title,
      description: issue.description,
      current_status: issue.status,
    },
    project: {
      id: project.id,
      goal: linkedGoal?.title,
    },
  }).toEqual(approvedContextFromSources(seed));
}

test.describe.serial("Get agent help launch", () => {
  let seed: AgentHelpSeed;

  test.beforeAll(async ({ request }) => {
    seed = await createAgentHelpSeed(request);
  });

  test("selected task sends exact launch request, renders success, and preserves approved metadata", async ({ page, request }) => {
    const launches: CapturedLaunch[] = [];
    await expectApprovedSourcesUnchanged(request, seed);

    await page.route("**/api/issues/*/agent-help", async (route) => {
      launches.push(captureLaunch(route.request()));
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          launch_id: "agent-help-e2e-success",
          issue_id: seed.issueId,
          status: "queued",
          accepted_at: ACCEPTED_AT,
        }),
      });
    });

    const button = await openSelectedTask(page, seed);
    await button.click();

    await expect(page.getByRole("status")).toHaveText("Agent help queued");
    await expect(button).toBeEnabled();
    expect(launches).toHaveLength(1);
    expect(launches[0]).toEqual({
      url: expect.stringContaining(`/api/issues/${seed.identifier}/agent-help`),
      method: "POST",
      body: {},
      idempotencyKey: expect.stringMatching(UUID_V4_RE),
    });

    await expectApprovedSourcesUnchanged(request, seed);
  });

  test("delayed launch blocks rapid repeated clicks until settlement", async ({ page }) => {
    const launches: CapturedLaunch[] = [];
    let releaseLaunch!: () => void;
    const launchGate = new Promise<void>((resolve) => {
      releaseLaunch = resolve;
    });

    await page.route("**/api/issues/*/agent-help", async (route) => {
      launches.push(captureLaunch(route.request()));
      await launchGate;
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          launch_id: "agent-help-e2e-delayed",
          issue_id: seed.issueId,
          status: "queued",
          accepted_at: ACCEPTED_AT,
        }),
      });
    });

    const button = await openSelectedTask(page, seed);
    await button.click();
    await expect(button).toBeDisabled();
    await expect(button).toHaveText("Launching agent help...");

    await Promise.all([
      button.click({ force: true }),
      button.click({ force: true }),
      button.click({ force: true }),
    ]);
    await page.waitForTimeout(200);
    expect(launches).toHaveLength(1);
    await expect(button).toBeDisabled();

    releaseLaunch();
    await expect(page.getByRole("status")).toHaveText("Agent help queued");
    await expect(button).toBeEnabled();
    expect(launches).toHaveLength(1);
  });

  test("failed launch gives recovery guidance and a clean retry", async ({ page }) => {
    const launches: CapturedLaunch[] = [];
    await page.route("**/api/issues/*/agent-help", async (route) => {
      launches.push(captureLaunch(route.request()));
      if (launches.length === 1) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            code: "AGENT_LAUNCH_UNAVAILABLE",
            error: "private provider diagnostic must not render",
          }),
        });
        return;
      }
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          launch_id: "agent-help-e2e-retry",
          issue_id: seed.issueId,
          status: "queued",
          accepted_at: ACCEPTED_AT,
        }),
      });
    });

    const button = await openSelectedTask(page, seed);
    await button.click();

    await expect(page.getByRole("alert")).toHaveText("Agent help failed. Retry.");
    await expect(page.getByText("Agent help is unavailable. Retry shortly.")).toBeVisible();
    await expect(page.getByText(/private provider diagnostic/)).toHaveCount(0);
    await expect(button).toBeEnabled();
    expect(launches).toHaveLength(1);

    await button.click();
    await expect(page.getByRole("status")).toHaveText("Agent help queued");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(button).toBeEnabled();
    expect(launches).toHaveLength(2);
    expect(launches.map((launch) => launch.body)).toEqual([{}, {}]);
    expect(launches[0]?.idempotencyKey).toMatch(UUID_V4_RE);
    expect(launches[1]?.idempotencyKey).toMatch(UUID_V4_RE);
    expect(launches[1]?.idempotencyKey).not.toBe(launches[0]?.idempotencyKey);
  });
});
