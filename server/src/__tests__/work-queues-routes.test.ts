import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockWorkQueueService = vi.hoisted(() => ({
  listQueues: vi.fn(),
  createQueue: vi.fn(),
  listItems: vi.fn(),
  addItem: vi.fn(),
  getItem: vi.fn(),
  promoteItem: vi.fn(),
  dismissItem: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  workQueueService: () => mockWorkQueueService,
  logActivity: mockLogActivity,
}));

async function createApp(actor: Record<string, unknown> = {
  type: "board",
  userId: "user-1",
  companyIds: ["company-1"],
  source: "session",
  isInstanceAdmin: false,
}) {
  vi.resetModules();
  const [{ errorHandler }, { workQueueRoutes }] = await Promise.all([
    import("../middleware/index.js") as Promise<typeof import("../middleware/index.js")>,
    import("../routes/work-queues.js") as Promise<typeof import("../routes/work-queues.js")>,
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", workQueueRoutes({} as any));
  app.use(errorHandler);
  return app;
}

describe("work queue routes", () => {
  beforeEach(() => {
    for (const mock of Object.values(mockWorkQueueService)) mock.mockReset();
    mockLogActivity.mockReset();
  });

  it("creates a queue and logs a work_queue.created activity", async () => {
    mockWorkQueueService.createQueue.mockResolvedValue({
      id: "queue-1",
      companyId: "company-1",
      name: "Support Intake",
      slug: "support-intake",
      description: null,
    });

    const app = await createApp();
    const res = await request(app)
      .post("/api/companies/company-1/work-queues")
      .send({ name: "Support Intake" });

    expect(res.status).toBe(201);
    expect(mockWorkQueueService.createQueue).toHaveBeenCalledWith("company-1", { name: "Support Intake" });
    expect(mockLogActivity).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        companyId: "company-1",
        action: "work_queue.created",
        entityType: "work_queue",
        entityId: "queue-1",
      }),
    );
  });

  it("lists items filtered by the status query parameter", async () => {
    mockWorkQueueService.listItems.mockResolvedValue([]);

    const app = await createApp();
    const res = await request(app).get("/api/companies/company-1/work-queues/queue-1/items?status=open");

    expect(res.status).toBe(200);
    expect(mockWorkQueueService.listItems).toHaveBeenCalledWith("company-1", "queue-1", { status: "open" });
  });

  it("rejects an invalid status query parameter with a 400", async () => {
    const app = await createApp();
    const res = await request(app).get("/api/companies/company-1/work-queues/queue-1/items?status=bogus");

    expect(res.status).toBe(400);
    expect(mockWorkQueueService.listItems).not.toHaveBeenCalled();
  });

  it("adds an item and logs a work_queue_item.added activity", async () => {
    mockWorkQueueService.addItem.mockResolvedValue({
      id: "item-1",
      queueId: "queue-1",
      title: "Follow up",
      sourceLabel: "email",
    });

    const app = await createApp();
    const res = await request(app)
      .post("/api/companies/company-1/work-queues/queue-1/items")
      .send({ title: "Follow up", sourceLabel: "email" });

    expect(res.status).toBe(201);
    expect(mockWorkQueueService.addItem).toHaveBeenCalledWith(
      "company-1",
      "queue-1",
      { title: "Follow up", sourceLabel: "email" },
      { agentId: null, userId: "user-1" },
    );
    expect(mockLogActivity).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        action: "work_queue_item.added",
        entityType: "work_queue_item",
        entityId: "item-1",
        details: { queueId: "queue-1", title: "Follow up", sourceLabel: "email" },
      }),
    );
  });

  it("promotes an item, returns the created issue, and logs work_queue_item.promoted", async () => {
    mockWorkQueueService.promoteItem.mockResolvedValue({
      item: { id: "item-1", status: "promoted" },
      issue: { id: "issue-1", title: "Follow up" },
    });

    const app = await createApp();
    const res = await request(app)
      .post("/api/companies/company-1/work-queues/queue-1/items/item-1/promote")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      item: { id: "item-1", status: "promoted" },
      issue: { id: "issue-1", title: "Follow up" },
    });
    expect(mockWorkQueueService.promoteItem).toHaveBeenCalledWith(
      "company-1",
      "item-1",
      {},
      { agentId: null, userId: "user-1" },
    );
    expect(mockLogActivity).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        action: "work_queue_item.promoted",
        entityType: "work_queue_item",
        entityId: "item-1",
        details: { issueId: "issue-1" },
      }),
    );
  });

  it("dismisses an item and logs work_queue_item.dismissed", async () => {
    mockWorkQueueService.dismissItem.mockResolvedValue({
      id: "item-1",
      status: "dismissed",
      dismissReason: "duplicate",
    });

    const app = await createApp();
    const res = await request(app)
      .post("/api/companies/company-1/work-queues/queue-1/items/item-1/dismiss")
      .send({ reason: "duplicate" });

    expect(res.status).toBe(200);
    expect(mockWorkQueueService.dismissItem).toHaveBeenCalledWith(
      "company-1",
      "item-1",
      { reason: "duplicate" },
      { agentId: null, userId: "user-1" },
    );
    expect(mockLogActivity).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        action: "work_queue_item.dismissed",
        entityType: "work_queue_item",
        entityId: "item-1",
        details: { reason: "duplicate" },
      }),
    );
  });

  it("rejects a cross-company request before touching the service", async () => {
    const app = await createApp({
      type: "agent",
      agentId: "agent-1",
      companyId: "company-2",
      source: "agent_key",
      keyId: "key-1",
    });

    const res = await request(app)
      .post("/api/companies/company-1/work-queues")
      .send({ name: "Support Intake" });

    expect(res.status).toBe(403);
    expect(mockWorkQueueService.createQueue).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();
  });
});
