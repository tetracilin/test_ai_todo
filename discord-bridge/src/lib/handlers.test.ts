import { describe, expect, it, vi, beforeEach } from "vitest";
import { LinkStore } from "./linkStore.js";
import { PaperclipApiError } from "./paperclipClient.js";
import {
  HandlerContext,
  handleApprove,
  handleCreate,
  handleLink,
  handlePlate,
  handleReject,
  handleReply,
  handleStatus,
  handleUnlink,
} from "./handlers.js";

function fakePaperclip(overrides: Record<string, unknown> = {}) {
  return {
    getMineInbox: vi.fn().mockResolvedValue([]),
    findIssueByIdentifier: vi.fn().mockResolvedValue(null),
    getComments: vi.fn().mockResolvedValue([]),
    postComment: vi.fn().mockResolvedValue({}),
    listInteractions: vi.fn().mockResolvedValue([]),
    acceptInteraction: vi.fn().mockResolvedValue({}),
    rejectInteraction: vi.fn().mockResolvedValue({}),
    createIssue: vi.fn().mockResolvedValue({ id: "i1", identifier: "T-99", title: "New" }),
    ...overrides,
  } as any;
}

function makeCtx(paperclip: any): HandlerContext {
  return {
    paperclip,
    store: new LinkStore(":memory:"),
    issuePrefix: "T",
    dashboardUrl: "https://paperclip.example",
  };
}

describe("handleLink / handleUnlink", () => {
  it("links a discord user to a paperclip user id after verifying it resolves", async () => {
    const paperclip = fakePaperclip({ getMineInbox: vi.fn().mockResolvedValue([]) });
    const ctx = makeCtx(paperclip);
    const reply = await handleLink(ctx, "discord-1", "chan-1", "pc-user-7");
    expect(reply).toMatch(/Linked/);
    expect(ctx.store.getLinkByDiscordUser("discord-1")?.paperclipUserId).toBe("pc-user-7");
    expect(paperclip.getMineInbox).toHaveBeenCalledWith("pc-user-7");
  });

  it("refuses to link when the paperclip user id is invalid", async () => {
    const paperclip = fakePaperclip({
      getMineInbox: vi.fn().mockRejectedValue(new PaperclipApiError(404, "/x", {})),
    });
    const ctx = makeCtx(paperclip);
    const reply = await handleLink(ctx, "discord-1", "chan-1", "bogus");
    expect(reply).toMatch(/Could not link/);
    expect(ctx.store.getLinkByDiscordUser("discord-1")).toBeNull();
  });

  it("unlink clears the mapping", async () => {
    const ctx = makeCtx(fakePaperclip());
    ctx.store.linkUser("discord-1", "pc-user-7", "chan-1");
    await handleUnlink(ctx, "discord-1");
    expect(ctx.store.getLinkByDiscordUser("discord-1")).toBeNull();
  });
});

describe("commands that require a link", () => {
  it.each([
    ["plate", (ctx: HandlerContext) => handlePlate(ctx, "discord-1")],
    ["status", (ctx: HandlerContext) => handleStatus(ctx, "discord-1", "T-1")],
    ["reply", (ctx: HandlerContext) => handleReply(ctx, "discord-1", "Some User", "T-1", "hi")],
    ["approve", (ctx: HandlerContext) => handleApprove(ctx, "discord-1", "T-1")],
    ["reject", (ctx: HandlerContext) => handleReject(ctx, "discord-1", "T-1")],
    ["create", (ctx: HandlerContext) => handleCreate(ctx, "discord-1", "Title", undefined)],
  ])("%s tells an unlinked user to link first", async (_name, run) => {
    const ctx = makeCtx(fakePaperclip());
    const reply = await run(ctx);
    expect(reply).toMatch(/not linked/i);
  });
});

describe("handlePlate", () => {
  it("formats the linked user's mine-inbox issues", async () => {
    const paperclip = fakePaperclip({
      getMineInbox: vi.fn().mockResolvedValue([
        { id: "i1", identifier: "T-10", title: "Discord bridge", status: "in_progress", priority: "high" },
      ]),
    });
    const ctx = makeCtx(paperclip);
    ctx.store.linkUser("discord-1", "pc-user-7", "chan-1");
    const reply = await handlePlate(ctx, "discord-1");
    expect(reply).toContain("T-10");
    expect(reply).toContain("Discord bridge");
    expect(reply).toContain("in_progress/high");
  });

  it("handles an empty plate", async () => {
    const ctx = makeCtx(fakePaperclip());
    ctx.store.linkUser("discord-1", "pc-user-7", "chan-1");
    const reply = await handlePlate(ctx, "discord-1");
    expect(reply).toMatch(/Nothing on your plate/);
  });
});

describe("handleStatus", () => {
  it("reports issue not found", async () => {
    const ctx = makeCtx(fakePaperclip());
    ctx.store.linkUser("discord-1", "pc-user-7", "chan-1");
    const reply = await handleStatus(ctx, "discord-1", "T-999");
    expect(reply).toMatch(/No issue found/);
  });

  it("shows status and latest comments", async () => {
    const paperclip = fakePaperclip({
      findIssueByIdentifier: vi.fn().mockResolvedValue({
        id: "i1",
        identifier: "T-10",
        title: "Discord bridge",
        status: "in_progress",
        priority: "high",
      }),
      getComments: vi.fn().mockResolvedValue([
        { id: "c2", body: "Working on it", authorAgentId: "agent-1", authorUserId: null, onBehalfOfUserId: null },
        { id: "c1", body: "Please start", authorAgentId: null, authorUserId: "u1", onBehalfOfUserId: null },
      ]),
    });
    const ctx = makeCtx(paperclip);
    ctx.store.linkUser("discord-1", "pc-user-7", "chan-1");
    const reply = await handleStatus(ctx, "discord-1", "t-10");
    expect(reply).toContain("T-10");
    expect(reply).toContain("Working on it");
    expect(reply).toContain("[agent]");
    expect(reply).toContain("[human]");
  });
});

describe("handleReply", () => {
  it("folds the linked human's identity into the comment body (API rejects onBehalfOfUserId from agents)", async () => {
    const paperclip = fakePaperclip({
      findIssueByIdentifier: vi.fn().mockResolvedValue({ id: "i1", identifier: "T-10" }),
    });
    const ctx = makeCtx(paperclip);
    ctx.store.linkUser("discord-1", "pc-user-7", "chan-1");
    const reply = await handleReply(ctx, "discord-1", "Ada Lovelace", "T-10", "looks good");
    expect(paperclip.postComment).toHaveBeenCalledWith(
      "i1",
      expect.stringContaining("Ada Lovelace"),
    );
    expect(paperclip.postComment).toHaveBeenCalledWith("i1", expect.stringContaining("looks good"));
    expect(reply).toMatch(/Posted your comment/);
  });
});

describe("approve / reject", () => {
  const pendingConfirmation = {
    id: "int-1",
    issueId: "i1",
    kind: "request_confirmation",
    status: "pending",
    title: "Ship it?",
    summary: null,
    payload: {},
    createdAt: "2026-08-18T00:00:00.000Z",
  };

  it("approves the latest pending confirmation", async () => {
    const paperclip = fakePaperclip({
      findIssueByIdentifier: vi.fn().mockResolvedValue({ id: "i1", identifier: "T-10" }),
      listInteractions: vi.fn().mockResolvedValue([pendingConfirmation]),
    });
    const ctx = makeCtx(paperclip);
    ctx.store.linkUser("discord-1", "pc-user-7", "chan-1");
    const reply = await handleApprove(ctx, "discord-1", "T-10");
    expect(paperclip.acceptInteraction).toHaveBeenCalledWith("i1", "int-1");
    expect(reply).toMatch(/Approved/);
  });

  it("rejects with a reason", async () => {
    const paperclip = fakePaperclip({
      findIssueByIdentifier: vi.fn().mockResolvedValue({ id: "i1", identifier: "T-10" }),
      listInteractions: vi.fn().mockResolvedValue([pendingConfirmation]),
    });
    const ctx = makeCtx(paperclip);
    ctx.store.linkUser("discord-1", "pc-user-7", "chan-1");
    const reply = await handleReject(ctx, "discord-1", "T-10", "needs more tests");
    expect(paperclip.rejectInteraction).toHaveBeenCalledWith("i1", "int-1", { reason: "needs more tests" });
    expect(reply).toMatch(/Rejected/);
  });

  it("reports when there's nothing pending", async () => {
    const paperclip = fakePaperclip({
      findIssueByIdentifier: vi.fn().mockResolvedValue({ id: "i1", identifier: "T-10" }),
      listInteractions: vi.fn().mockResolvedValue([]),
    });
    const ctx = makeCtx(paperclip);
    ctx.store.linkUser("discord-1", "pc-user-7", "chan-1");
    const reply = await handleApprove(ctx, "discord-1", "T-10");
    expect(reply).toMatch(/No pending confirmation/);
  });

  it("explains a board_only 403 in actionable terms", async () => {
    const paperclip = fakePaperclip({
      findIssueByIdentifier: vi.fn().mockResolvedValue({ id: "i1", identifier: "T-10" }),
      listInteractions: vi.fn().mockResolvedValue([pendingConfirmation]),
      acceptInteraction: vi.fn().mockRejectedValue(new PaperclipApiError(403, "/x", {})),
    });
    const ctx = makeCtx(paperclip);
    ctx.store.linkUser("discord-1", "pc-user-7", "chan-1");
    const reply = await handleApprove(ctx, "discord-1", "T-10");
    expect(reply).toMatch(/board_or_agents/);
  });
});

describe("handleCreate", () => {
  it("creates an issue assigned to the linked user", async () => {
    const paperclip = fakePaperclip();
    const ctx = makeCtx(paperclip);
    ctx.store.linkUser("discord-1", "pc-user-7", "chan-1");
    const reply = await handleCreate(ctx, "discord-1", "Fix the thing", "details here");
    expect(paperclip.createIssue).toHaveBeenCalledWith({
      title: "Fix the thing",
      description: "details here",
      assigneeUserId: "pc-user-7",
      createdByUserId: "pc-user-7",
    });
    expect(reply).toContain("T-99");
  });
});
