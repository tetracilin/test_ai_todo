import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createIssue = vi.hoisted(() => vi.fn());
vi.mock("../services/issues.js", () => ({ issueService: () => ({ create: createIssue }) }));

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const ISSUE_ID = "33333333-3333-4333-8333-333333333333";
const bridgeToken = "test-discord-bridge-token";
const taskRequest = {
  discordInteractionId: "interaction-1",
  discordUserId: "discord-user-1",
  guildId: "guild-1",
  channelId: "channel-1",
  parentChannelId: null,
  commandName: "paperclip task create",
  title: "Create Discord task",
  description: "Task details",
  priority: "urgent",
} as const;
const mapping = {
  companyId: COMPANY_ID,
  projectId: PROJECT_ID,
  allowTaskCreate: true,
  enabled: true,
  channelId: "channel-1",
  notificationEvents: [],
};
const linkedUser = { companyId: COMPANY_ID, discordUserId: "discord-user-1", userId: "user-1", active: true };
const createdIssue = { id: ISSUE_ID, identifier: "PAP-1", title: taskRequest.title };

type FakeDbOptions = {
  selectRows: unknown[][];
  insertError?: Error;
};

function fakeDb({ selectRows, insertError }: FakeDbOptions) {
  const insert = vi.fn(() => ({
    values: vi.fn(() => {
      if (insertError) throw insertError;
      return { returning: vi.fn(async () => [{ id: "event-1" }]) };
    }),
  }));
  const update = vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => []) })) }));
  const select = vi.fn(() => {
    const rows = selectRows.shift() ?? [];
    const query = {
      from: vi.fn(() => query),
      innerJoin: vi.fn(() => query),
      where: vi.fn(() => query),
      limit: vi.fn(() => query),
      then: <T>(resolve: (value: unknown[]) => T, reject?: (reason: unknown) => T) => Promise.resolve(rows).then(resolve, reject),
    };
    return query;
  });
  return { select, insert, update };
}

async function buildApp(db: ReturnType<typeof fakeDb>) {
  const [{ discordIntegrationRoutes }, { errorHandler }] = await Promise.all([
    import("./discord-integrations.js"),
    import("../middleware/error-handler.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use("/api", discordIntegrationRoutes(db as never));
  app.use(errorHandler);
  return app;
}

function bridgePost(app: express.Express) {
  return request(app)
    .post("/api/integrations/discord/commands/task-create")
    .set("Authorization", `Bearer ${bridgeToken}`);
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.PAPERCLIP_DISCORD_BRIDGE_TOKEN = bridgeToken;
  process.env.PAPERCLIP_DASHBOARD_URL = "https://paperclip.example";
  createIssue.mockResolvedValue(createdIssue);
});

afterEach(() => {
  delete process.env.PAPERCLIP_DISCORD_BRIDGE_TOKEN;
  delete process.env.PAPERCLIP_DASHBOARD_URL;
});

describe("POST /integrations/discord/commands/task-create", () => {
  it("creates one project-mapped task for an active linked non-viewer", async () => {
    const db = fakeDb({ selectRows: [[], [{ discord_project_channel_mappings: mapping }], [linkedUser], [{ id: "membership-1" }], []] });
    const app = await buildApp(db);

    const response = await bridgePost(app).send(taskRequest).expect(201);

    expect(response.body).toEqual({
      duplicate: false,
      issue: { id: ISSUE_ID, identifier: "PAP-1", title: taskRequest.title, url: "https://paperclip.example/issues/PAP-1" },
    });
    expect(createIssue).toHaveBeenCalledWith(COMPANY_ID, expect.objectContaining({
      idempotencyKey: "discord:interaction-1",
      projectId: PROJECT_ID,
      createdByUserId: "user-1",
      priority: "high",
      originKind: "discord",
    }));
  });

  it("rejects malformed commands before any database access", async () => {
    const db = fakeDb({ selectRows: [] });
    const app = await buildApp(db);

    await bridgePost(app).send({ ...taskRequest, title: " " }).expect(400);

    expect(db.select).not.toHaveBeenCalled();
    expect(createIssue).not.toHaveBeenCalled();
  });

  it("rejects unconfigured channels without creating a task", async () => {
    const db = fakeDb({ selectRows: [[], []] });
    const app = await buildApp(db);

    const response = await bridgePost(app).send(taskRequest).expect(403);

    expect(response.body.code).toBe("channel_not_mapped");
    expect(createIssue).not.toHaveBeenCalled();
  });

  it("rejects an unlinked Discord user with linking feedback code", async () => {
    const db = fakeDb({ selectRows: [[], [{ discord_project_channel_mappings: mapping }], []] });
    const app = await buildApp(db);

    const response = await bridgePost(app).send(taskRequest).expect(403);

    expect(response.body.code).toBe("not_linked");
    expect(createIssue).not.toHaveBeenCalled();
  });

  it("rejects a linked viewer without creating a task", async () => {
    const db = fakeDb({ selectRows: [[], [{ discord_project_channel_mappings: mapping }], [linkedUser], []] });
    const app = await buildApp(db);

    const response = await bridgePost(app).send(taskRequest).expect(403);

    expect(response.body.code).toBe("project_access_denied");
    expect(createIssue).not.toHaveBeenCalled();
  });

  it("returns existing task for a duplicate interaction", async () => {
    const db = fakeDb({ selectRows: [[{ issueId: ISSUE_ID }], [createdIssue]] });
    const app = await buildApp(db);

    const response = await bridgePost(app).send(taskRequest).expect(200);

    expect(response.body).toEqual({
      duplicate: true,
      issue: { id: ISSUE_ID, identifier: "PAP-1", title: taskRequest.title, url: "https://paperclip.example/issues/PAP-1" },
    });
    expect(createIssue).not.toHaveBeenCalled();
  });

  it("collapses a racing duplicate insert to existing task", async () => {
    const duplicateError = Object.assign(new Error("duplicate"), {
      code: "23505",
      constraint: "discord_inbound_requests_interaction_uq",
    });
    const db = fakeDb({
      insertError: duplicateError,
      selectRows: [[], [{ discord_project_channel_mappings: mapping }], [linkedUser], [{ id: "membership-1" }], [{ issueId: ISSUE_ID }], [createdIssue]],
    });
    const app = await buildApp(db);

    const response = await bridgePost(app).send(taskRequest).expect(200);

    expect(response.body.duplicate).toBe(true);
    expect(createIssue).not.toHaveBeenCalled();
  });

  it("records failed inbound request and returns server error when creation fails", async () => {
    createIssue.mockRejectedValueOnce(new Error("upstream unavailable"));
    const db = fakeDb({ selectRows: [[], [{ discord_project_channel_mappings: mapping }], [linkedUser], [{ id: "membership-1" }]] });
    const app = await buildApp(db);

    await bridgePost(app).send(taskRequest).expect(500);

    expect(db.update).toHaveBeenCalledTimes(1);
  });
});
