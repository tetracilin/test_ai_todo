import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const companyId = "11111111-1111-4111-8111-111111111111";

const mockSchedulingService = vi.hoisted(() => ({
  getIssueScheduling: vi.fn(),
  upsertIssueScheduling: vi.fn(),
  clearIssueScheduling: vi.fn(),
  listScheduledIssues: vi.fn(),
  listRoutines: vi.fn(),
  getRoutine: vi.fn(),
  createRoutine: vi.fn(),
  updateRoutine: vi.fn(),
  deleteRoutine: vi.fn(),
  generateDueIssuesForRoutine: vi.fn(),
  generateDueIssues: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  decide: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  accessService: () => mockAccessService,
  logActivity: mockLogActivity,
  schedulingService: () => mockSchedulingService,
}));

async function createApp(actor: Record<string, unknown>) {
  const [{ errorHandler }, { schedulingRoutes }] = await Promise.all([
    import("../middleware/index.js"),
    import("../routes/scheduling.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", schedulingRoutes({} as any));
  app.use(errorHandler);
  return app;
}

function editorActor() {
  return {
    type: "board" as const,
    userId: "editor-user",
    source: "session" as const,
    isInstanceAdmin: false,
    companyIds: [companyId],
    memberships: [{ companyId, status: "active", membershipRole: "editor" }],
  };
}

describe("scheduling routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccessService.decide.mockResolvedValue({ allowed: true, explanation: "allowed" });
    mockSchedulingService.listScheduledIssues.mockResolvedValue({ items: [], nextCursor: null });
  });

  it("validates strict date ranges and pagination before listing scheduled issues", async () => {
    const app = await createApp(editorActor());

    const invalidDate = await request(app)
      .get(`/api/companies/${companyId}/scheduled-issues`)
      .query({ from: "2026-02-30T00:00:00Z" });
    const invertedRange = await request(app)
      .get(`/api/companies/${companyId}/scheduled-issues`)
      .query({ from: "2026-08-22T10:00:00Z", to: "2026-08-22T09:00:00Z" });
    const invalidLimit = await request(app)
      .get(`/api/companies/${companyId}/scheduled-issues`)
      .query({ limit: 101 });

    expect(invalidDate.status).toBe(400);
    expect(invertedRange.status).toBe(400);
    expect(invalidLimit.status).toBe(400);
    expect(mockSchedulingService.listScheduledIssues).not.toHaveBeenCalled();
  });

  it("passes bounded pagination to service and returns next cursor", async () => {
    const app = await createApp(editorActor());
    mockSchedulingService.listScheduledIssues.mockResolvedValue({
      items: [{ issueId: "issue-1" }],
      nextCursor: "opaque-next",
    });

    const response = await request(app)
      .get(`/api/companies/${companyId}/scheduled-issues`)
      .query({ limit: 25, cursor: "opaque-current" });

    expect(response.status).toBe(200);
    expect(mockSchedulingService.listScheduledIssues).toHaveBeenCalledWith(companyId, {
      from: undefined,
      to: undefined,
      limit: 25,
      cursor: "opaque-current",
    });
    expect(response.body).toEqual({ items: [{ issueId: "issue-1" }], nextCursor: "opaque-next" });
  });

  it("denies a cross-company agent without calling scheduling service", async () => {
    const app = await createApp({
      type: "agent",
      agentId: "22222222-2222-4222-8222-222222222222",
      companyId: "33333333-3333-4333-8333-333333333333",
      source: "agent_key",
    });

    const response = await request(app).get(`/api/companies/${companyId}/scheduled-issues`);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "Agent key cannot access another company" });
    expect(mockSchedulingService.listScheduledIssues).not.toHaveBeenCalled();
  });

  it("returns identical 404 responses for missing and cross-company issue scheduling", async () => {
    const app = await createApp(editorActor());
    const { HttpError } = await import("../errors.js");
    mockSchedulingService.getIssueScheduling.mockRejectedValue(new HttpError(404, "Issue not found"));

    const missing = await request(app)
      .get(`/api/companies/${companyId}/issues/missing-issue/scheduling`);
    const crossCompany = await request(app)
      .get(`/api/companies/${companyId}/issues/cross-company-issue/scheduling`);

    expect(missing.status).toBe(404);
    expect(crossCompany.status).toBe(404);
    expect(crossCompany.body).toEqual(missing.body);
  });

  it("requires tasks:assign permission before generating routine issues", async () => {
    const app = await createApp(editorActor());
    mockAccessService.decide.mockResolvedValue({ allowed: false, explanation: "Missing permission: tasks:assign" });

    const response = await request(app)
      .post(`/api/companies/${companyId}/scheduling-routines/generate`)
      .send({ asOf: "2026-08-22T12:00:00Z" });

    expect(response.status).toBe(403);
    expect(response.body.error).toContain("tasks:assign");
    expect(mockSchedulingService.generateDueIssues).not.toHaveBeenCalled();
  });

  it("requires tasks:assign permission before creating a scheduling routine", async () => {
    const app = await createApp(editorActor());
    mockAccessService.decide.mockResolvedValue({ allowed: false, explanation: "Missing permission: tasks:assign" });

    const response = await request(app)
      .post(`/api/companies/${companyId}/scheduling-routines`)
      .send({ title: "Daily task", recurrenceRule: { kind: "daily" } });

    expect(response.status).toBe(403);
    expect(response.body.error).toContain("tasks:assign");
    expect(mockSchedulingService.createRoutine).not.toHaveBeenCalled();
  });

  it("requires tasks:assign permission before updating a scheduling routine", async () => {
    const app = await createApp(editorActor());
    mockAccessService.decide.mockResolvedValue({ allowed: false, explanation: "Missing permission: tasks:assign" });

    const response = await request(app)
      .patch(`/api/companies/${companyId}/scheduling-routines/routine-1`)
      .send({ status: "paused" });

    expect(response.status).toBe(403);
    expect(mockSchedulingService.updateRoutine).not.toHaveBeenCalled();
  });

  it("requires tasks:assign permission before deleting a scheduling routine", async () => {
    const app = await createApp(editorActor());
    mockAccessService.decide.mockResolvedValue({ allowed: false, explanation: "Missing permission: tasks:assign" });

    const response = await request(app)
      .delete(`/api/companies/${companyId}/scheduling-routines/routine-1`);

    expect(response.status).toBe(403);
    expect(mockSchedulingService.deleteRoutine).not.toHaveBeenCalled();
  });

  it("requires tasks:assign permission before changing issue scheduling", async () => {
    const app = await createApp(editorActor());
    mockAccessService.decide.mockResolvedValue({ allowed: false, explanation: "Missing permission: tasks:assign" });

    const response = await request(app)
      .put(`/api/companies/${companyId}/issues/issue-1/scheduling`)
      .send({ scheduledAt: "2026-08-22T12:00:00Z" });

    expect(response.status).toBe(403);
    expect(mockSchedulingService.upsertIssueScheduling).not.toHaveBeenCalled();
  });
});
