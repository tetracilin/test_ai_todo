import { describe, expect, it, vi } from "vitest";
import { DiscordIntegrationApiError } from "./discordIntegrationClient.js";
import { createTaskFromDiscord, validateTaskCreateInput } from "./taskCreate.js";

const validInput = {
  discordInteractionId: "interaction-1",
  discordUserId: "discord-user-1",
  guildId: "guild-1",
  channelId: "channel-1",
  parentChannelId: null,
  commandName: "paperclip task create" as const,
  title: "  Fix the task flow  ",
  description: "  More detail  ",
  priority: "high" as const,
};

describe("createTaskFromDiscord", () => {
  it("creates through only the integration client and presents safe summary", async () => {
    const paperclip = {
      createTask: vi.fn().mockResolvedValue({
        duplicate: false,
        issue: { id: "issue-1", identifier: "T-1", title: "Fix the task flow", url: "https://pc/T-1" },
      }),
    } as any;

    const reply = await createTaskFromDiscord({ paperclip }, validInput);

    expect(paperclip.createTask).toHaveBeenCalledWith({
      ...validInput,
      title: "Fix the task flow",
      description: "More detail",
    });
    expect(reply).toContain("Created **T-1**");
  });

  it("shows an idempotent duplicate acknowledgement without creating a second task", async () => {
    const paperclip = {
      createTask: vi.fn().mockResolvedValue({
        duplicate: true,
        issue: { id: "issue-1", identifier: "T-1", title: "Fix the task flow", url: "https://pc/T-1" },
      }),
    } as any;

    const reply = await createTaskFromDiscord({ paperclip }, validInput);

    expect(paperclip.createTask).toHaveBeenCalledTimes(1);
    expect(reply).toContain("Already created");
  });

  it.each([
    ["not_linked", "Link your Paperclip account"],
    ["channel_not_mapped", "This channel is not connected"],
    ["task_creation_disabled", "Task creation is disabled"],
    ["project_access_denied", "cannot create tasks"],
    ["assignee_invalid", "assignee is not available"],
    ["validation_failed", "Task fields are invalid"],
    ["interaction_conflict", "conflicts with an existing request"],
  ])("maps %s to a safe actionable Discord reply", async (code: string, expected: string) => {
    const paperclip = { createTask: vi.fn().mockRejectedValue(new DiscordIntegrationApiError(403, code)) } as any;

    const reply = await createTaskFromDiscord({ paperclip }, validInput);

    expect(reply).toContain(expected);
  });

  it("rejects malformed fields before an API call", async () => {
    const paperclip = { createTask: vi.fn() } as any;

    const reply = await createTaskFromDiscord({ paperclip }, { ...validInput, title: " " });

    expect(reply).toBe("Task title must contain 1 to 200 characters.");
    expect(paperclip.createTask).not.toHaveBeenCalled();
  });
});

describe("validateTaskCreateInput", () => {
  it("counts Unicode code points, not UTF-16 units", () => {
    expect(validateTaskCreateInput({ title: "😀".repeat(200) })).toBeNull();
    expect(validateTaskCreateInput({ title: "😀".repeat(201) })).toContain("1 to 200");
  });
});