import { DiscordIntegrationApiError, DiscordIntegrationClient, type DiscordTaskCreateRequest } from "./discordIntegrationClient.js";

export interface TaskCreateContext {
  paperclip: DiscordIntegrationClient;
}

export function taskCreateErrorMessage(error: unknown): string {
  if (!(error instanceof DiscordIntegrationApiError)) {
    return "Paperclip could not create this task. Try again in a moment.";
  }

  switch (error.code) {
    case "not_linked":
      return "Link your Paperclip account before creating tasks.";
    case "channel_not_mapped":
      return "This channel is not connected to a Paperclip project.";
    case "task_creation_disabled":
      return "Task creation is disabled for this channel.";
    case "project_access_denied":
      return "Your Paperclip account cannot create tasks in this project.";
    case "assignee_invalid":
      return "That assignee is not available in this project.";
    case "validation_failed":
      return "Task fields are invalid. Use a title up to 200 characters and a description up to 8,000 characters.";
    case "interaction_conflict":
      return "This Discord interaction conflicts with an existing request. Start a new command.";
    default:
      return "Paperclip could not create this task. Try again in a moment.";
  }
}

export function validateTaskCreateInput(input: Pick<DiscordTaskCreateRequest, "title" | "description" | "priority" | "assignee">): string | null {
  if (!input.title.trim() || Array.from(input.title.trim()).length > 200) {
    return "Task title must contain 1 to 200 characters.";
  }
  if (input.description !== undefined && (!input.description.trim() || Array.from(input.description).length > 8000)) {
    return "Task description must contain 1 to 8,000 characters when provided.";
  }
  if (input.assignee !== undefined && !input.assignee.trim()) {
    return "Assignee cannot be empty.";
  }
  return null;
}

export async function createTaskFromDiscord(
  ctx: TaskCreateContext,
  input: DiscordTaskCreateRequest,
): Promise<string> {
  const validationError = validateTaskCreateInput(input);
  if (validationError) return validationError;

  try {
    const result = await ctx.paperclip.createTask({
      ...input,
      title: input.title.trim(),
      description: input.description?.trim() || undefined,
      assignee: input.assignee?.trim() || undefined,
    });
    const action = result.duplicate ? "Already created" : "Created";
    return `${action} **${result.issue.identifier}**: ${result.issue.title} in ${result.issue.projectName} — <${result.issue.url}>`;
  } catch (error) {
    return taskCreateErrorMessage(error);
  }
}