import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const companyId = "11111111-1111-4111-8111-111111111111";

const mockSchedulingService = vi.hoisted(() => ({
  getIssueScheduling: vi.fn(),
  upsertIssueScheduling: vi.fn(),
  upsertIssueSchedulingWithPrevious: vi.fn(),
  clearIssueScheduling: vi.fn(),
  createScheduledIssue: vi.fn(),
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
const mockPublishActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  accessService: () => mockAccessService,
  logActivity: mockLogActivity,
  publishActivity: mockPublishActivity,
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
  const fakeDb = { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}) };
  app.use("/api", schedulingRoutes(fakeDb as any));
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

  it("logs previous values with the write and publishes after commit", async () => {
    const issueId = "22222222-2222-4222-8222-222222222222";
    const row = (scheduledAt: string, minutes: number) => ({
      issueId, companyId, scheduledAt, deferUntil: null, scheduledDurationMinutes: minutes,
      createdAt: "2026-10-14T00:00:00.000Z", updatedAt: "2026-10-14T00:00:00.000Z",
    });
    mockSchedulingService.upsertIssueSchedulingWithPrevious.mockResolvedValue({
      scheduling: row("2026-10-14T03:00:00.000Z", 30),
      previous: row("2026-10-14T02:00:00.000Z", 15),
    });
    mockLogActivity.mockImplementation(async (_db: unknown, _input: unknown, pubs?: unknown[]) => {
      pubs?.push({ companyId, payload: {}, pluginEvent: null });
      return { id: "activity-1" };
    });

    const res = await request(await createApp(editorActor()))
      .put(`/api/companies/${companyId}/issues/${issueId}/scheduling`)
      .send({ scheduledAt: "2026-10-14T03:00:00.000Z" });

    expect(res.status).toBe(200);
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "issue.scheduling_updated",
        details: expect.objectContaining({
          scheduledDurationMinutes: 30,
          _previous: expect.objectContaining({
            scheduledAt: "2026-10-14T02:00:00.000Z",
            scheduledDurationMinutes: 15,
          }),
        }),
      }),
      expect.any(Array),
    );
    expect(mockPublishActivity).toHaveBeenCalledTimes(1);
  });

  it("does not publish and returns 500 when the activity write fails", async () => {
    const issueId = "22222222-2222-4222-8222-222222222222";
    mockSchedulingService.upsertIssueSchedulingWithPrevious.mockResolvedValue({
      scheduling: {
        issueId, companyId, scheduledAt: "2026-10-14T03:00:00.000Z", deferUntil: null,
        scheduledDurationMinutes: 30, createdAt: "2026-10-14T00:00:00.000Z", updatedAt: "2026-10-14T00:00:00.000Z",
      },
      previous: null,
    });
    mockLogActivity.mockRejectedValue(new Error("activity insert failed"));

    const res = await request(await createApp(editorActor()))
      .put(`/api/companies/${companyId}/issues/${issueId}/scheduling`)
      .send({ scheduledAt: "2026-10-14T03:00:00.000Z" });

    expect(res.status).toBe(500);
    expect(mockPublishActivity).not.toHaveBeenCalled();
  });

  it("creates a scheduled issue and logs issue.created and issue.scheduling_updated", async () => {
    const created = {
      issueId: "33333333-3333-4333-8333-333333333333",
      identifier: "T-9",
      title: "Quick task",
      deduplicated: false,
      scheduling: {
        issueId: "33333333-3333-4333-8333-333333333333", companyId, scheduledAt: null, deferUntil: null,
        scheduledDurationMinutes: 45, createdAt: "2026-10-14T00:00:00.000Z", updatedAt: "2026-10-14T00:00:00.000Z",
      },
    };
    mockSchedulingService.createScheduledIssue.mockImplementation(
      async (_c: string, _i: unknown, _a: unknown, afterWrite?: (tx: unknown, r: unknown) => Promise<void>) => {
        await afterWrite?.({}, created);
        return created;
      },
    );
    mockLogActivity.mockImplementation(async (_db: unknown, _input: unknown, pubs?: unknown[]) => {
      pubs?.push({ companyId, payload: {}, pluginEvent: null });
      return { id: "activity-1" };
    });

    const res = await request(await createApp(editorActor()))
      .post(`/api/companies/${companyId}/scheduled-issues`)
      .send({ title: "Quick task", estimateMinutes: 45 });

    expect(res.status).toBe(201);
    expect(res.body.issueId).toBe(created.issueId);
    const actions = mockLogActivity.mock.calls.map((call) => (call[1] as { action: string }).action);
    expect(actions).toEqual(["issue.created", "issue.scheduling_updated"]);
    expect(mockPublishActivity).toHaveBeenCalledTimes(2);
  });

  it("returns 200 and logs nothing when the request was already handled", async () => {
    const created = {
      issueId: "33333333-3333-4333-8333-333333333333", identifier: "T-9", title: "Quick task", deduplicated: true,
      scheduling: {
        issueId: "33333333-3333-4333-8333-333333333333", companyId, scheduledAt: null, deferUntil: null,
        scheduledDurationMinutes: 45, createdAt: "2026-10-14T00:00:00.000Z", updatedAt: "2026-10-14T00:00:00.000Z",
      },
    };
    mockSchedulingService.createScheduledIssue.mockImplementation(
      async (_c: string, _i: unknown, _a: unknown, afterWrite?: (tx: unknown, r: unknown) => Promise<void>) => {
        await afterWrite?.({}, created);
        return created;
      },
    );

    const res = await request(await createApp(editorActor()))
      .post(`/api/companies/${companyId}/scheduled-issues`)
      .send({ title: "Quick task", estimateMinutes: 45, clientRequestId: "44444444-4444-4444-8444-444444444444" });

    expect(res.status).toBe(200);
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("rejects agent actors on the quick-add create route", async () => {
    const res = await request(
      await createApp({ type: "agent", agentId: "agent-1", companyId, source: "agent_key" }),
    )
      .post(`/api/companies/${companyId}/scheduled-issues`)
      .send({ title: "Side door" });
    expect(res.status).toBe(403);
    expect(mockSchedulingService.createScheduledIssue).not.toHaveBeenCalled();
  });

  it("rejects an empty title with 400 before calling the service", async () => {
    const res = await request(await createApp(editorActor()))
      .post(`/api/companies/${companyId}/scheduled-issues`)
      .send({ title: "   " });
    expect(res.status).toBe(400);
    expect(mockSchedulingService.createScheduledIssue).not.toHaveBeenCalled();
  });

  it(
    "validates strict date ranges and pagination before listing scheduled issues",
    { timeout: 30_000 },
    async () => {
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
    },
  );

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
