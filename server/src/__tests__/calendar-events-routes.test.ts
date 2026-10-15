import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const companyId = "11111111-1111-4111-8111-111111111111";
const issueId = "22222222-2222-4222-8222-222222222222";

const mockCalendarEventsService = vi.hoisted(() => ({
  pinIssue: vi.fn(),
  unpinIssue: vi.fn(),
  listEvents: vi.fn(),
}));
const mockAccessService = vi.hoisted(() => ({ decide: vi.fn() }));
const mockLogActivity = vi.hoisted(() => vi.fn());
const mockPublishActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  accessService: () => mockAccessService,
  calendarEventsService: () => mockCalendarEventsService,
  logActivity: mockLogActivity,
  publishActivity: mockPublishActivity,
}));

async function createApp(actor: Record<string, unknown>) {
  const [{ errorHandler }, { calendarEventsRoutes }] = await Promise.all([
    import("../middleware/index.js"),
    import("../routes/calendar-events.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  const fakeDb = { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}) };
  app.use("/api", calendarEventsRoutes(fakeDb as any));
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

const event = (startsAt: string, endsAt: string) => ({
  id: "55555555-5555-4555-8555-555555555555", companyId, issueId, title: "Task",
  startsAt, endsAt, createdAt: "2026-10-14T00:00:00.000Z", updatedAt: "2026-10-14T00:00:00.000Z",
});

describe("calendar event routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccessService.decide.mockResolvedValue({ allowed: true, explanation: "allowed" });
    mockLogActivity.mockImplementation(async (_db: unknown, _input: unknown, pubs?: unknown[]) => {
      pubs?.push({ companyId, payload: {}, pluginEvent: null });
      return { id: "activity-1" };
    });
  });

  it("logs issue.event_pinned for a first pin, with no previous value", async () => {
    mockCalendarEventsService.pinIssue.mockResolvedValue({
      event: event("2026-10-14T03:00:00.000Z", "2026-10-14T03:30:00.000Z"), previous: null,
    });
    const res = await request(await createApp(editorActor()))
      .put(`/api/companies/${companyId}/issues/${issueId}/event`)
      .send({ startsAt: "2026-10-14T03:00:00.000Z", durationMinutes: 30 });
    expect(res.status).toBe(200);
    expect(res.body.event.endsAt).toBe("2026-10-14T03:30:00.000Z");
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "issue.event_pinned",
        entityType: "issue",
        entityId: issueId,
        details: expect.objectContaining({ _previous: null }),
      }),
      expect.any(Array),
    );
    expect(mockPublishActivity).toHaveBeenCalledTimes(1);
  });

  it("logs issue.event_moved with the previous times on a second pin", async () => {
    mockCalendarEventsService.pinIssue.mockResolvedValue({
      event: event("2026-10-14T09:50:00.000Z", "2026-10-14T10:20:00.000Z"),
      previous: event("2026-10-14T03:00:00.000Z", "2026-10-14T03:30:00.000Z"),
    });
    const res = await request(await createApp(editorActor()))
      .put(`/api/companies/${companyId}/issues/${issueId}/event`)
      .send({ startsAt: "2026-10-14T09:50:00.000Z" });
    expect(res.status).toBe(200);
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "issue.event_moved",
        details: expect.objectContaining({
          _previous: { startsAt: "2026-10-14T03:00:00.000Z", endsAt: "2026-10-14T03:30:00.000Z" },
        }),
      }),
      expect.any(Array),
    );
  });

  it("rejects both endsAt and durationMinutes with 400", async () => {
    const res = await request(await createApp(editorActor()))
      .put(`/api/companies/${companyId}/issues/${issueId}/event`)
      .send({ startsAt: "2026-10-14T03:00:00.000Z", endsAt: "2026-10-14T04:00:00.000Z", durationMinutes: 30 });
    expect(res.status).toBe(400);
    expect(mockCalendarEventsService.pinIssue).not.toHaveBeenCalled();
  });

  it("returns 403 when the permission check denies the actor", async () => {
    mockAccessService.decide.mockResolvedValue({ allowed: false, explanation: "denied" });
    const res = await request(await createApp(editorActor()))
      .put(`/api/companies/${companyId}/issues/${issueId}/event`)
      .send({ startsAt: "2026-10-14T03:00:00.000Z" });
    expect(res.status).toBe(403);
    expect(mockCalendarEventsService.pinIssue).not.toHaveBeenCalled();
  });

  it("unpins and logs issue.event_unpinned only when something was removed", async () => {
    mockCalendarEventsService.unpinIssue.mockResolvedValueOnce({
      deleted: true, previous: event("2026-10-14T03:00:00.000Z", "2026-10-14T03:30:00.000Z"),
    });
    const first = await request(await createApp(editorActor()))
      .delete(`/api/companies/${companyId}/issues/${issueId}/event`);
    expect(first.status).toBe(200);
    expect(first.body.deleted).toBe(true);
    expect(mockLogActivity).toHaveBeenCalledTimes(1);

    mockCalendarEventsService.unpinIssue.mockResolvedValueOnce({ deleted: false, previous: null });
    const second = await request(await createApp(editorActor()))
      .delete(`/api/companies/${companyId}/issues/${issueId}/event`);
    expect(second.body.deleted).toBe(false);
    expect(mockLogActivity).toHaveBeenCalledTimes(1);
  });

  it("validates range and limit on the list endpoint", async () => {
    mockCalendarEventsService.listEvents.mockResolvedValue({ items: [], nextCursor: null });
    const app = await createApp(editorActor());
    expect((await request(app).get(`/api/companies/${companyId}/calendar-events?limit=0`)).status).toBe(400);
    expect((await request(app).get(`/api/companies/${companyId}/calendar-events?limit=101`)).status).toBe(400);
    expect(
      (await request(app).get(`/api/companies/${companyId}/calendar-events?from=2026-10-15&to=2026-10-14`)).status,
    ).toBe(400);
    expect((await request(app).get(`/api/companies/${companyId}/calendar-events?limit=10`)).status).toBe(200);
  });
});
