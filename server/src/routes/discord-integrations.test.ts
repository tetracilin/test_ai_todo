import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createIssue = vi.hoisted(() => vi.fn());
vi.mock("../services/issues.js", () => ({ issueService: () => ({ create: createIssue }) }));
const dmInbox = vi.hoisted(() => ({
  claim: vi.fn(),
  succeed: vi.fn(),
  fail: vi.fn(),
  replayCursors: vi.fn(),
  recordDowntime: vi.fn(),
}));
vi.mock("../services/discord-dm-inbox.js", () => ({ discordDmInbox: () => dmInbox }));
const createFromJobOrder = vi.hoisted(() => vi.fn());
vi.mock("../services/discord-intake.js", () => ({ discordIntakeService: () => ({ createFromJobOrder }) }));

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
  const update = vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => Object.assign(Promise.resolve([]), { returning: vi.fn(async () => []) })),
    })),
  }));
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
  app.use((req, _res, next) => {
    req.actor = { type: "board", userId: "user-1", companyIds: [COMPANY_ID], isInstanceAdmin: true, source: "session" };
    next();
  });
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
  dmInbox.claim.mockResolvedValue({ claimed: true });
  dmInbox.succeed.mockResolvedValue(undefined);
  dmInbox.fail.mockResolvedValue(undefined);
  createFromJobOrder.mockResolvedValue({ issue: { id: ISSUE_ID, identifier: "PAP-7", title: "Thay tủ điện tầng 3" }, duplicate: false, triage: false });
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

  it("rate limits repeated task creation for one Discord interaction", async () => {
    const app = await buildApp(fakeDb({ selectRows: [] }));

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await bridgePost(app).send({ ...taskRequest, discordInteractionId: "rate-limited-interaction" }).expect(403);
    }
    const response = await bridgePost(app).send({ ...taskRequest, discordInteractionId: "rate-limited-interaction" }).expect(429);

    expect(response.body.code).toBe("task_create_rate_limited");
  });
});

describe("POST /integrations/discord/dm/inbound", () => {
  const dm = { discordUserId: "discord-user-1", messageId: "message-1", channelId: "dm-channel-1", content: "trợ giúp", attachments: [] };
  const primaryLink = { ...linkedUser, primary: true };
  const company = { attachmentMaxBytes: 1024 };

  function dmPost(app: express.Express) {
    return request(app).post("/api/integrations/discord/dm/inbound").set("Authorization", `Bearer ${bridgeToken}`);
  }

  it("requires the bridge token", async () => {
    const app = await buildApp(fakeDb({ selectRows: [] }));

    const response = await request(app).post("/api/integrations/discord/dm/inbound").send(dm).expect(401);

    expect(response.body.code).toBe("bridge_auth_required");
  });

  it("answers an unlinked sender with silence", async () => {
    const db = fakeDb({ selectRows: [[]] });
    const app = await buildApp(db);

    const response = await dmPost(app).send(dm).expect(200);

    expect(response.body).toEqual({ linked: false });
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it("answers a linked viewer with the same silence", async () => {
    const app = await buildApp(fakeDb({ selectRows: [[primaryLink], []] }));

    const response = await dmPost(app).send(dm).expect(200);

    expect(response.body).toEqual({ linked: false });
  });

  it("does not guess between two company links", async () => {
    const other = { ...primaryLink, companyId: "44444444-4444-4444-8444-444444444444" };
    const app = await buildApp(fakeDb({ selectRows: [[primaryLink, other]] }));

    const response = await dmPost(app).send(dm).expect(200);

    expect(response.body).toEqual({ linked: false });
  });

  it("uses the single primary link when another link is not primary", async () => {
    const other = { ...primaryLink, companyId: "44444444-4444-4444-8444-444444444444", primary: false };
    const app = await buildApp(fakeDb({ selectRows: [[other, primaryLink], [{ id: "membership-1" }], [company]] }));

    const response = await dmPost(app).send(dm).expect(200);

    expect(response.body.linked).toBe(true);
    expect(response.body.companyId).toBe(COMPANY_ID);
  });

  it.each(["trợ giúp", "tro giup", "help"])("answers the help verb %s with the phrase table", async (content) => {
    const { renderWp0HelpMessage } = await import("@paperclipai/shared");
    const app = await buildApp(fakeDb({ selectRows: [[primaryLink], [{ id: "membership-1" }], [company]] }));

    const response = await dmPost(app).send({ ...dm, content }).expect(200);

    expect(response.body).toEqual({ linked: true, companyId: COMPANY_ID, reply: renderWp0HelpMessage(), attachments: [] });
  });

  it("echoes unrecognized text inside the unknown-phrase reply", async () => {
    const { renderWp0Message } = await import("@paperclipai/shared");
    const app = await buildApp(fakeDb({ selectRows: [[primaryLink], [{ id: "membership-1" }], [company]] }));

    const response = await dmPost(app).send({ ...dm, content: "  xyz abc  " }).expect(200);

    expect(response.body.reply).toBe(renderWp0Message("unknown_phrase", { input: "xyz abc" }));
  });

  it("rejects disallowed or oversized attachments from metadata alone", async () => {
    const { renderWp0Message } = await import("@paperclipai/shared");
    const app = await buildApp(fakeDb({ selectRows: [[primaryLink], [{ id: "membership-1" }], [company]] }));

    const response = await dmPost(app).send({
      ...dm,
      content: "",
      attachments: [
        { id: "a-1", filename: "photo.png", contentType: "image/png", size: 512 },
        { id: "a-2", filename: "setup.exe", contentType: "application/x-msdownload", size: 512 },
        { id: "a-3", filename: "big.png", contentType: "image/png", size: 2048 },
        { id: "a-4", filename: "unknown.bin", contentType: null, size: 10 },
      ],
    }).expect(200);

    expect(response.body.attachments).toEqual([
      { id: "a-1", accepted: true },
      { id: "a-2", accepted: false, reason: "content_type_not_allowed" },
      { id: "a-3", accepted: false, reason: "too_large" },
      { id: "a-4", accepted: false, reason: "content_type_not_allowed" },
    ]);
    expect(response.body.reply).toBe(renderWp0Message("media_rejected", { item: "tệp setup.exe" }));
  });

  it("rate limits one Discord user's DMs", async () => {
    const app = await buildApp(fakeDb({ selectRows: [] }));

    for (let attempt = 0; attempt < 30; attempt += 1) {
      await dmPost(app).send({ ...dm, discordUserId: "chatty-user" }).expect(200);
    }
    const response = await dmPost(app).send({ ...dm, discordUserId: "chatty-user" }).expect(429);

    expect(response.body.code).toBe("dm_rate_limited");
  });
});

describe("Discord integration abuse and tenant boundaries", () => {
  it("rate limits link-code minting per board user", async () => {
    const app = await buildApp(fakeDb({ selectRows: [] }));

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app).post("/api/integrations/discord/link-codes").send({ companyId: COMPANY_ID }).expect(201);
    }
    const response = await request(app).post("/api/integrations/discord/link-codes").send({ companyId: COMPANY_ID }).expect(429);

    expect(response.body.code).toBe("link_code_rate_limited");
  });

  it("requires companyId when bridge unlinks an account", async () => {
    const app = await buildApp(fakeDb({ selectRows: [] }));

    await request(app)
      .post("/api/integrations/discord/unlink")
      .set("Authorization", `Bearer ${bridgeToken}`)
      .send({ discordUserId: "discord-user-1" })
      .expect(400);
  });

  it("accepts a company-scoped bridge unlink", async () => {
    const app = await buildApp(fakeDb({ selectRows: [] }));

    await request(app)
      .post("/api/integrations/discord/unlink")
      .set("Authorization", `Bearer ${bridgeToken}`)
      .send({ companyId: COMPANY_ID, discordUserId: "discord-user-1" })
      .expect(200, { status: "unlinked" });
  });
});

describe("Discord integration browser contracts", () => {
  it("returns channels and guilds from settings", async () => {
    const app = await buildApp(fakeDb({ selectRows: [[], [], [], []] }));

    const response = await request(app)
      .get(`/api/integrations/discord/settings?companyId=${COMPANY_ID}`)
      .expect(200);

    expect(response.body).toMatchObject({
      link: { status: "unlinked", discordUserId: null },
      guilds: [],
      channels: [],
    });
    expect(response.body.preferences).toHaveLength(9);
  });

  it("accepts the exact preferences envelope", async () => {
    const app = await buildApp(fakeDb({ selectRows: [[], [], [], []] }));

    const response = await request(app)
      .patch("/api/integrations/discord/preferences")
      .send({ companyId: COMPANY_ID, preferences: [] })
      .expect(200);

    expect(response.body).toMatchObject({
      link: { status: "unlinked", discordUserId: null },
      guilds: [],
      channels: [],
    });
    expect(response.body.preferences).toHaveLength(9);
  });

  it("rejects unknown fields in the preferences envelope", async () => {
    const app = await buildApp(fakeDb({ selectRows: [] }));

    const response = await request(app)
      .patch("/api/integrations/discord/preferences")
      .send({ companyId: COMPANY_ID, preferences: [], unexpected: true })
      .expect(400);

    expect(response.body.error).toBe("Validation error");
  });

  it("returns full settings after board disconnect", async () => {
    const app = await buildApp(fakeDb({ selectRows: [[], [], [], []] }));

    const response = await request(app)
      .post("/api/integrations/discord/disconnect")
      .send({ companyId: COMPANY_ID })
      .expect(200);

    expect(response.body).toMatchObject({
      link: { status: "unlinked", discordUserId: null },
      guilds: [],
      channels: [],
    });
    expect(response.body.preferences).toHaveLength(9);
  });
});
