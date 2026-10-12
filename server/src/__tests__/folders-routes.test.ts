import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFolderService = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  moveFolder: vi.fn(),
  moveItem: vi.fn(),
  deleteFolder: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  folderService: () => mockFolderService,
  logActivity: mockLogActivity,
}));

async function createApp() {
  vi.resetModules();
  const [{ errorHandler }, { folderRoutes }] = await Promise.all([
    import("../middleware/index.js") as Promise<typeof import("../middleware/index.js")>,
    import("../routes/folders.js") as Promise<typeof import("../routes/folders.js")>,
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      userId: "user-1",
      companyIds: ["company-1"],
      source: "session",
      isInstanceAdmin: false,
    };
    next();
  });
  app.use("/api", folderRoutes({} as any));
  app.use(errorHandler);
  return app;
}

describe("folder routes", () => {
  beforeEach(() => {
    for (const mock of Object.values(mockFolderService)) mock.mockReset();
    mockLogActivity.mockReset();
  });

  it("routes item moves to the item move handler before the folder reorder route", async () => {
    mockFolderService.moveItem.mockResolvedValue({
      kind: "routine",
      itemId: "11111111-1111-4111-8111-111111111111",
      folderId: "22222222-2222-4222-8222-222222222222",
    });

    const app = await createApp();
    const res = await request(app)
      .post("/api/companies/company-1/folders/items/move")
      .send({
        kind: "routine",
        itemId: "11111111-1111-4111-8111-111111111111",
        folderId: "22222222-2222-4222-8222-222222222222",
      });

    expect(res.status).toBe(200);
    expect(mockFolderService.moveItem).toHaveBeenCalledWith("company-1", {
      kind: "routine",
      itemId: "11111111-1111-4111-8111-111111111111",
      folderId: "22222222-2222-4222-8222-222222222222",
    });
    expect(mockFolderService.moveFolder).not.toHaveBeenCalled();
  });

  it("routes folder reorders to the folder move handler and logs the activity", async () => {
    const folderId = "33333333-3333-4333-8333-333333333333";
    mockFolderService.moveFolder.mockResolvedValue({
      id: folderId,
      kind: "routine",
      parentId: null,
      path: "reports",
      position: 2,
    });

    const app = await createApp();
    const res = await request(app)
      .post(`/api/companies/company-1/folders/${folderId}/move`)
      .send({ parentId: null, position: 2 });

    expect(res.status).toBe(200);
    expect(mockFolderService.moveFolder).toHaveBeenCalledWith("company-1", folderId, { parentId: null, position: 2 });
    expect(mockFolderService.moveItem).not.toHaveBeenCalled();
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ companyId: "company-1", action: "folder.moved", entityId: folderId }),
    );
  });

  it("returns 404 without logging when the folder to move does not exist", async () => {
    mockFolderService.moveFolder.mockResolvedValue(null);

    const app = await createApp();
    const res = await request(app)
      .post("/api/companies/company-1/folders/33333333-3333-4333-8333-333333333333/move")
      .send({ position: 0 });

    expect(res.status).toBe(404);
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("rejects an invalid item move body before reaching the service", async () => {
    const app = await createApp();
    const res = await request(app)
      .post("/api/companies/company-1/folders/items/move")
      .send({ kind: "routine", itemId: "not-a-uuid" });

    expect(res.status).toBe(400);
    expect(mockFolderService.moveItem).not.toHaveBeenCalled();
  });

  it("denies item moves for a company the actor cannot access", async () => {
    const app = await createApp();
    const res = await request(app)
      .post("/api/companies/company-2/folders/items/move")
      .send({
        kind: "routine",
        itemId: "11111111-1111-4111-8111-111111111111",
        folderId: null,
      });

    expect(res.status).toBe(403);
    expect(mockFolderService.moveItem).not.toHaveBeenCalled();
  });
});
