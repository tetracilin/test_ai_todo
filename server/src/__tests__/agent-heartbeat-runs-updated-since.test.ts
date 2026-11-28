import express from "express";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockHeartbeatService = vi.hoisted(() => ({
  list: vi.fn(),
}));

const mockRunSecretRedactionRegistry = vi.hoisted(() => ({
  redactForRun: vi.fn(async (_companyId: string, _runId: string, value: unknown) => value),
}));

function registerModuleMocks() {
  vi.doMock("../routes/authz.js", async () => vi.importActual("../routes/authz.js"));

  vi.doMock("../services/heartbeat.js", () => ({
    heartbeatService: () => mockHeartbeatService,
  }));

  vi.doMock("../services/run-secret-redaction.js", () => ({
    createRunSecretRedactionRegistry: () => mockRunSecretRedactionRegistry,
  }));

  vi.doMock("../services/index.js", () => ({
    agentService: () => ({}),
    agentInstructionsService: () => ({}),
    accessService: () => ({
      canUser: vi.fn(async () => true),
      decide: vi.fn(async () => ({ allowed: true })),
      hasPermission: vi.fn(async () => true),
    }),
    approvalService: () => ({}),
    builtInAgentService: () => ({ ensureCompanyDefaultAgentGrants: vi.fn() }),
    companySkillService: () => ({ listRuntimeSkillEntries: vi.fn() }),
    budgetService: () => ({}),
    heartbeatService: () => mockHeartbeatService,
    heartbeat: mockHeartbeatService,
    issueApprovalService: () => ({}),
    issueService: () => ({}),
    logActivity: vi.fn(),
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

async function createApp(db: Record<string, unknown> = {}) {
  const [{ agentRoutes }, { errorHandler }] = await Promise.all([
    vi.importActual<typeof import("../routes/agents.js")>("../routes/agents.js"),
    vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      userId: "local-board",
      companyIds: ["company-1"],
      source: "local_implicit",
      isInstanceAdmin: false,
    };
    next();
  });
  app.use("/api", agentRoutes(db as any));
  app.use(errorHandler);
  return app;
}

describe("GET /companies/:companyId/heartbeat-runs with updatedSince", () => {
  registerModuleMocks();

  let app: express.Express;

  beforeAll(async () => {
    app = await createApp();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes updatedSince as Date to heartbeatService.list", async () => {
    mockHeartbeatService.list.mockResolvedValue([]);

    await request(app)
      .get("/api/companies/company-1/heartbeat-runs")
      .query({ updatedSince: "2026-11-25T10:00:00.000Z" });

    expect(mockHeartbeatService.list).toHaveBeenCalledWith(
      "company-1",
      undefined,
      undefined,
      expect.objectContaining({
        updatedSince: expect.any(Date),
      }),
    );

    const callArgs = mockHeartbeatService.list.mock.calls[0];
    const passedDate = callArgs[3].updatedSince;
    expect(passedDate.toISOString()).toBe("2026-11-25T10:00:00.000Z");
  });

  it("returns 400 on unparseable updatedSince", async () => {
    const response = await request(app)
      .get("/api/companies/company-1/heartbeat-runs")
      .query({ updatedSince: "not-a-date" });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Invalid updatedSince parameter");
    expect(mockHeartbeatService.list).not.toHaveBeenCalled();
  });

  it("omits updatedSince from options when not provided", async () => {
    mockHeartbeatService.list.mockResolvedValue([]);

    await request(app).get("/api/companies/company-1/heartbeat-runs");

    expect(mockHeartbeatService.list).toHaveBeenCalledWith(
      "company-1",
      undefined,
      undefined,
      expect.objectContaining({
        summary: false,
      }),
    );

    const callArgs = mockHeartbeatService.list.mock.calls[0];
    expect(callArgs[3].updatedSince).toBeUndefined();
  });

  it("combines updatedSince with other query parameters", async () => {
    mockHeartbeatService.list.mockResolvedValue([]);

    await request(app)
      .get("/api/companies/company-1/heartbeat-runs")
      .query({
        agentId: "agent-123",
        limit: "50",
        summary: "true",
        updatedSince: "2026-11-25T10:00:00.000Z",
      });

    expect(mockHeartbeatService.list).toHaveBeenCalledWith(
      "company-1",
      "agent-123",
      50,
      expect.objectContaining({
        summary: true,
        updatedSince: expect.any(Date),
      }),
    );
  });
});
