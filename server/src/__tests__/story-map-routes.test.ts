import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockService = vi.hoisted(() => ({
  getTree: vi.fn(),
  createActivity: vi.fn(),
  updateActivity: vi.fn(),
  deleteActivity: vi.fn(),
  createStory: vi.fn(),
  listScratchNotes: vi.fn(),
  createScratchNote: vi.fn(),
  updateScratchNote: vi.fn(),
  deleteScratchNote: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  storyMapService: () => mockService,
  logActivity: mockLogActivity,
}));

const COMPANY = "company-1";
const ID = "11111111-1111-4111-8111-111111111111";

async function createApp(actor: Record<string, unknown>) {
  vi.resetModules();
  const [{ errorHandler }, { storyMapRoutes }] = await Promise.all([
    import("../middleware/index.js") as Promise<typeof import("../middleware/index.js")>,
    import("../routes/story-map.js") as Promise<typeof import("../routes/story-map.js")>,
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", storyMapRoutes({} as any));
  app.use(errorHandler);
  return app;
}

const board = {
  type: "board",
  userId: "user-1",
  companyIds: [COMPANY],
  source: "session",
  isInstanceAdmin: false,
};

describe("story map routes", () => {
  beforeEach(() => {
    for (const mock of Object.values(mockService)) mock.mockReset();
    mockLogActivity.mockReset();
  });

  it("returns the whole map for a company member", async () => {
    mockService.getTree.mockResolvedValue({ map: null, activities: [], tasks: [], releases: [], epics: [], stories: [] });
    const res = await request(await createApp(board)).get(`/api/companies/${COMPANY}/story-map`);
    expect(res.status).toBe(200);
    expect(mockService.getTree).toHaveBeenCalledWith(COMPANY);
  });

  it("refuses a user who is not in the company", async () => {
    const res = await request(await createApp({ ...board, companyIds: ["other"] })).get(
      `/api/companies/${COMPANY}/story-map`,
    );
    expect(res.status).toBe(403);
    expect(mockService.getTree).not.toHaveBeenCalled();
  });

  it("creates an activity and logs it", async () => {
    mockService.createActivity.mockResolvedValue({ id: ID, name: "Plan work", position: 0 });
    const res = await request(await createApp(board))
      .post(`/api/companies/${COMPANY}/story-map/activities`)
      .send({ name: "Plan work" });
    expect(res.status).toBe(201);
    expect(mockService.createActivity).toHaveBeenCalledWith(COMPANY, { name: "Plan work" });
    expect(mockLogActivity).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        companyId: COMPANY,
        action: "story_map_activity.created",
        entityType: "story_map_activity",
        entityId: ID,
      }),
    );
  });

  it("rejects an invalid body before it reaches the service", async () => {
    const res = await request(await createApp(board))
      .post(`/api/companies/${COMPANY}/story-map/stories`)
      .send({ title: "No task" });
    expect(res.status).toBe(400);
    expect(mockService.createStory).not.toHaveBeenCalled();
  });

  it("does not let an agent change the map", async () => {
    const agent = { type: "agent", agentId: "agent-1", companyId: COMPANY, source: "agent_key" };
    const res = await request(await createApp(agent))
      .post(`/api/companies/${COMPANY}/story-map/activities`)
      .send({ name: "Plan work" });
    expect(res.status).toBe(403);
    expect(mockService.createActivity).not.toHaveBeenCalled();
  });

  it("deletes an item and logs the deletion", async () => {
    mockService.deleteActivity.mockResolvedValue({ id: ID, name: "Plan work", position: 0 });
    const res = await request(await createApp(board)).delete(`/api/companies/${COMPANY}/story-map/activities/${ID}`);
    expect(res.status).toBe(200);
    expect(mockService.deleteActivity).toHaveBeenCalledWith(COMPANY, ID);
    expect(mockLogActivity).toHaveBeenCalledWith({}, expect.objectContaining({ action: "story_map_activity.deleted" }));
  });
});

describe("scratch note routes", () => {
  beforeEach(() => {
    for (const mock of Object.values(mockService)) mock.mockReset();
    mockLogActivity.mockReset();
  });

  it("stores the note under the signed-in user and keeps the text out of the activity log", async () => {
    mockService.createScratchNote.mockResolvedValue({ id: ID, body: "An idea", authorUserId: "user-1" });
    const res = await request(await createApp(board))
      .post(`/api/companies/${COMPANY}/scratch-notes`)
      .send({ body: "An idea" });
    expect(res.status).toBe(201);
    expect(mockService.createScratchNote).toHaveBeenCalledWith(COMPANY, "user-1", { body: "An idea" });
    const entry = mockLogActivity.mock.calls[0]![1];
    expect(entry.action).toBe("scratch_note.created");
    expect(JSON.stringify(entry.details)).not.toContain("An idea");
  });

  it("rejects a note over 2,000 characters", async () => {
    const res = await request(await createApp(board))
      .post(`/api/companies/${COMPANY}/scratch-notes`)
      .send({ body: "x".repeat(2001) });
    expect(res.status).toBe(400);
    expect(mockService.createScratchNote).not.toHaveBeenCalled();
  });

  it("passes the acting user to the author check on edit and delete", async () => {
    mockService.updateScratchNote.mockResolvedValue({ id: ID, body: "Edited" });
    mockService.deleteScratchNote.mockResolvedValue({ id: ID, body: "Edited" });
    const app = await createApp(board);
    await request(app).patch(`/api/companies/${COMPANY}/scratch-notes/${ID}`).send({ body: "Edited" });
    await request(app).delete(`/api/companies/${COMPANY}/scratch-notes/${ID}`);
    expect(mockService.updateScratchNote).toHaveBeenCalledWith(COMPANY, ID, "user-1", { body: "Edited" });
    expect(mockService.deleteScratchNote).toHaveBeenCalledWith(COMPANY, ID, "user-1");
  });
});
