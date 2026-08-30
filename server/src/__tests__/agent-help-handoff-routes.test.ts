import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  buildRunOutputSilence: vi.fn(),
  decorateActiveRunStatus: vi.fn(),
  getRun: vi.fn(),
  getRunIssueSummary: vi.fn(),
  getActiveRunIssueSummaryForAgent: vi.fn(),
  getRunLogAccess: vi.fn(),
  readLog: vi.fn(),
  wakeup: vi.fn(),
}));

const mockIssueService = vi.hoisted(() => ({
  getById: vi.fn(),
  getByIdentifier: vi.fn(),
}));

const mockProjectService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockGoalService = vi.hoisted(() => ({
  getById: vi.fn(),
  getDefaultCompanyGoal: vi.fn(),
}));

const mockInstanceSettingsService = vi.hoisted(() => ({
  get: vi.fn(),
  getExperimental: vi.fn(),
  getGeneral: vi.fn(),
  listCompanyIds: vi.fn(),
}));

const mockRunSecretRedactionRegistry = vi.hoisted(() => ({
  redactForRun: vi.fn(async (_companyId: string, _runId: string, value: unknown) => value),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

// Rows returned by every db select chain in the route (agent-wakeup dedup
// lookup, skip-reason lookup, invokability company-agents query). Mutated per
// test to simulate pre-existing wakeup requests.
let selectRows: unknown[] = [];

function createSelectStub() {
  const chain: Record<string, unknown> = {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    then: vi.fn((resolve: (rows: unknown[]) => unknown) => Promise.resolve(selectRows).then(resolve)),
  };
  return {
    select: vi.fn(() => chain),
  };
}

function registerModuleMocks() {
  vi.doMock("../routes/authz.js", async () => vi.importActual("../routes/authz.js"));

  vi.doMock("../services/agent-invokability.js", async () => vi.importActual("../services/agent-invokability.js"));

  vi.doMock("../services/agents.js", () => ({
    agentService: () => mockAgentService,
  }));

  vi.doMock("../services/heartbeat.js", () => ({
    heartbeatService: () => mockHeartbeatService,
  }));

  vi.doMock("../services/instance-settings.js", () => ({
    instanceSettingsService: () => mockInstanceSettingsService,
  }));

  vi.doMock("../services/issues.js", () => ({
    issueService: () => mockIssueService,
  }));

  vi.doMock("../services/projects.js", () => ({
    projectService: () => mockProjectService,
  }));

  vi.doMock("../services/goals.js", () => ({
    goalService: () => mockGoalService,
  }));

  vi.doMock("../services/run-secret-redaction.js", () => ({
    createRunSecretRedactionRegistry: () => mockRunSecretRedactionRegistry,
  }));

  vi.doMock("../services/index.js", () => ({
    agentService: () => mockAgentService,
    agentInstructionsService: () => ({}),
    accessService: () => ({
      canUser: vi.fn(async () => true),
      decide: vi.fn(async (input: { action?: string }) => ({
        allowed: true,
        action: input.action,
        reason: "allow_explicit_grant",
        explanation: "Allowed by test grant.",
      })),
      hasPermission: vi.fn(async () => true),
    }),
    approvalService: () => ({}),
    builtInAgentService: () => ({ ensureCompanyDefaultAgentGrants: vi.fn() }),
    companySkillService: () => ({ listRuntimeSkillEntries: vi.fn() }),
    budgetService: () => ({}),
    goalService: () => mockGoalService,
    heartbeatService: () => mockHeartbeatService,
    issueApprovalService: () => ({}),
    issueService: () => mockIssueService,
    logActivity: mockLogActivity,
    projectService: () => mockProjectService,
    secretService: () => ({}),
    syncInstructionsBundleConfigFromFilePath: vi.fn((_agent, config) => config),
    workspaceOperationService: () => ({}),
  }));

  vi.doMock("../adapters/index.js", () => ({
    findServerAdapter: vi.fn(),
    listAdapterModels: vi.fn(),
    detectAdapterModel: vi.fn(),
    findActiveServerAdapter: vi.fn(),
    requireServerAdapter: vi.fn(),
  }));
}

type Actor = {
  type: string;
  userId?: string;
  agentId?: string | null;
  companyId?: string;
  companyIds?: string[];
  source?: string;
  isInstanceAdmin?: boolean;
  memberships?: Array<{ companyId: string; status: string; membershipRole: string }>;
};

async function createApp(db: Record<string, unknown> = createSelectStub(), actor: Actor = defaultActor) {
  const [{ agentRoutes }, { errorHandler }] = await Promise.all([
    vi.importActual<typeof import("../routes/agents.js")>("../routes/agents.js"),
    vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", agentRoutes(db as any));
  app.use(errorHandler);
  return app;
}

async function requestApp(
  app: express.Express,
  buildRequest: (baseUrl: string) => request.Test,
) {
  const { createServer } = await vi.importActual<typeof import("node:http")>("node:http");
  const server = createServer(app);
  try {
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected HTTP server to listen on a TCP port");
    }
    return await buildRequest(`http://127.0.0.1:${address.port}`);
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  }
}

const defaultActor: Actor = {
  type: "board",
  userId: "local-board",
  companyIds: ["company-1"],
  source: "local_implicit",
  isInstanceAdmin: false,
};

const ISSUE_ID = "b73d7a73-1943-7860-851c-177c214c6e96";

const CANONICAL_ISSUE = {
  id: ISSUE_ID,
  companyId: "company-1",
  identifier: "ENV-13",
  issueNumber: 13,
  title: "Fix pagination on the issues list endpoint",
  description: "Cursor pagination returns duplicates across pages when a row changes mid-scan.",
  status: "in_progress",
  assigneeAgentId: "agent-1",
  projectId: "project-1",
  goalId: null,
  executionRunId: null,
};

const ASSIGNED_AGENT = {
  id: "agent-1",
  companyId: "company-1",
  name: "Ada",
  status: "active",
  reportsTo: null,
  adapterType: "hermes_gateway",
};

const PROJECT = {
  id: "project-1",
  companyId: "company-1",
  name: "Platform Core",
  description: "Core platform work",
  goalId: "goal-1",
  goalIds: ["goal-1"],
  goals: [{ id: "goal-1", title: "Ship stable public API v1" }],
};

const GOAL = {
  id: "goal-1",
  companyId: "company-1",
  title: "Ship stable public API v1",
  description: "All list endpoints paginate deterministically.",
};

const QUEUED_RUN = {
  id: "run-new",
  companyId: "company-1",
  agentId: "agent-1",
  status: "queued",
  invocationSource: "on_demand",
  triggerDetail: "manual",
  wakeupRequestId: "wakeup-new",
  createdAt: new Date("2026-08-30T10:00:00.000Z"),
};

describe("agent help handoff routes (POST /issues/:issueId/help)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("../services/agents.js");
    vi.doUnmock("../services/heartbeat.js");
    vi.doUnmock("../services/index.js");
    vi.doUnmock("../services/instance-settings.js");
    vi.doUnmock("../services/issues.js");
    vi.doUnmock("../services/projects.js");
    vi.doUnmock("../services/goals.js");
    vi.doUnmock("../services/agent-invokability.js");
    vi.doUnmock("../adapters/index.js");
    vi.doUnmock("../routes/agents.js");
    vi.doUnmock("../routes/authz.js");
    vi.doUnmock("../middleware/index.js");
    registerModuleMocks();
    vi.clearAllMocks();

    selectRows = [];

    mockIssueService.getByIdentifier.mockResolvedValue(CANONICAL_ISSUE);
    mockIssueService.getById.mockResolvedValue(CANONICAL_ISSUE);
    mockAgentService.getById.mockResolvedValue(ASSIGNED_AGENT);
    mockProjectService.getById.mockResolvedValue(PROJECT);
    mockGoalService.getById.mockResolvedValue(GOAL);
    mockGoalService.getDefaultCompanyGoal.mockResolvedValue(GOAL);
    mockHeartbeatService.wakeup.mockResolvedValue(QUEUED_RUN);
    mockHeartbeatService.getRun.mockResolvedValue(null);
    mockInstanceSettingsService.get.mockResolvedValue({
      id: "instance-settings-1",
      general: {
        censorUsernameInLogs: false,
        feedbackDataSharingPreference: "prompt",
      },
    });
    mockInstanceSettingsService.getExperimental.mockResolvedValue({});
    mockInstanceSettingsService.getGeneral.mockResolvedValue({
      censorUsernameInLogs: false,
      feedbackDataSharingPreference: "prompt",
    });
    mockInstanceSettingsService.listCompanyIds.mockResolvedValue(["company-1"]);
  });

  it("accepts an identifier, enqueues a wakeup with the canonical payload, and returns 202 queued", async () => {
    const app = await createApp();

    const res = await requestApp(
      app,
      (baseUrl) => request(baseUrl)
        .post("/api/issues/ENV-13/help")
        .send({
          message: "  Please double-check the failing pagination test before you continue.  ",
          idempotencyKey: "help-9f2c1a84-1730490000000",
        }),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body).toEqual({
      status: "queued",
      run: { id: "run-new", status: "queued" },
      wakeupRequestId: "wakeup-new",
      agent: { id: "agent-1", name: "Ada" },
    });
    expect(mockIssueService.getByIdentifier).toHaveBeenCalledWith("ENV-13");

    const [agentId, opts] = mockHeartbeatService.wakeup.mock.calls[0];
    expect(agentId).toBe("agent-1");
    expect(opts).toMatchObject({
      source: "on_demand",
      triggerDetail: "manual",
      reason: "human_agent_help",
      idempotencyKey: "help-9f2c1a84-1730490000000",
      requestedByActorType: "user",
      requestedByActorId: "local-board",
      contextSnapshot: { issueId: ISSUE_ID, triggeredBy: "user", helpRequest: true },
    });
    // The full server-assembled metadata payload (§5 of the contract).
    expect(opts.payload).toEqual({
      kind: "agent_help_request",
      message: "Please double-check the failing pagination test before you continue.",
      requestedByUserId: "local-board",
      task: {
        id: ISSUE_ID,
        identifier: "ENV-13",
        issueNumber: 13,
        title: "Fix pagination on the issues list endpoint",
        description: "Cursor pagination returns duplicates across pages when a row changes mid-scan.",
        status: "in_progress",
      },
      project: {
        id: "project-1",
        name: "Platform Core",
        goal: {
          id: "goal-1",
          title: "Ship stable public API v1",
          description: "All list endpoints paginate deterministically.",
        },
      },
      assignedAgent: { id: "agent-1", name: "Ada" },
    });
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        companyId: "company-1",
        actorType: "user",
        actorId: "local-board",
        runId: "run-new",
        action: "agent_help.requested",
        entityType: "issue",
        entityId: ISSUE_ID,
        details: expect.objectContaining({
          agentId: "agent-1",
          runId: "run-new",
          idempotencyKey: "help-9f2c1a84-1730490000000",
        }),
      }),
    );
  }, 10_000);

  it("accepts a uuid issue id and never trusts client-supplied task metadata", async () => {
    const app = await createApp();

    const res = await requestApp(
      app,
      (baseUrl) => request(baseUrl)
        .post(`/api/issues/${ISSUE_ID}/help`)
        .send({
          message: "help me",
          title: "HACKED TITLE",
          description: "HACKED DESC",
          status: "done",
          identifier: "TAMPERED-99",
          project: { id: "stolen-project", name: "stolen" },
          assignedAgent: { id: "agent-999", name: "Mallory" },
        }),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(mockIssueService.getById).toHaveBeenCalledWith(ISSUE_ID);
    const [, opts] = mockHeartbeatService.wakeup.mock.calls[0];
    // Canonical server records win; the tampered body fields are ignored.
    expect(opts.payload.task).toEqual({
      id: ISSUE_ID,
      identifier: "ENV-13",
      issueNumber: 13,
      title: "Fix pagination on the issues list endpoint",
      description: "Cursor pagination returns duplicates across pages when a row changes mid-scan.",
      status: "in_progress",
    });
    expect(opts.payload.assignedAgent).toEqual({ id: "agent-1", name: "Ada" });
  }, 10_000);

  it("rejects a missing, empty, whitespace-only, or over-long message with 400 invalid_help_message", async () => {
    const app = await createApp();

    for (const message of [undefined, "", "   ", "x".repeat(4001)]) {
      const res = await requestApp(
        app,
        (baseUrl) => request(baseUrl)
          .post("/api/issues/ENV-13/help")
          .send({ message }),
      );
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.code).toBe("invalid_help_message");
      expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
    }
  }, 10_000);

  it("rejects an over-long idempotency key with 400", async () => {
    const app = await createApp();

    const res = await requestApp(
      app,
      (baseUrl) => request(baseUrl)
        .post("/api/issues/ENV-13/help")
        .send({ message: "help", idempotencyKey: "k".repeat(201) }),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.code).toBe("invalid_help_message");
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
  }, 10_000);

  it("synthesizes a deterministic 10-second-bucket idempotency key when the client omits one", async () => {
    const app = await createApp();

    const res = await requestApp(
      app,
      (baseUrl) => request(baseUrl)
        .post("/api/issues/ENV-13/help")
        .send({ message: "help" }),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(202);
    const [, opts] = mockHeartbeatService.wakeup.mock.calls[0];
    expect(opts.idempotencyKey).toMatch(new RegExp(`^agent_help:${ISSUE_ID}:\\d+$`));
  }, 10_000);

  it("serializes nullable columns as JSON null and yields project.goal null when the goal chain is empty", async () => {
    mockIssueService.getByIdentifier.mockResolvedValue({
      ...CANONICAL_ISSUE,
      identifier: null,
      issueNumber: null,
      description: null,
    });
    mockGoalService.getById.mockResolvedValue(null); // no direct goal, no project goal
    mockProjectService.getById.mockResolvedValue({ ...PROJECT, goalId: null, goalIds: [] });

    const app = await createApp();

    const res = await requestApp(
      app,
      (baseUrl) => request(baseUrl)
        .post("/api/issues/ENV-13/help")
        .send({ message: "help" }),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(202);
    const [, opts] = mockHeartbeatService.wakeup.mock.calls[0];
    expect(opts.payload.task).toMatchObject({
      id: ISSUE_ID,
      identifier: null,
      issueNumber: null,
      description: null,
    });
    // All keys are present even when null — never omitted.
    expect(Object.keys(opts.payload.task).sort()).toEqual([
      "description", "id", "identifier", "issueNumber", "status", "title",
    ]);
    expect(opts.payload.project).toEqual({
      id: "project-1",
      name: "Platform Core",
      goal: null,
    });
    expect(mockGoalService.getDefaultCompanyGoal).not.toHaveBeenCalled();
  }, 10_000);

  it("resolves the default company goal for a project-less task (excluded from payload without a project)", async () => {
    mockIssueService.getByIdentifier.mockResolvedValue({
      ...CANONICAL_ISSUE,
      projectId: null,
      goalId: null,
    });

    const app = await createApp();

    const res = await requestApp(
      app,
      (baseUrl) => request(baseUrl)
        .post("/api/issues/ENV-13/help")
        .send({ message: "help" }),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(mockGoalService.getDefaultCompanyGoal).toHaveBeenCalledWith("company-1");
    const [, opts] = mockHeartbeatService.wakeup.mock.calls[0];
    // The default company goal is used by the fallback chain server-side, but a
    // task without a project serializes project: null (the goal nests inside it).
    expect(opts.payload.project).toBeNull();
  }, 10_000);

  it("returns project null when the task has no project and goal null when nothing resolves", async () => {
    mockIssueService.getByIdentifier.mockResolvedValue({
      ...CANONICAL_ISSUE,
      projectId: null,
      goalId: null,
    });
    mockGoalService.getDefaultCompanyGoal.mockResolvedValue(null);

    const app = await createApp();

    const res = await requestApp(
      app,
      (baseUrl) => request(baseUrl)
        .post("/api/issues/ENV-13/help")
        .send({ message: "help" }),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(202);
    const [, opts] = mockHeartbeatService.wakeup.mock.calls[0];
    expect(opts.payload.project).toBeNull();
  }, 10_000);

  it("prefers the issue-level goal over the project goal chain", async () => {
    const directGoal = { ...GOAL, id: "goal-direct", title: "Direct goal title" };
    mockIssueService.getByIdentifier.mockResolvedValue({
      ...CANONICAL_ISSUE,
      goalId: "goal-direct",
    });
    mockGoalService.getById.mockResolvedValue(directGoal);

    const app = await createApp();

    const res = await requestApp(
      app,
      (baseUrl) => request(baseUrl)
        .post("/api/issues/ENV-13/help")
        .send({ message: "help" }),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(202);
    const [, opts] = mockHeartbeatService.wakeup.mock.calls[0];
    expect(opts.payload.project.goal).toEqual({
      id: "goal-direct",
      title: "Direct goal title",
      description: "All list endpoints paginate deterministically.",
    });
  }, 10_000);

  it("rejects unauthenticated callers with 401 and agent actors with 403", async () => {
    for (const actor of [
      { type: "none" },
      { type: "agent", agentId: "agent-9", companyId: "company-1" },
    ]) {
      const app = await createApp(createSelectStub(), actor as Actor);
      const res = await requestApp(
        app,
        (baseUrl) => request(baseUrl)
          .post("/api/issues/ENV-13/help")
          .send({ message: "help" }),
      );
      expect(res.status, JSON.stringify(res.body)).toBe(actor.type === "none" ? 401 : 403);
      expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
    }
  }, 10_000);

  it("returns 404 for a missing task and for a task of another company (no existence oracle)", async () => {
    mockIssueService.getByIdentifier.mockResolvedValue(null);
    const notFoundApp = await createApp();
    const missing = await requestApp(
      notFoundApp,
      (baseUrl) => request(baseUrl)
        .post("/api/issues/ENV-13/help")
        .send({ message: "help" }),
    );
    expect(missing.status, JSON.stringify(missing.body)).toBe(404);
    expect(missing.body.error).toBe("Issue not found");

    // A real (non-local_implicit) board member can only see their own company,
    // so a task of another company returns the identical 404 — no oracle.
    const sessionActor: Actor = {
      type: "board",
      userId: "user-1",
      companyIds: ["company-1"],
      source: "session",
      isInstanceAdmin: false,
      memberships: [{ companyId: "company-1", status: "active", membershipRole: "member" }],
    };
    mockIssueService.getByIdentifier.mockResolvedValue({
      ...CANONICAL_ISSUE,
      companyId: "company-other",
    });
    const crossTenantApp = await createApp(createSelectStub(), sessionActor);
    const crossTenant = await requestApp(
      crossTenantApp,
      (baseUrl) => request(baseUrl)
        .post("/api/issues/ENV-13/help")
        .send({ message: "help" }),
    );
    expect(crossTenant.status, JSON.stringify(crossTenant.body)).toBe(404);
    expect(crossTenant.body.error).toBe("Issue not found");
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
  }, 10_000);

  it("rejects a viewer-role board user with 403 Viewer access is read-only", async () => {
    const viewerActor: Actor = {
      type: "board",
      userId: "viewer-1",
      companyIds: ["company-1"],
      source: "session",
      isInstanceAdmin: false,
      memberships: [{ companyId: "company-1", status: "active", membershipRole: "viewer" }],
    };
    const app = await createApp(createSelectStub(), viewerActor);

    const res = await requestApp(
      app,
      (baseUrl) => request(baseUrl)
        .post("/api/issues/ENV-13/help")
        .send({ message: "help" }),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toBe("Viewer access is read-only");
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
  }, 10_000);

  it("blocks an unassigned task with 409 task_unassigned and never auto-assigns", async () => {
    mockIssueService.getByIdentifier.mockResolvedValue({
      ...CANONICAL_ISSUE,
      assigneeAgentId: null,
    });
    const app = await createApp();

    const res = await requestApp(
      app,
      (baseUrl) => request(baseUrl)
        .post("/api/issues/ENV-13/help")
        .send({ message: "help" }),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.code).toBe("task_unassigned");
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
  }, 10_000);

  it("blocks terminal backlog/done/cancelled statuses with 409 task_status_ineligible", async () => {
    for (const status of ["backlog", "done", "cancelled"]) {
      mockIssueService.getByIdentifier.mockResolvedValue({
        ...CANONICAL_ISSUE,
        status,
      });
      const app = await createApp();
      const res = await requestApp(
        app,
        (baseUrl) => request(baseUrl)
          .post("/api/issues/ENV-13/help")
          .send({ message: "help" }),
      );
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(res.body.code).toBe("task_status_ineligible");
      expect(res.body.details).toMatchObject({ status });
      expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
    }
  }, 10_000);

  it("blocks a non-invokable assignee (paused) with 409 agent_not_invokable", async () => {
    mockAgentService.getById.mockResolvedValue({
      ...ASSIGNED_AGENT,
      status: "paused",
    });
    const app = await createApp();

    const res = await requestApp(
      app,
      (baseUrl) => request(baseUrl)
        .post("/api/issues/ENV-13/help")
        .send({ message: "help" }),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.code).toBe("agent_not_invokable");
    expect(res.body.details).toMatchObject({ reason: "paused" });
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
  }, 10_000);

  it("blocks a missing assignee agent row or a cross-company agent with 409 agent_not_invokable", async () => {
    mockAgentService.getById.mockResolvedValue(null);
    let app = await createApp();
    let res = await requestApp(
      app,
      (baseUrl) => request(baseUrl)
        .post("/api/issues/ENV-13/help")
        .send({ message: "help" }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.code).toBe("agent_not_invokable");

    mockAgentService.getById.mockResolvedValue({
      ...ASSIGNED_AGENT,
      companyId: "company-other",
    });
    app = await createApp();
    res = await requestApp(
      app,
      (baseUrl) => request(baseUrl)
        .post("/api/issues/ENV-13/help")
        .send({ message: "help" }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.code).toBe("agent_not_invokable");
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
  }, 10_000);

  it("returns the existing run for a duplicate idempotency key instead of a second wakeup", async () => {
    selectRows = [{ id: "wakeup-dup", status: "queued", runId: "run-existing" }];
    mockHeartbeatService.getRun.mockResolvedValue({
      id: "run-existing",
      status: "queued",
      companyId: "company-1",
      agentId: "agent-1",
    });
    const app = await createApp();

    const res = await requestApp(
      app,
      (baseUrl) => request(baseUrl)
        .post("/api/issues/ENV-13/help")
        .send({ message: "help", idempotencyKey: "help-same-key" }),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body).toEqual({
      status: "queued",
      run: { id: "run-existing", status: "queued" },
      wakeupRequestId: "wakeup-dup",
      agent: { id: "agent-1", name: "Ada" },
    });
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
    expect(mockHeartbeatService.getRun).toHaveBeenCalledWith("run-existing");
  }, 10_000);

  it("returns 202 skipped duplicate when the pending wake has no run yet", async () => {
    selectRows = [{ id: "wakeup-deferred", status: "deferred_issue_execution", runId: null }];
    const app = await createApp();

    const res = await requestApp(
      app,
      (baseUrl) => request(baseUrl)
        .post("/api/issues/ENV-13/help")
        .send({ message: "help", idempotencyKey: "help-same-key" }),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body).toEqual({
      status: "skipped",
      reason: "duplicate",
      wakeupRequestId: "wakeup-deferred",
      agent: { id: "agent-1", name: "Ada" },
    });
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
  }, 10_000);

  it("returns 202 skipped with the wakeup skip reason when enqueueing is suppressed downstream", async () => {
    mockHeartbeatService.wakeup.mockResolvedValue(null);
    const app = await createApp();

    const res = await requestApp(
      app,
      (baseUrl) => request(baseUrl)
        .post("/api/issues/ENV-13/help")
        .send({ message: "help", idempotencyKey: "help-sk" }),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body.status).toBe("skipped");
    expect(res.body.reason).toBe("wakeup_skipped");
    expect(res.body.agent).toEqual({ id: "agent-1", name: "Ada" });
    expect(mockLogActivity).not.toHaveBeenCalled(); // no run was created
  }, 10_000);

  it("returns 202 skipped with the persisted skip reason when the wakeup layer wrote one", async () => {
    selectRows = [{ id: "wakeup-skip", status: "skipped", runId: null, reason: "heartbeat.scheduling_suppressed" }];
    mockHeartbeatService.wakeup.mockResolvedValue(null);
    const app = await createApp();

    const res = await requestApp(
      app,
      (baseUrl) => request(baseUrl)
        .post("/api/issues/ENV-13/help")
        .send({ message: "help", idempotencyKey: "help-sk" }),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body.status).toBe("skipped");
    expect(res.body.reason).toBe("heartbeat.scheduling_suppressed");
  }, 10_000);

  it("propagates a 409 enqueue rejection (e.g. company inactive / budget block) through the error handler", async () => {
    const { HttpError } = await vi.importActual<typeof import("../errors.js")>("../errors.js");
    mockHeartbeatService.wakeup.mockRejectedValue(
      new HttpError(409, "Company is not active", { status: "inactive" }),
    );
    const app = await createApp();

    const res = await requestApp(
      app,
      (baseUrl) => request(baseUrl)
        .post("/api/issues/ENV-13/help")
        .send({ message: "help", idempotencyKey: "help-budget" }),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error).toBe("Company is not active");
    expect(res.body.details).toMatchObject({ status: "inactive" });
  }, 10_000);

  it("returns 500 for an unexpected enqueue failure without creating a run", async () => {
    mockHeartbeatService.wakeup.mockRejectedValue(new Error("adapter exploded"));
    const app = await createApp();

    const res = await requestApp(
      app,
      (baseUrl) => request(baseUrl)
        .post("/api/issues/ENV-13/help")
        .send({ message: "help", idempotencyKey: "help-crash" }),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(500);
    expect(res.body.error).toBe("Internal server error");
  }, 10_000);
});