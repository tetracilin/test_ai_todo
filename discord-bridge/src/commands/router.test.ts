import { describe, expect, it, vi, beforeEach } from "vitest";
import { routeCommand } from "./router.js";
import * as handlers from "../lib/handlers.js";

vi.mock("../lib/handlers.js", () => ({
  handleLink: vi.fn(),
  handleUnlink: vi.fn(),
  handlePlate: vi.fn(),
  handleStatus: vi.fn(),
  handleReply: vi.fn(),
  handleApprove: vi.fn(),
  handleReject: vi.fn(),
  handleCreate: vi.fn(),
}));

function fakeInteraction(commandName: string, options: Record<string, string | null> = {}) {
  return {
    commandName,
    user: { id: "discord-1", username: "ada" },
    channelId: "chan-1",
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    options: {
      getString: (name: string, required?: boolean) => {
        const value = options[name] ?? null;
        if (required && value === null) throw new Error(`missing required option ${name}`);
        return value;
      },
    },
  } as any;
}

const ctx = {} as any;

describe("routeCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defers the reply before dispatching", async () => {
    vi.mocked(handlers.handlePlate).mockResolvedValue("your plate");
    const interaction = fakeInteraction("plate");

    await routeCommand(ctx, interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: false });
    expect(interaction.editReply).toHaveBeenCalledWith("your plate");
  });

  it("routes /status with the issue option to handleStatus", async () => {
    vi.mocked(handlers.handleStatus).mockResolvedValue("status reply");
    const interaction = fakeInteraction("status", { issue: "T-10" });

    await routeCommand(ctx, interaction);

    expect(handlers.handleStatus).toHaveBeenCalledWith(ctx, "discord-1", "T-10");
    expect(interaction.editReply).toHaveBeenCalledWith("status reply");
  });

  it("routes /reject with an optional reason omitted", async () => {
    vi.mocked(handlers.handleReject).mockResolvedValue("rejected");
    const interaction = fakeInteraction("reject", { issue: "T-10" });

    await routeCommand(ctx, interaction);

    expect(handlers.handleReject).toHaveBeenCalledWith(ctx, "discord-1", "T-10", undefined);
  });

  it("edge case: swallows handler errors and reports a generic failure reply", async () => {
    vi.mocked(handlers.handlePlate).mockRejectedValue(new Error("boom"));
    const interaction = fakeInteraction("plate");

    await routeCommand(ctx, interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(
      "Something went wrong talking to Paperclip. Try again in a moment.",
    );
  });

  it("reports unknown commands without throwing", async () => {
    const interaction = fakeInteraction("nonexistent");

    await routeCommand(ctx, interaction);

    expect(interaction.editReply).toHaveBeenCalledWith("Unknown command /nonexistent");
  });
});
