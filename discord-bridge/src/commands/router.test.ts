import { beforeEach, describe, expect, it, vi } from "vitest";
import { routeCommand } from "./router.js";
import * as taskCreate from "../lib/taskCreate.js";

vi.mock("../lib/taskCreate.js", () => ({
  createTaskFromDiscord: vi.fn(),
}));

function fakeInteraction(
  options: Record<string, string | null> = {},
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "interaction-1",
    commandName: "paperclip",
    user: { id: "discord-1" },
    guildId: "guild-1",
    channelId: "channel-1",
    channel: { isThread: () => false, parentId: null },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    options: {
      getSubcommandGroup: () => "task",
      getSubcommand: () => "create",
      getString: (name: string, required?: boolean) => {
        const value = options[name] ?? null;
        if (required && value === null) throw new Error(`missing required option ${name}`);
        return value;
      },
    },
    ...overrides,
  } as any;
}

const ctx = { paperclip: {} } as any;

describe("routeCommand", () => {
  beforeEach(() => vi.clearAllMocks());

  it("defers ephemerally and forwards only immutable Discord context plus typed options", async () => {
    vi.mocked(taskCreate.createTaskFromDiscord).mockResolvedValue("Created T-1");
    const interaction = fakeInteraction({
      title: "Fix create flow",
      description: "Details",
      priority: "high",
      assignee: "Ada",
    });

    await routeCommand(ctx, interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(taskCreate.createTaskFromDiscord).toHaveBeenCalledWith(ctx, {
      discordInteractionId: "interaction-1",
      discordUserId: "discord-1",
      guildId: "guild-1",
      channelId: "channel-1",
      parentChannelId: null,
      commandName: "paperclip task create",
      title: "Fix create flow",
      description: "Details",
      priority: "high",
      assignee: "Ada",
    });
    expect(interaction.editReply).toHaveBeenCalledWith("Created T-1");
  });

  it("resolves a thread through its parent channel", async () => {
    vi.mocked(taskCreate.createTaskFromDiscord).mockResolvedValue("Created T-1");
    const interaction = fakeInteraction({ title: "Thread task" }, {
      channel: { isThread: () => true, parentId: "parent-channel-1" },
    });

    await routeCommand(ctx, interaction);

    expect(taskCreate.createTaskFromDiscord).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ channelId: "channel-1", parentChannelId: "parent-channel-1" }),
    );
  });

  it("does not invoke Paperclip for unsupported subcommands", async () => {
    const interaction = fakeInteraction({}, {
      options: { getSubcommandGroup: () => "task", getSubcommand: () => "show", getString: () => null },
    });

    await routeCommand(ctx, interaction);

    expect(taskCreate.createTaskFromDiscord).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith("Unknown Paperclip command.");
  });

  it("returns a generic reply when command dispatch throws", async () => {
    vi.mocked(taskCreate.createTaskFromDiscord).mockRejectedValue(new Error("unexpected"));
    const interaction = fakeInteraction({ title: "Task" });

    await routeCommand(ctx, interaction);

    expect(interaction.editReply).toHaveBeenCalledWith("Paperclip could not process this command. Try again in a moment.");
  });
});