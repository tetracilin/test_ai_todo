import { describe, expect, it, vi } from "vitest";
import { pollOnce } from "./notifier.js";
import { LinkStore } from "./linkStore.js";
import type { HandlerContext } from "./handlers.js";

function fakePaperclip(overrides: Record<string, unknown> = {}) {
  return {
    getMineInbox: vi.fn().mockResolvedValue([]),
    getComments: vi.fn().mockResolvedValue([]),
    listInteractions: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as any;
}

function fakeClient(send: ReturnType<typeof vi.fn>) {
  return {
    channels: {
      fetch: vi.fn().mockResolvedValue({ send }),
    },
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

const issue = {
  id: "i1",
  identifier: "T-10",
  title: "Discord bridge",
  status: "in_progress",
  priority: "high",
  assigneeAgentId: null,
  assigneeUserId: null,
};

describe("pollOnce", () => {
  it("establishes a baseline on first sight without sending a notification", async () => {
    const send = vi.fn();
    const paperclip = fakePaperclip({ getMineInbox: vi.fn().mockResolvedValue([issue]) });
    const ctx = makeCtx(paperclip);
    ctx.store.linkUser("discord-1", "pc-user-7", "chan-1");

    await pollOnce(fakeClient(send), ctx);

    expect(send).not.toHaveBeenCalled();
    expect(ctx.store.getWatchState("discord-1", "i1")?.lastStatus).toBe("in_progress");
  });

  it("notifies on a status change since the last poll", async () => {
    const send = vi.fn();
    const paperclip = fakePaperclip({ getMineInbox: vi.fn().mockResolvedValue([issue]) });
    const ctx = makeCtx(paperclip);
    ctx.store.linkUser("discord-1", "pc-user-7", "chan-1");
    ctx.store.upsertWatchState({
      discordUserId: "discord-1",
      issueId: "i1",
      lastStatus: "todo",
      lastCommentId: null,
      lastSeenInteractionIds: [],
      updatedAt: new Date(0).toISOString(),
    });

    await pollOnce(fakeClient(send), ctx);

    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0]).toContain("`todo` → `in_progress`");
    expect(send.mock.calls[0][0]).toContain("T-10");
  });

  it("notifies on a new pending interaction (edge case: multiple signals fire together)", async () => {
    const send = vi.fn();
    const paperclip = fakePaperclip({
      getMineInbox: vi.fn().mockResolvedValue([issue]),
      listInteractions: vi.fn().mockResolvedValue([
        { id: "int-1", issueId: "i1", kind: "request_confirmation", status: "pending", title: "Ship it?" },
      ]),
    });
    const ctx = makeCtx(paperclip);
    ctx.store.linkUser("discord-1", "pc-user-7", "chan-1");
    ctx.store.upsertWatchState({
      discordUserId: "discord-1",
      issueId: "i1",
      lastStatus: "in_progress",
      lastCommentId: null,
      lastSeenInteractionIds: [],
      updatedAt: new Date(0).toISOString(),
    });

    await pollOnce(fakeClient(send), ctx);

    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0]).toContain("new pending request_confirmation");
  });

  it("skips links with no notify channel configured", async () => {
    const send = vi.fn();
    const paperclip = fakePaperclip({ getMineInbox: vi.fn().mockResolvedValue([issue]) });
    const ctx = makeCtx(paperclip);
    ctx.store.linkUser("discord-1", "pc-user-7", null);

    await pollOnce(fakeClient(send), ctx);

    expect(paperclip.getMineInbox).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
