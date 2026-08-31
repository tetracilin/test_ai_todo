import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../errors.js";
import { errorHandler } from "../middleware/index.js";

const companyId = "22222222-2222-4222-8222-222222222222";
const otherCompanyId = "33333333-3333-4333-8333-333333333333";
const intakeId = "44444444-4444-4444-8444-444444444444";

const mockService = vi.hoisted(() => ({
  list: vi.fn(),
  getById: vi.fn(),
}));

vi.mock("../services/development-comment-intakes.js", () => ({
  developmentCommentIntakeService: () => mockService,
}));

async function loadRoutes() {
  const { developmentCommentIntakeRoutes } = await import("../routes/development-comment-intakes.js");
  return developmentCommentIntakeRoutes;
}

async function createApp(actor: Record<string, unknown>) {
  const developmentCommentIntakeRoutes = await loadRoutes();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { actor: unknown }).actor = {
      ...actor,
      companyIds: Array.isArray(actor.companyIds) ? [...actor.companyIds] : actor.companyIds,
    };
    next();
  });
  app.use("/api", developmentCommentIntakeRoutes({} as never));
  app.use(errorHandler);
  return app;
}

function listUrl(query?: Record<string, unknown>) {
  let url = `/api/companies/${companyId}/development-comment-intakes`;
  if (query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (Array.isArray(value)) {
        for (const entry of value) params.append(key, String(entry));
      } else if (value !== undefined) {
        params.set(key, String(value));
      }
    }
    url += `?${params.toString()}`;
  }
  return url;
}

const boardActorWithCompany = {
  type: "board",
  userId: "board-user",
  companyIds: [companyId],
  source: "session",
  isInstanceAdmin: false,
};

const boardActorWithoutCompany = {
  type: "board",
  userId: "other-board-user",
  companyIds: [otherCompanyId],
  source: "session",
  isInstanceAdmin: false,
};

const agentActorInCompany = {
  type: "agent",
  agentId: "agent-1",
  companyId,
  source: "agent_key",
};

const agentActorCrossCompany = {
  type: "agent",
  agentId: "agent-2",
  companyId: otherCompanyId,
  source: "agent_key",
};

const noneActor = { type: "none" };

const itemShape = {
  id: intakeId,
  source: { provider: "paperclip", commentId: "c-1", issueId: null, url: null, createdAt: "2026-08-30T10:00:00.000Z" },
  tag: "@dev",
  kind: "complaint",
  subject: "Export fails",
  requestBody: "@dev complaint: Export fails.",
  intakeStatus: "new",
  backlog: null,
  redactedAt: null,
  archivedAt: null,
};

function resetMockDefaults() {
  vi.clearAllMocks();
  mockService.list.mockReset();
  mockService.getById.mockReset();
  mockService.list.mockResolvedValue({ items: [], nextCursor: null });
  mockService.getById.mockResolvedValue(null);
}

describe("development comment intake routes", () => {
  beforeEach(() => {
    resetMockDefaults();
  });

  it("returns 401 for unauthenticated callers on list and detail", async () => {
    const app = await createApp(noneActor);
    const listRes = await request(app).get(listUrl());
    expect(listRes.status).toBe(401);

    const detailRes = await request(app).get(`/api/companies/${companyId}/development-comment-intakes/${intakeId}`);
    expect(detailRes.status).toBe(401);
    expect(mockService.list).not.toHaveBeenCalled();
    expect(mockService.getById).not.toHaveBeenCalled();
  });

  it("returns 403 for an agent key scoped to another company", async () => {
    const app = await createApp(agentActorCrossCompany);
    const res = await request(app).get(listUrl());
    expect(res.status).toBe(403);
    expect(res.body.error).toContain("another company");
    expect(mockService.list).not.toHaveBeenCalled();
  });

  it("returns 403 for a board user without company access", async () => {
    const app = await createApp(boardActorWithoutCompany);
    const res = await request(app).get(listUrl());
    expect(res.status).toBe(403);
    expect(mockService.list).not.toHaveBeenCalled();
  });

  it("allows an in-company agent key and passes normalized filters to the service", async () => {
    const app = await createApp(agentActorInCompany);
    mockService.list.mockResolvedValue({ items: [itemShape], nextCursor: null });

    const res = await request(app).get(
      listUrl({ tag: "@dev", source: "paperclip", kind: "suggestion", status: ["new", "triaged"], limit: 5 }),
    );

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([itemShape]);
    expect(res.body.nextCursor).toBeNull();
    expect(mockService.list).toHaveBeenCalledWith(companyId, {
      tag: "@dev",
      source: "paperclip",
      kind: "suggestion",
      status: ["new", "triaged"],
      backlogStatus: [],
      limit: 5,
    });
  });

  it("allows an authorized board user and applies default limit", async () => {
    const app = await createApp(boardActorWithCompany);
    await request(app).get(listUrl());
    expect(mockService.list).toHaveBeenCalledWith(
      companyId,
      expect.objectContaining({ limit: 50, status: [], backlogStatus: [] }),
    );
  });

  it("returns 400 for invalid kind and time-range filters", async () => {
    const app = await createApp(boardActorWithCompany);

    const badKind = await request(app).get(listUrl({ kind: "banana" }));
    expect(badKind.status).toBe(400);
    expect(badKind.body.error).toContain("kind");

    const badRange = await request(app).get(
      listUrl({ createdAfter: "2026-08-30T00:00:00.000Z", createdBefore: "2026-08-01T00:00:00.000Z" }),
    );
    expect(badRange.status).toBe(400);

    const badTimestamp = await request(app).get(listUrl({ createdAfter: "not-a-time" }));
    expect(badTimestamp.status).toBe(400);

    expect(mockService.list).not.toHaveBeenCalled();
  });

  it("returns 400 for out-of-range limit", async () => {
    const app = await createApp(boardActorWithCompany);
    const tooSmall = await request(app).get(listUrl({ limit: 0 }));
    expect(tooSmall.status).toBe(400);

    const tooLarge = await request(app).get(listUrl({ limit: 101 }));
    expect(tooLarge.status).toBe(400);

    const nonNumeric = await request(app).get(listUrl({ limit: "abc" }));
    expect(nonNumeric.status).toBe(400);

    expect(mockService.list).not.toHaveBeenCalled();
  });

  it("returns 400 when the service rejects a cursor bound to a different filter set", async () => {
    mockService.list.mockRejectedValue(new HttpError(400, "cursor does not match the requested filters"));
    const app = await createApp(boardActorWithCompany);

    const res = await request(app).get(listUrl({ cursor: "opaque-cursor" }));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("cursor");
  });

  it("returns indistinguishable 404 for missing or cross-company intakes on detail", async () => {
    const app = await createApp(boardActorWithCompany);
    const missing = await request(app).get(`/api/companies/${companyId}/development-comment-intakes/${intakeId}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("Development comment intake not found");
    expect(mockService.getById).toHaveBeenCalledWith(companyId, intakeId);
  });

  it("returns the intake item shape on detail", async () => {
    mockService.getById.mockResolvedValue(itemShape);
    const app = await createApp(boardActorWithCompany);
    const res = await request(app).get(`/api/companies/${companyId}/development-comment-intakes/${intakeId}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(itemShape);
  });

  it("provides no mutation surface for agent credentials", async () => {
    const app = await createApp(agentActorInCompany);
    const post = await request(app).post(listUrl()).send({});
    expect([400, 404]).toContain(post.status);
    const patch = await request(app).patch(`/api/companies/${companyId}/development-comment-intakes/${intakeId}`).send({});
    expect([400, 404]).toContain(patch.status);
    expect(mockService.list).not.toHaveBeenCalled();
    expect(mockService.getById).not.toHaveBeenCalled();
  });
});