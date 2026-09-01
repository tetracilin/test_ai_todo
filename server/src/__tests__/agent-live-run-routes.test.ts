import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  buildRunOutputSilence: vi.fn(),
  decorateActiveRunStatus: vi.fn(),
  getRunIssueSummary: vi.fn(),
  getActiveRunIssueSummaryForAgent: vi.fn(),
  getRunLogAccess: vi.fn(),
  readLog: vi.fn(),
  wakeup: vi.fn(),
  getRun: vi.fn(),
}));

const mockIssueService = vi.hoisted(() => ({
  getById: vi.fn(),
  getByIdentifier: vi.fn(),
}));

const mockProjectService = vi.hoisted(() => ({
  getById: vi.fn(),
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

const routeAgentId = "11111111-1111-4111-8111-111111111111";

function registerModuleMocks() {
  vi.doMock("../routes/authz.js", async () => vi.importActual("../routes/authz.js"));

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
    heartbeatService: () => mockHeartbeatService,
    issueApprovalService: () => ({}),
    issueService: () => mockIssueService,
    logActivity: vi.fn(),
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

async function createApp(
  db: Record<string, unknown> = {},
  actor: Record<string, unknown> = {
    type: "board",
    userId: "local-board",
    companyIds: ["company-1"],
    source: "local_implicit",
    isInstanceAdmin: false,
  },
) {
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

function createLiveRunsDbStub(rows: Array<Record<string, unknown>>) {
  const limit = vi.fn(async (value: number) => rows.slice(0, value));
  const orderedQuery = {
    limit,
    then: (resolve: (value: Array<Record<string, unknown>>) => unknown) => Promise.resolve(rows).then(resolve),
  };
  const query = {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnValue(orderedQuery),
  };

  return {
    db: {
      select: vi.fn().mockReturnValue(query),
    },
    limit,
  };
}

function createAgentHelpDbStub(existingWakes: Array<Record<string, unknown>> = []) {
  const query = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(existingWakes),
  };
  return { select: vi.fn().mockReturnValue(query) };
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

describe("agent live run routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("../services/agents.js");
    vi.doUnmock("../services/heartbeat.js");
    vi.doUnmock("../services/index.js");
    vi.doUnmock("../services/instance-settings.js");
    vi.doUnmock("../services/issues.js");
    vi.doUnmock("../adapters/index.js");
    vi.doUnmock("../routes/agents.js");
    vi.doUnmock("../routes/authz.js");
    vi.doUnmock("../middleware/index.js");
    registerModuleMocks();
    vi.resetAllMocks();
    mockIssueService.getByIdentifier.mockResolvedValue({
      id: "issue-1",
      companyId: "company-1",
      executionRunId: "run-1",
      assigneeAgentId: "agent-1",
      status: "in_progress",
      title: "Prepare client demo",
      description: "Draft agenda and confirm attendees.",
      projectId: "project-1",
    });
    mockIssueService.getById.mockResolvedValue(null);
    mockAgentService.getById.mockResolvedValue({
      id: "agent-1",
      companyId: "company-1",
      name: "Builder",
      adapterType: "codex_local",
    });
    mockProjectService.getById.mockResolvedValue({
      id: "project-1",
      companyId: "company-1",
      goalId: "goal-1",
      goals: [{ id: "goal-1", title: "Ship approved client demo by Friday." }],
    });
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
    mockHeartbeatService.buildRunOutputSilence.mockResolvedValue(null);
    mockHeartbeatService.decorateActiveRunStatus.mockImplementation((run) => ({
      ...run,
      currentStatusMessage: null,
      currentStatusUpdatedAt: null,
    }));
    mockHeartbeatService.getRunIssueSummary.mockResolvedValue({
      id: "run-1",
      status: "running",
      invocationSource: "on_demand",
      triggerDetail: "manual",
      contextCommentId: "comment-1",
      contextWakeCommentId: "comment-1",
      startedAt: new Date("2026-04-10T09:30:00.000Z"),
      finishedAt: null,
      createdAt: new Date("2026-04-10T09:29:59.000Z"),
      agentId: "agent-1",
      issueId: "issue-1",
    });
    mockHeartbeatService.getActiveRunIssueSummaryForAgent.mockResolvedValue(null);
    mockHeartbeatService.buildRunOutputSilence.mockResolvedValue(null);
    mockHeartbeatService.getRunLogAccess.mockResolvedValue({
      id: "run-1",
      companyId: "company-1",
      logStore: "local_file",
      logRef: "logs/run-1.ndjson",
    });
    mockHeartbeatService.readLog.mockResolvedValue({
      runId: "run-1",
      store: "local_file",
      logRef: "logs/run-1.ndjson",
      content: "chunk",
      nextOffset: 5,
    });
    mockHeartbeatService.wakeup.mockResolvedValue({
      id: "run-1",
      companyId: "company-1",
      agentId: "agent-1",
      status: "queued",
      invocationSource: "on_demand",
      triggerDetail: "manual",
      createdAt: new Date("2026-08-30T10:12:01.000Z"),
    });
    mockHeartbeatService.getRun.mockResolvedValue(null);
  });

  it("returns a compact active run payload for issue polling", async () => {
    const res = await requestApp(
      await createApp(),
      (baseUrl) => request(baseUrl).get("/api/issues/pc1a2-1295/active-run"),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockIssueService.getByIdentifier).toHaveBeenCalledWith("PC1A2-1295");
    expect(mockHeartbeatService.getRunIssueSummary).toHaveBeenCalledWith("run-1");
    expect(res.body).toMatchObject({
      id: "run-1",
      status: "running",
      invocationSource: "on_demand",
      triggerDetail: "manual",
      contextCommentId: "comment-1",
      contextWakeCommentId: "comment-1",
      startedAt: "2026-04-10T09:30:00.000Z",
      finishedAt: null,
      createdAt: "2026-04-10T09:29:59.000Z",
      agentId: "agent-1",
      issueId: "issue-1",
      agentName: "Builder",
      adapterType: "codex_local",
      outputSilence: null,
      currentStatusMessage: null,
      currentStatusUpdatedAt: null,
    });
    expect(res.body).not.toHaveProperty("resultJson");
    expect(res.body).not.toHaveProperty("contextSnapshot");
    expect(res.body).not.toHaveProperty("logRef");
  }, 10_000);

  it("ignores a stale execution run from another issue and falls back to the assignee's matching run", async () => {
    mockHeartbeatService.getRunIssueSummary.mockResolvedValue({
      id: "run-foreign",
      status: "running",
      invocationSource: "assignment",
      triggerDetail: "callback",
      startedAt: new Date("2026-04-10T10:00:00.000Z"),
      finishedAt: null,
      createdAt: new Date("2026-04-10T09:59:00.000Z"),
      agentId: "agent-1",
      issueId: "issue-2",
    });
    mockHeartbeatService.getActiveRunIssueSummaryForAgent.mockResolvedValue({
      id: "run-1",
      status: "running",
      invocationSource: "on_demand",
      triggerDetail: "manual",
      startedAt: new Date("2026-04-10T09:30:00.000Z"),
      finishedAt: null,
      createdAt: new Date("2026-04-10T09:29:59.000Z"),
      agentId: "agent-1",
      issueId: "issue-1",
    });

    const res = await requestApp(
      await createApp(),
      (baseUrl) => request(baseUrl).get("/api/issues/PC1A2-1295/active-run"),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockHeartbeatService.getRunIssueSummary).toHaveBeenCalledWith("run-1");
    expect(mockHeartbeatService.getActiveRunIssueSummaryForAgent).toHaveBeenCalledWith("agent-1");
    expect(res.body).toMatchObject({
      id: "run-1",
      issueId: "issue-1",
      agentId: "agent-1",
      agentName: "Builder",
      adapterType: "codex_local",
    });
  });

  it("includes ephemeral current status fields on active run polling", async () => {
    mockHeartbeatService.decorateActiveRunStatus.mockImplementation((run) => ({
      ...run,
      currentStatusMessage: "Syncing workspace to sandbox",
      currentStatusUpdatedAt: new Date("2026-04-10T09:30:05.000Z"),
      currentToolName: "bash",
      lastAssistantSnippet: "Inspecting files",
      lastEventAt: new Date("2026-04-10T09:30:06.000Z"),
    }));

    const res = await requestApp(
      await createApp(),
      (baseUrl) => request(baseUrl).get("/api/issues/PC1A2-1295/active-run"),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockHeartbeatService.decorateActiveRunStatus).toHaveBeenCalledWith(
      expect.objectContaining({ id: "run-1", issueId: "issue-1" }),
      { companyId: "company-1", issueId: "issue-1" },
    );
    expect(res.body).toMatchObject({
      currentStatusMessage: "Syncing workspace to sandbox",
      currentStatusUpdatedAt: "2026-04-10T09:30:05.000Z",
      currentToolName: "bash",
      lastAssistantSnippet: "Inspecting files",
      lastEventAt: "2026-04-10T09:30:06.000Z",
    });
  });

  it("uses narrow run log metadata lookups for log polling", async () => {
    const res = await requestApp(
      await createApp(),
      (baseUrl) => request(baseUrl).get("/api/heartbeat-runs/run-1/log?offset=12&limitBytes=64"),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockHeartbeatService.getRunLogAccess).toHaveBeenCalledWith("run-1");
    expect(mockHeartbeatService.readLog).toHaveBeenCalledWith({
      id: "run-1",
      companyId: "company-1",
      logStore: "local_file",
      logRef: "logs/run-1.ndjson",
    }, {
      offset: 12,
      limitBytes: 64,
    });
    expect(res.body).toEqual({
      runId: "run-1",
      store: "local_file",
      logRef: "logs/run-1.ndjson",
      content: "chunk",
      nextOffset: 5,
    });
  });

  it("caps company live run polling by default", async () => {
    const rows = Array.from({ length: 75 }, (_, index) => ({
      id: `run-${index}`,
      companyId: "company-1",
      status: "running",
      invocationSource: "on_demand",
      triggerDetail: "manual",
      startedAt: new Date("2026-04-10T09:30:00.000Z"),
      finishedAt: null,
      createdAt: new Date(`2026-04-10T09:${String(index % 60).padStart(2, "0")}:00.000Z`),
      agentId: "agent-1",
      agentName: "Builder",
      adapterType: "codex_local",
      logBytes: 0,
      livenessState: "healthy",
      livenessReason: null,
      continuationAttempt: 0,
      lastUsefulActionAt: null,
      nextAction: null,
      lastOutputAt: null,
      lastOutputSeq: null,
      lastOutputStream: null,
      lastOutputBytes: 0,
      processStartedAt: null,
      issueId: "issue-1",
    }));
    const { db, limit } = createLiveRunsDbStub(rows);

    const res = await requestApp(
      await createApp(db),
      (baseUrl) => request(baseUrl).get("/api/companies/company-1/live-runs"),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(limit).toHaveBeenCalledWith(50);
    expect(res.body).toHaveLength(50);
    expect(mockHeartbeatService.buildRunOutputSilence).toHaveBeenCalledTimes(50);
  });

  it("treats explicit zero or invalid live run limit as the capped default", async () => {
    const rows = Array.from({ length: 75 }, (_, index) => ({
      id: `run-${index}`,
      companyId: "company-1",
      status: "running",
      invocationSource: "on_demand",
      triggerDetail: "manual",
      startedAt: new Date("2026-04-10T09:30:00.000Z"),
      finishedAt: null,
      createdAt: new Date(`2026-04-10T09:${String(index % 60).padStart(2, "0")}:00.000Z`),
      agentId: "agent-1",
      agentName: "Builder",
      adapterType: "codex_local",
      logBytes: 0,
      livenessState: "healthy",
      livenessReason: null,
      continuationAttempt: 0,
      lastUsefulActionAt: null,
      nextAction: null,
      lastOutputAt: null,
      lastOutputSeq: null,
      lastOutputStream: null,
      lastOutputBytes: 0,
      processStartedAt: null,
      issueId: "issue-1",
    }));
    const { db, limit } = createLiveRunsDbStub(rows);

    const res = await requestApp(
      await createApp(db),
      (baseUrl) => request(baseUrl).get("/api/companies/company-1/live-runs?limit=0&minCount=0"),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(limit).toHaveBeenCalledWith(50);
    expect(res.body).toHaveLength(50);
  });

  it("does not pad with recent runs when no minCount is requested", async () => {
    const liveRows = Array.from({ length: 8 }, (_, index) => ({
      id: `run-live-${index}`,
      companyId: "company-1",
      status: "running",
      invocationSource: "on_demand",
      triggerDetail: "manual",
      startedAt: new Date("2026-04-10T09:30:00.000Z"),
      finishedAt: null,
      createdAt: new Date(`2026-04-10T09:${String(index % 60).padStart(2, "0")}:00.000Z`),
      agentId: "agent-1",
      agentName: "Builder",
      adapterType: "codex_local",
      logBytes: 0,
      livenessState: "healthy",
      livenessReason: null,
      continuationAttempt: 0,
      lastUsefulActionAt: null,
      nextAction: null,
      lastOutputAt: null,
      lastOutputSeq: null,
      lastOutputStream: null,
      lastOutputBytes: 0,
      processStartedAt: null,
      issueId: "issue-1",
    }));

    const selectCalls: Array<ReturnType<typeof vi.fn>> = [];
    const db = {
      select: vi.fn().mockImplementation(() => {
        const limitFn = vi.fn(async (value: number) => liveRows.slice(0, value));
        const orderedQuery = {
          limit: limitFn,
          then: (resolve: (value: typeof liveRows) => unknown) =>
            Promise.resolve(liveRows).then(resolve),
        };
        const query = {
          from: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnValue(orderedQuery),
        };
        selectCalls.push(limitFn);
        return query;
      }),
    };

    const res = await requestApp(
      await createApp(db),
      (baseUrl) => request(baseUrl).get("/api/companies/company-1/live-runs"),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toHaveLength(8);
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it("pads with recent runs when minCount is explicitly requested", async () => {
    const liveRows = Array.from({ length: 2 }, (_, index) => ({
      id: `run-live-${index}`,
      companyId: "company-1",
      status: "running",
      invocationSource: "on_demand",
      triggerDetail: "manual",
      startedAt: new Date("2026-04-10T09:30:00.000Z"),
      finishedAt: null,
      createdAt: new Date(`2026-04-10T09:${String(index % 60).padStart(2, "0")}:00.000Z`),
      agentId: "agent-1",
      agentName: "Builder",
      adapterType: "codex_local",
      logBytes: 0,
      livenessState: "healthy",
      livenessReason: null,
      continuationAttempt: 0,
      lastUsefulActionAt: null,
      nextAction: null,
      lastOutputAt: null,
      lastOutputSeq: null,
      lastOutputStream: null,
      lastOutputBytes: 0,
      processStartedAt: null,
      issueId: "issue-1",
    }));
    const recentRows = Array.from({ length: 4 }, (_, index) => ({
      id: `run-recent-${index}`,
      companyId: "company-1",
      status: "succeeded",
      invocationSource: "on_demand",
      triggerDetail: "manual",
      startedAt: new Date("2026-04-09T09:30:00.000Z"),
      finishedAt: new Date("2026-04-09T09:35:00.000Z"),
      createdAt: new Date(`2026-04-09T09:${String(index % 60).padStart(2, "0")}:00.000Z`),
      agentId: "agent-1",
      agentName: "Builder",
      adapterType: "codex_local",
      logBytes: 0,
      livenessState: "healthy",
      livenessReason: null,
      continuationAttempt: 0,
      lastUsefulActionAt: null,
      nextAction: null,
      lastOutputAt: null,
      lastOutputSeq: null,
      lastOutputStream: null,
      lastOutputBytes: 0,
      processStartedAt: null,
      issueId: "issue-1",
    }));

    let selectCallCount = 0;
    const db = {
      select: vi.fn().mockImplementation(() => {
        selectCallCount += 1;
        const rows = selectCallCount === 1 ? liveRows : recentRows;
        const limitFn = vi.fn(async (value: number) => rows.slice(0, value));
        const orderedQuery = {
          limit: limitFn,
          then: (resolve: (value: typeof rows) => unknown) =>
            Promise.resolve(rows).then(resolve),
        };
        return {
          from: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnValue(orderedQuery),
        };
      }),
    };

    const res = await requestApp(
      await createApp(db),
      (baseUrl) => request(baseUrl).get("/api/companies/company-1/live-runs?minCount=4"),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toHaveLength(4);
    expect(db.select).toHaveBeenCalledTimes(2);
  });

  it("passes scoped wake fields through the legacy heartbeat invoke route", async () => {
    const res = await requestApp(
      await createApp(),
      (baseUrl) => request(baseUrl)
        .post(`/api/agents/${routeAgentId}/heartbeat/invoke?companyId=company-1`)
        .send({
          reason: "issue_assigned",
          payload: {
            issueId: "issue-1",
            taskId: "issue-1",
            taskKey: "issue-1",
          },
          forceFreshSession: true,
        }),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(202);
    // The legacy /heartbeat/invoke endpoint forwards only the wake fields the
    // caller actually supplied so empty-body callers (e.g. e2e suites) match
    // the original fixed-arg `heartbeat.invoke()` shape exactly. When the
    // caller supplies reason / payload / forceFreshSession those are
    // forwarded; idempotencyKey is omitted unless explicitly set.
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledWith(routeAgentId, {
      source: "on_demand",
      triggerDetail: "manual",
      reason: "issue_assigned",
      payload: {
        issueId: "issue-1",
        taskId: "issue-1",
        taskKey: "issue-1",
      },
      requestedByActorType: "user",
      requestedByActorId: "local-board",
      contextSnapshot: {
        triggeredBy: "board",
        actorId: "local-board",
        forceFreshSession: true,
      },
    });
  });

  it("calls heartbeat.wakeup with the legacy minimal shape when the body is empty", async () => {
    const res = await requestApp(
      await createApp(),
      (baseUrl) => request(baseUrl)
        .post(`/api/agents/${routeAgentId}/heartbeat/invoke?companyId=company-1`)
        .send({}),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledWith(routeAgentId, {
      source: "on_demand",
      triggerDetail: "manual",
      requestedByActorType: "user",
      requestedByActorId: "local-board",
      contextSnapshot: {
        triggeredBy: "board",
        actorId: "local-board",
      },
    });
  });

  it("queues assigned Hermes agent with complete server-owned task context", async () => {
    mockAgentService.getById.mockResolvedValueOnce({
      id: "agent-1",
      companyId: "company-1",
      name: "Builder",
      adapterType: "hermes_gateway",
    });
    const res = await requestApp(
      await createApp(createAgentHelpDbStub()),
      (baseUrl) => request(baseUrl)
        .post("/api/issues/PC1A2-1295/agent-help")
        .set("Idempotency-Key", "11111111-1111-4111-8111-111111111111")
        .send({}),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body).toEqual({
      launch_id: "run-1",
      issue_id: "issue-1",
      status: "queued",
      accepted_at: "2026-08-30T10:12:01.000Z",
    });
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledWith("agent-1", expect.objectContaining({
      idempotencyKey: "agent-help:user:local-board:issue-1:11111111-1111-4111-8111-111111111111",
      payload: {
        issueId: "issue-1",
        agent_help: {
          schema_version: "agent_help.task_context.v1",
          task: {
            id: "issue-1",
            title: "Prepare client demo",
            description: "Draft agenda and confirm attendees.",
            current_status: "in_progress",
          },
          project: {
            id: "project-1",
            goal: "Ship approved client demo by Friday.",
          },
        },
      },
    }));
  }, 15_000);

  it("uses null optional task context fields", async () => {
    mockIssueService.getByIdentifier.mockResolvedValueOnce({
      id: "issue-1",
      companyId: "company-1",
      assigneeAgentId: "agent-1",
      status: "todo",
      title: "Review release notes",
      description: "   ",
      projectId: null,
    });
    mockAgentService.getById.mockResolvedValueOnce({
      id: "agent-1",
      companyId: "company-1",
      adapterType: "hermes_gateway",
    });
    const res = await requestApp(
      await createApp(createAgentHelpDbStub()),
      (baseUrl) => request(baseUrl)
        .post("/api/issues/PC1A2-1295/agent-help")
        .set("Idempotency-Key", "22222222-2222-4222-8222-222222222222")
        .send({}),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledWith("agent-1", expect.objectContaining({
      payload: expect.objectContaining({
        agent_help: expect.objectContaining({
          task: expect.objectContaining({ description: null }),
          project: { id: null, goal: null },
        }),
      }),
    }));
  });

  it("returns byte-identical 404 responses for missing and cross-company tasks", async () => {
    const app = await createApp(createAgentHelpDbStub(), {
      type: "board",
      userId: "outsider",
      companyIds: ["other-company"],
      source: "session",
      memberships: [],
      isInstanceAdmin: false,
    });
    const inaccessible = await requestApp(
      app,
      (baseUrl) => request(baseUrl)
        .post("/api/issues/PC1A2-1295/agent-help")
        .set("Idempotency-Key", "33333333-3333-4333-8333-333333333333")
        .send({}),
    );
    mockIssueService.getByIdentifier.mockResolvedValueOnce(null);
    const missing = await requestApp(
      app,
      (baseUrl) => request(baseUrl)
        .post("/api/issues/PC1A2-MISSING/agent-help")
        .set("Idempotency-Key", "34333333-3333-4333-8333-333333333333")
        .send({}),
    );

    expect(inaccessible.status, JSON.stringify(inaccessible.body)).toBe(404);
    expect(missing.status, JSON.stringify(missing.body)).toBe(404);
    expect(inaccessible.text).toBe(missing.text);
    expect(inaccessible.body).toEqual({ error: "Task not found." });
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
  });

  it("denies agent and viewer actors but permits active board writers", async () => {
    const agentResponse = await requestApp(
      await createApp(createAgentHelpDbStub(), {
        type: "agent",
        agentId: "requesting-agent",
        companyId: "company-1",
        source: "agent_key",
      }),
      (baseUrl) => request(baseUrl)
        .post("/api/issues/PC1A2-1295/agent-help")
        .set("Idempotency-Key", "35333333-3333-4333-8333-333333333333")
        .send({}),
    );
    expect(agentResponse.status).toBe(403);
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();

    const viewerResponse = await requestApp(
      await createApp(createAgentHelpDbStub(), {
        type: "board",
        userId: "viewer",
        companyIds: ["company-1"],
        source: "session",
        memberships: [{ companyId: "company-1", status: "active", membershipRole: "viewer" }],
        isInstanceAdmin: false,
      }),
      (baseUrl) => request(baseUrl)
        .post("/api/issues/PC1A2-1295/agent-help")
        .set("Idempotency-Key", "36333333-3333-4333-8333-333333333333")
        .send({}),
    );
    expect(viewerResponse.status, JSON.stringify(viewerResponse.body)).toBe(403);
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();

    mockAgentService.getById.mockResolvedValueOnce({
      id: "agent-1",
      companyId: "company-1",
      adapterType: "hermes_gateway",
    });
    const writerResponse = await requestApp(
      await createApp(createAgentHelpDbStub(), {
        type: "board",
        userId: "writer",
        companyIds: ["company-1"],
        source: "session",
        memberships: [{ companyId: "company-1", status: "active", membershipRole: "member" }],
        isInstanceAdmin: false,
      }),
      (baseUrl) => request(baseUrl)
        .post("/api/issues/PC1A2-1295/agent-help")
        .set("Idempotency-Key", "37333333-3333-4333-8333-333333333333")
        .send({}),
    );
    expect(writerResponse.status, JSON.stringify(writerResponse.body)).toBe(202);
  }, 15_000);

  it("returns safe unavailable error when Hermes launch fails", async () => {
    mockAgentService.getById.mockResolvedValueOnce({
      id: "agent-1",
      companyId: "company-1",
      adapterType: "hermes_gateway",
    });
    mockHeartbeatService.wakeup.mockRejectedValueOnce(new Error("gateway token leaked"));
    const res = await requestApp(
      await createApp(createAgentHelpDbStub()),
      (baseUrl) => request(baseUrl)
        .post("/api/issues/PC1A2-1295/agent-help")
        .set("Idempotency-Key", "44444444-4444-4444-8444-444444444444")
        .send({}),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(503);
    expect(res.body).toEqual({
      error: "Agent launch is unavailable. Retry shortly.",
      code: "AGENT_LAUNCH_UNAVAILABLE",
      details: { code: "AGENT_LAUNCH_UNAVAILABLE" },
    });
    expect(JSON.stringify(res.body)).not.toContain("gateway token");
  });

  it("rejects agent-help requests carrying client-supplied fields", async () => {
    const res = await requestApp(
      await createApp(createAgentHelpDbStub()),
      (baseUrl) => request(baseUrl)
        .post("/api/issues/PC1A2-1295/agent-help")
        .set("Idempotency-Key", "55555555-5555-4555-8555-555555555555")
        .send({ title: "different task" }),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.code).toBe("INVALID_AGENT_HELP_REQUEST");
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
  });

  it("requires a valid UUID idempotency key", async () => {
    const res = await requestApp(
      await createApp(createAgentHelpDbStub()),
      (baseUrl) => request(baseUrl)
        .post("/api/issues/PC1A2-1295/agent-help")
        .send({}),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.code).toBe("INVALID_AGENT_HELP_REQUEST");
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
  });

  it("rejects secret-like task context before dispatch", async () => {
    mockIssueService.getByIdentifier.mockResolvedValueOnce({
      id: "issue-1",
      companyId: "company-1",
      assigneeAgentId: "agent-1",
      status: "in_progress",
      title: "Prepare client demo",
      description: "Draft agenda with API_KEY=sk-abc123 and confirm attendees.",
      projectId: null,
    });
    mockAgentService.getById.mockResolvedValueOnce({
      id: "agent-1",
      companyId: "company-1",
      adapterType: "hermes_gateway",
    });
    const res = await requestApp(
      await createApp(createAgentHelpDbStub()),
      (baseUrl) => request(baseUrl)
        .post("/api/issues/PC1A2-1295/agent-help")
        .set("Idempotency-Key", "66666666-6666-4666-8666-666666666666")
        .send({}),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.code).toBe("TASK_CONTEXT_CONTAINS_SECRET");
    expect(JSON.stringify(res.body)).not.toContain("sk-abc123");
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
  });

  it("rejects each supported secret class before durable wakeup writes", async () => {
    const secretCases = [
      { name: "PEM private key", field: "description", value: "-----BEGIN PRIVATE KEY----- synthetic" },
      { name: "JWT", field: "title", value: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.synthetic-signature" },
      { name: "authorization value", field: "status", value: "Bearer synthetic-token-value-12345" },
      { name: "credential URI", field: "description", value: "postgres://test-user:synthetic-pass@db.invalid/app" },
      { name: "cookie assignment", field: "description", value: "Cookie: sessionid=synthetic-session-value" },
      { name: "YAML assignment", field: "description", value: "AWS_SECRET_ACCESS_KEY: synthetic-value-12345" },
      { name: "provider prefix", field: "id", value: "sk-proj-syntheticproviderkey123456" },
      { name: "high entropy token", field: "description", value: "A8fQ2mZ7xK4pV9cR1nL6dS3wH5yB0uT8gJ2eN7qW" },
      { name: "project goal", field: "projectGoal", value: "AWS_SECRET_ACCESS_KEY: synthetic-value-12345" },
      { name: "project identifier", field: "projectId", value: "AIzaSyntheticProviderKeyValue12345" },
    ] as const;

    for (const [index, testCase] of secretCases.entries()) {
      const issue: Record<string, unknown> = {
        id: testCase.field === "id" ? testCase.value : "issue-1",
        companyId: "company-1",
        assigneeAgentId: "agent-1",
        status: testCase.field === "status" ? testCase.value : "in_progress",
        title: testCase.field === "title" ? testCase.value : "Prepare client demo",
        description: testCase.field === "description" ? testCase.value : "Draft agenda and confirm attendees.",
        projectId: testCase.field === "projectId" || testCase.field === "projectGoal" ? "project-1" : null,
      };
      mockIssueService.getByIdentifier.mockResolvedValueOnce(issue);
      if (testCase.field === "projectId" || testCase.field === "projectGoal") {
        mockProjectService.getById.mockResolvedValueOnce({
          id: testCase.field === "projectId" ? testCase.value : "project-1",
          companyId: "company-1",
          goalId: "goal-1",
          goals: [{ id: "goal-1", title: testCase.field === "projectGoal" ? testCase.value : "Safe project goal" }],
        });
      }
      const response = await requestApp(
        await createApp(createAgentHelpDbStub()),
        (baseUrl) => request(baseUrl)
          .post("/api/issues/PC1A2-1295/agent-help")
          .set("Idempotency-Key", `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`)
          .send({}),
      );
      expect(response.status, testCase.name).toBe(422);
      expect(response.body.code, testCase.name).toBe("TASK_CONTEXT_CONTAINS_SECRET");
    }
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
  });

  it("allows ordinary prose containing token and secret words", async () => {
    mockIssueService.getByIdentifier.mockResolvedValueOnce({
      id: "issue-1",
      companyId: "company-1",
      assigneeAgentId: "agent-1",
      status: "in_progress",
      title: "Document token handling",
      description: "Explain secret rotation and token lifecycle to reviewers.",
      projectId: null,
    });
    mockAgentService.getById.mockResolvedValueOnce({
      id: "agent-1",
      companyId: "company-1",
      adapterType: "hermes_gateway",
    });
    const response = await requestApp(
      await createApp(createAgentHelpDbStub()),
      (baseUrl) => request(baseUrl)
        .post("/api/issues/PC1A2-1295/agent-help")
        .set("Idempotency-Key", "45444444-4444-4444-8444-444444444444")
        .send({}),
    );
    expect(response.status, JSON.stringify(response.body)).toBe(202);
  });

  it("returns the prior launch for a duplicate idempotency key", async () => {
    mockHeartbeatService.getRun.mockResolvedValueOnce({
      id: "run-1",
      createdAt: new Date("2026-08-30T10:12:01.000Z"),
    });
    const res = await requestApp(
      await createApp(createAgentHelpDbStub([{ runId: "run-1" }])),
      (baseUrl) => request(baseUrl)
        .post("/api/issues/PC1A2-1295/agent-help")
        .set("Idempotency-Key", "77777777-7777-4777-8777-777777777777")
        .send({}),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body).toEqual({
      launch_id: "run-1",
      issue_id: "issue-1",
      status: "already_queued",
      accepted_at: "2026-08-30T10:12:01.000Z",
    });
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
  });

  it("uses null project goal when the project has no resolvable goal", async () => {
    mockAgentService.getById.mockResolvedValueOnce({
      id: "agent-1",
      companyId: "company-1",
      adapterType: "hermes_gateway",
    });
    mockProjectService.getById.mockResolvedValueOnce({
      id: "project-1",
      companyId: "company-1",
      goalId: "goal-1",
      goals: [],
    });
    const res = await requestApp(
      await createApp(createAgentHelpDbStub()),
      (baseUrl) => request(baseUrl)
        .post("/api/issues/PC1A2-1295/agent-help")
        .set("Idempotency-Key", "88888888-8888-4888-8888-888888888888")
        .send({}),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledWith("agent-1", expect.objectContaining({
      payload: expect.objectContaining({
        agent_help: expect.objectContaining({
          project: { id: "project-1", goal: null },
        }),
      }),
    }));
  });
});
