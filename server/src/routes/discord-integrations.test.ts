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
const capture = vi.hoisted(() => vi.fn());
vi.mock("../services/discord-capture.js", () => ({ discordCaptureService: () => ({ capture }) }));

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

/** Stands in for the evidence bucket: its presence is what switches capture on. */
const evidenceBucket = { id: "s3" } as never;

async function buildApp(db: ReturnType<typeof fakeDb>, routeOptions: { externalStorage?: unknown } = { externalStorage: evidenceBucket }) {
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
  app.use("/api", discordIntegrationRoutes(db as never, routeOptions as never));
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

    expect(response.body).toEqual({ linked: true, companyId: COMPANY_ID, duplicate: false, reply: renderWp0HelpMessage(), attachments: [] });
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

  it("never throttles a replay, which the bridge paces itself", async () => {
    const app = await buildApp(fakeDb({ selectRows: [] }));

    for (let attempt = 0; attempt < 40; attempt += 1) {
      await dmPost(app).send({ ...dm, discordUserId: "replayed-user", replay: true }).expect(200);
    }
  });

  // F-DM-3: the ledger claim keyed on the Discord message id.
  it("claims the message before answering and settles it after", async () => {
    const app = await buildApp(fakeDb({ selectRows: [[primaryLink], [{ id: "membership-1" }], [company]] }));

    await dmPost(app).send({ ...dm, messageCreatedAt: "2026-11-08T03:00:00.000Z" }).expect(200);

    expect(dmInbox.claim).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      discordUserId: "discord-user-1",
      discordMessageId: "message-1",
      channelId: "dm-channel-1",
      messageCreatedAt: new Date("2026-11-08T03:00:00.000Z"),
    });
    expect(dmInbox.succeed).toHaveBeenCalledWith("message-1");
    expect(dmInbox.fail).not.toHaveBeenCalled();
  });

  it("answers an already-handled message id as a silent duplicate", async () => {
    dmInbox.claim.mockResolvedValue({ claimed: false });
    const db = fakeDb({ selectRows: [[primaryLink], [{ id: "membership-1" }]] });
    const app = await buildApp(db);

    const response = await dmPost(app).send({ ...dm, replay: true }).expect(200);

    expect(response.body).toEqual({ linked: true, companyId: COMPANY_ID, duplicate: true });
    expect(db.select).toHaveBeenCalledTimes(2);
    expect(dmInbox.succeed).not.toHaveBeenCalled();
  });

  it("never records a stranger's message in the ledger", async () => {
    const app = await buildApp(fakeDb({ selectRows: [[]] }));

    await dmPost(app).send(dm).expect(200);

    expect(dmInbox.claim).not.toHaveBeenCalled();
  });

  it("releases the claim when processing fails, so the replay can retry it", async () => {
    const db = fakeDb({ selectRows: [[primaryLink], [{ id: "membership-1" }]] });
    const select = db.select.getMockImplementation()!;
    let calls = 0;
    // Link and membership resolve; the company read inside the claim fails.
    db.select.mockImplementation(() => {
      calls += 1;
      if (calls === 3) throw new Error("database unavailable");
      return select();
    });
    const app = await buildApp(db);

    await dmPost(app).send(dm).expect(500);

    expect(dmInbox.fail).toHaveBeenCalledWith("message-1", "processing_failed");
    expect(dmInbox.succeed).not.toHaveBeenCalled();
  });
});

// F-004-1: job-order intake through the DM route.
describe("POST /integrations/discord/dm/inbound job-order intake", () => {
  const dm = { discordUserId: "discord-user-1", messageId: "message-1", channelId: "dm-channel-1", content: "", attachments: [] };
  const primaryLink = { ...linkedUser, primary: true };
  const forwarded = { messageId: "origin-1", channelId: "origin-channel-1", content: "Thay tủ điện tầng 3\nHạn thứ 6", attachments: [] };
  const cardUrl = "https://paperclip.example/issues/PAP-7";

  function dmPost(app: express.Express) {
    return request(app).post("/api/integrations/discord/dm/inbound").set("Authorization", `Bearer ${bridgeToken}`);
  }
  const linkedApp = () => buildApp(fakeDb({ selectRows: [[primaryLink], [{ id: "membership-1" }], [{ attachmentMaxBytes: 1024 }]] }));

  it("turns a forwarded job order into a card and replies with its link", async () => {
    const { renderWp0Message } = await import("@paperclipai/shared");

    const response = await dmPost(await linkedApp()).send({ ...dm, forwarded }).expect(200);

    expect(createFromJobOrder).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      userId: "user-1",
      discordUserId: "discord-user-1",
      discordMessageId: "message-1",
      origin: { channelId: "origin-channel-1", messageId: "origin-1" },
      text: forwarded.content,
      attachmentNames: [],
    });
    expect(response.body.reply).toBe(renderWp0Message("intake_created", { card: "PAP-7", title: "Thay tủ điện tầng 3", url: cardUrl }));
    expect(dmInbox.succeed).toHaveBeenCalledWith("message-1");
  });

  it("says the card waits for a PM when the project did not resolve", async () => {
    const { renderWp0Message } = await import("@paperclipai/shared");
    createFromJobOrder.mockResolvedValue({ issue: { id: ISSUE_ID, identifier: "PAP-7", title: "Thay tủ điện tầng 3" }, duplicate: false, triage: true });

    const response = await dmPost(await linkedApp()).send({ ...dm, forwarded }).expect(200);

    expect(response.body.reply).toBe(renderWp0Message("intake_created_triage", { card: "PAP-7", title: "Thay tủ điện tầng 3", url: cardUrl }));
  });

  it("answers a re-forwarded job order with the existing card", async () => {
    const { renderWp0Message } = await import("@paperclipai/shared");
    createFromJobOrder.mockResolvedValue({ issue: { id: ISSUE_ID, identifier: "PAP-7", title: "Thay tủ điện tầng 3" }, duplicate: true, triage: false });

    const response = await dmPost(await linkedApp()).send({ ...dm, messageId: "message-2", forwarded }).expect(200);

    expect(response.body.reply).toBe(renderWp0Message("intake_duplicate", { card: "PAP-7", url: cardUrl }));
  });

  it("takes typed text after the capture phrase as a job order", async () => {
    await dmPost(await linkedApp()).send({ ...dm, content: "việc mới: lắp camera kho B" }).expect(200);

    expect(createFromJobOrder).toHaveBeenCalledWith(expect.objectContaining({ origin: null, text: "lắp camera kho B" }));
  });

  it("keeps ordinary text out of intake", async () => {
    const { renderWp0Message } = await import("@paperclipai/shared");

    const response = await dmPost(await linkedApp()).send({ ...dm, content: "ghi chú cho anh Hùng" }).expect(200);

    expect(createFromJobOrder).not.toHaveBeenCalled();
    expect(response.body.reply).toBe(renderWp0Message("unknown_phrase", { input: "ghi chú cho anh Hùng" }));
  });

  it("asks for text when a forward has none, and creates nothing", async () => {
    const { renderWp0Message } = await import("@paperclipai/shared");

    const response = await dmPost(await linkedApp()).send({ ...dm, forwarded: { ...forwarded, content: "  " } }).expect(200);

    expect(createFromJobOrder).not.toHaveBeenCalled();
    expect(response.body.reply).toBe(renderWp0Message("intake_needs_text"));
  });

  it("rejects a forward carrying a disallowed file before any card is made", async () => {
    const response = await dmPost(await linkedApp()).send({
      ...dm,
      forwarded: { ...forwarded, attachments: [{ id: "a-1", filename: "setup.exe", contentType: "application/x-msdownload", size: 10 }] },
    }).expect(200);

    expect(createFromJobOrder).not.toHaveBeenCalled();
    expect(response.body.attachments).toEqual([{ id: "a-1", accepted: false, reason: "content_type_not_allowed" }]);
  });

  it("names accepted forwarded files on the card and keys a forward without ids on its text", async () => {
    await dmPost(await linkedApp()).send({
      ...dm,
      forwarded: { messageId: null, channelId: null, content: "Khảo sát trạm bơm", attachments: [{ id: "a-1", filename: "so-do.png", contentType: "image/png", size: 10 }] },
    }).expect(200);

    expect(createFromJobOrder).toHaveBeenCalledWith(expect.objectContaining({ origin: null, attachmentNames: ["so-do.png"] }));
  });

  it("releases the ledger claim when intake fails, so the replay retries it", async () => {
    createFromJobOrder.mockRejectedValue(new Error("database unavailable"));

    await dmPost(await linkedApp()).send({ ...dm, forwarded }).expect(500);

    expect(dmInbox.fail).toHaveBeenCalledWith("message-1", "processing_failed");
  });
});

describe("POST /integrations/discord/dm/inbound capture (F-CAP-1, F-CAP-2)", () => {
  const photoAttachment = { id: "a-1", filename: "IMG_2041.jpg", contentType: "image/jpeg", size: 512, url: "https://cdn.discordapp.com/attachments/1/2/IMG_2041.jpg" };
  const dm = { discordUserId: "discord-user-1", messageId: "message-1", channelId: "dm-channel-1", content: "", attachments: [photoAttachment] };
  const primaryLink = { ...linkedUser, primary: true };
  const company = { attachmentMaxBytes: 1024 };
  const linkedRows = () => fakeDb({ selectRows: [[primaryLink], [{ id: "membership-1" }], [company]] });
  const card = { id: ISSUE_ID, identifier: "PAP-7", title: "Thay tủ điện tầng 3" };

  function dmPost(app: express.Express) {
    return request(app).post("/api/integrations/discord/dm/inbound").set("Authorization", `Bearer ${bridgeToken}`);
  }

  beforeEach(() => {
    capture.mockResolvedValue({ kind: "filed", card, summary: 'tệp IMG_2041.jpg: "tủ điện tầng 3"', llmCalls: 1 });
  });

  it("captures a photo with its paired caption and confirms on one line", async () => {
    const { renderWp0Message } = await import("@paperclipai/shared");
    const app = await buildApp(linkedRows());

    const response = await dmPost(app).send({ ...dm, caption: { messageId: "message-2", content: "tủ điện tầng 3", messageCreatedAt: "2026-11-08T03:00:05.000Z" } }).expect(200);

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      userId: "user-1",
      discordUserId: "discord-user-1",
      discordMessageId: "message-1",
      caption: "tủ điện tầng 3",
      attachments: [photoAttachment],
      maxBytes: 1024,
    });
    expect(response.body.reply).toBe(renderWp0Message("capture_confirmed", { card: "PAP-7", summary: 'tệp IMG_2041.jpg: "tủ điện tầng 3"' }));
    expect(response.body.holdReplyForCaption).toBeUndefined();
  });

  it("settles the paired caption's message id, so the replay never answers it on its own", async () => {
    const app = await buildApp(linkedRows());

    await dmPost(app).send({ ...dm, caption: { messageId: "message-2", content: "tủ điện tầng 3", messageCreatedAt: "2026-11-08T03:00:05.000Z" } }).expect(200);

    expect(dmInbox.claim).toHaveBeenCalledWith(expect.objectContaining({ discordMessageId: "message-2", messageCreatedAt: new Date("2026-11-08T03:00:05.000Z") }));
    expect(dmInbox.succeed.mock.calls.map((call) => call[0])).toEqual(["message-2", "message-1"]);
  });

  it("takes text sent with the photo as the caption, and joins it with a paired message", async () => {
    const app = await buildApp(linkedRows());

    await dmPost(app).send({ ...dm, content: "ảnh trước khi đấu", caption: { messageId: "message-2", content: "pha A lỏng" } }).expect(200);

    expect(capture.mock.calls[0]![0].caption).toBe("ảnh trước khi đấu\npha A lỏng");
  });

  it("does not file a bare verb as the caption", async () => {
    const app = await buildApp(linkedRows());

    await dmPost(app).send({ ...dm, content: "nộp bằng chứng" }).expect(200);

    expect(capture.mock.calls[0]![0].caption).toBeNull();
  });

  it.each([
    ["no_open_cards", "no_open_cards"],
    ["unstructured", "capture_unstructured_triage"],
    ["provider_unavailable", "capture_unstructured_triage"],
    ["no_match", "capture_unstructured_triage"],
  ] as const)("answers a %s fallback by naming the triage card", async (reason, template) => {
    const { renderWp0Message } = await import("@paperclipai/shared");
    capture.mockResolvedValue({ kind: "triage", reason, card: { id: ISSUE_ID, identifier: "PAP-9", title: "Unsorted chat captures" }, llmCalls: 0 });
    const app = await buildApp(linkedRows());

    const response = await dmPost(app).send(dm).expect(200);

    expect(response.body.reply).toBe(renderWp0Message(template, { card: "PAP-9" }));
    expect(dmInbox.succeed).toHaveBeenCalledWith("message-1");
  });

  it("tells the engineer to resend when the download failed, and settles the message", async () => {
    const { renderWp0Message } = await import("@paperclipai/shared");
    capture.mockResolvedValue({ kind: "media_fetch_failed", filename: "IMG_2041.jpg" });
    const app = await buildApp(linkedRows());

    const response = await dmPost(app).send(dm).expect(200);

    expect(response.body.reply).toBe(renderWp0Message("media_fetch_failed", { item: "tệp IMG_2041.jpg" }));
    expect(dmInbox.succeed).toHaveBeenCalledWith("message-1");
  });

  it("rejects a file whose bytes do not match its type", async () => {
    const { renderWp0Message } = await import("@paperclipai/shared");
    capture.mockResolvedValue({ kind: "media_rejected", filename: "IMG_2041.jpg" });
    const app = await buildApp(linkedRows());

    const response = await dmPost(app).send(dm).expect(200);

    expect(response.body.reply).toBe(renderWp0Message("media_rejected", { item: "tệp IMG_2041.jpg" }));
  });

  it("never fetches anything when one attachment fails the metadata gate", async () => {
    const app = await buildApp(linkedRows());

    await dmPost(app).send({ ...dm, attachments: [photoAttachment, { id: "a-2", filename: "setup.exe", contentType: "application/x-msdownload", size: 512, url: "https://cdn.discordapp.com/attachments/1/2/setup.exe" }] }).expect(200);

    expect(capture).not.toHaveBeenCalled();
  });

  it("releases the claim when the evidence store is down, so the replay tries again", async () => {
    const { HttpError } = await import("../errors.js");
    capture.mockRejectedValue(new HttpError(503, "evidence_storage_unavailable"));
    const app = await buildApp(linkedRows());

    await dmPost(app).send(dm).expect(503);

    expect(dmInbox.fail).toHaveBeenCalledWith("message-1", "processing_failed");
    expect(dmInbox.succeed).not.toHaveBeenCalled();
  });

  it("answers 503 and releases the claim when the instance has no evidence bucket", async () => {
    const app = await buildApp(linkedRows(), { externalStorage: null });

    const response = await dmPost(app).send(dm).expect(503);

    expect(response.body.code).toBe("evidence_storage_not_configured");
    expect(capture).not.toHaveBeenCalled();
    expect(dmInbox.fail).toHaveBeenCalledWith("message-1", "processing_failed");
  });

  it("keeps the F-DM-2 answer for a bridge that sends no attachment URL", async () => {
    const { renderWp0HelpMessage } = await import("@paperclipai/shared");
    const { url: _url, ...withoutUrl } = photoAttachment;
    const app = await buildApp(linkedRows());

    const response = await dmPost(app).send({ ...dm, attachments: [withoutUrl] }).expect(200);

    expect(capture).not.toHaveBeenCalled();
    expect(response.body.reply).toBe(renderWp0HelpMessage());
  });

  it("still treats a forward with files as a job order, not a capture", async () => {
    const app = await buildApp(linkedRows());

    await dmPost(app).send({ ...dm, attachments: [], forwarded: { messageId: "origin-1", channelId: "origin-channel", content: "Thay tủ điện tầng 3", attachments: [photoAttachment] } }).expect(200);

    expect(capture).not.toHaveBeenCalled();
    expect(createFromJobOrder).toHaveBeenCalledTimes(1);
  });

  it("asks the bridge to hold the reply to unrecognized text, which may be a caption", async () => {
    const app = await buildApp(linkedRows());

    const response = await dmPost(app).send({ ...dm, attachments: [], content: "tủ điện tầng 3 đã đấu xong" }).expect(200);

    expect(response.body.holdReplyForCaption).toBe(true);
    expect(capture).not.toHaveBeenCalled();
  });

  it("does not hold a recognized verb, or anything on a replay", async () => {
    const verb = await dmPost(await buildApp(linkedRows())).send({ ...dm, attachments: [], content: "trợ giúp" }).expect(200);
    const replayed = await dmPost(await buildApp(linkedRows())).send({ ...dm, attachments: [], content: "tủ điện tầng 3", replay: true }).expect(200);

    expect(verb.body.holdReplyForCaption).toBeUndefined();
    expect(replayed.body.holdReplyForCaption).toBeUndefined();
  });
});

describe("Discord DM replay endpoints", () => {
  function bridge(app: express.Express, method: "get" | "post", path: string) {
    return request(app)[method](`/api/integrations/discord/dm/${path}`).set("Authorization", `Bearer ${bridgeToken}`);
  }

  it("requires the bridge token for cursors and downtime", async () => {
    const app = await buildApp(fakeDb({ selectRows: [] }));

    await request(app).get("/api/integrations/discord/dm/replay-cursors").expect(401);
    await request(app).post("/api/integrations/discord/dm/downtime").send({}).expect(401);
    expect(dmInbox.replayCursors).not.toHaveBeenCalled();
  });

  it("returns cursors plus status messages rendered from the phrase table", async () => {
    dmInbox.replayCursors.mockResolvedValue([{ discordUserId: "discord-user-1", afterMessageId: "123" }]);
    const app = await buildApp(fakeDb({ selectRows: [] }));

    const response = await bridge(app, "get", "replay-cursors").expect(200);

    expect(response.body.cursors).toEqual([{ discordUserId: "discord-user-1", afterMessageId: "123" }]);
    // The bridge fills these two placeholders; every other word comes from F-VERB-0.
    expect(response.body.statusMessages.downtime).toContain("{{since}}");
    expect(response.body.statusMessages.downtime).toContain("mình sẽ thử lại trong 5 phút");
    expect(response.body.statusMessages.recovered).toContain("{{count}}");
    expect(response.body.statusMessages.recovered).not.toContain("{{phrase.");
  });

  it("records a downtime window", async () => {
    dmInbox.recordDowntime.mockResolvedValue({ companies: 1 });
    const app = await buildApp(fakeDb({ selectRows: [] }));
    const window = { startedAt: "2026-11-08T03:00:00.000Z", endedAt: "2026-11-08T03:20:00.000Z", cause: "paperclip_unreachable", affectedUsers: 2, replayedMessages: 5 };

    await bridge(app, "post", "downtime").send(window).expect(200);

    expect(dmInbox.recordDowntime).toHaveBeenCalledWith({
      ...window,
      startedAt: new Date(window.startedAt),
      endedAt: new Date(window.endedAt),
    });
  });

  it("rejects a downtime window that ends before it starts", async () => {
    const app = await buildApp(fakeDb({ selectRows: [] }));

    await bridge(app, "post", "downtime").send({ startedAt: "2026-11-08T03:20:00.000Z", endedAt: "2026-11-08T03:00:00.000Z", cause: "gateway_disconnected", affectedUsers: 0, replayedMessages: 0 }).expect(400);
    expect(dmInbox.recordDowntime).not.toHaveBeenCalled();
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
