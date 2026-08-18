import { PaperclipApiError, PaperclipClient } from "./paperclipClient.js";
import { LinkStore } from "./linkStore.js";
import { issueUrl } from "./issueUrl.js";

export interface HandlerContext {
  paperclip: PaperclipClient;
  store: LinkStore;
  issuePrefix: string;
  dashboardUrl: string;
}

/**
 * All handlers are pure(ish) functions of (context, discordUserId, args) -> reply text.
 * They know nothing about discord.js so they're directly unit-testable and so the
 * Discord wiring layer stays a thin adapter.
 */

export async function handleLink(
  ctx: HandlerContext,
  discordUserId: string,
  discordChannelId: string,
  paperclipUserId: string,
): Promise<string> {
  paperclipUserId = paperclipUserId.trim();
  try {
    // Cheap existence/permission check: a bad or unauthorized user id will fail here.
    await ctx.paperclip.getMineInbox(paperclipUserId);
  } catch (err) {
    if (err instanceof PaperclipApiError) {
      return `Could not link that Paperclip user id (${err.status}). Double-check the id from your Paperclip profile and try again.`;
    }
    throw err;
  }
  ctx.store.linkUser(discordUserId, paperclipUserId, discordChannelId);
  return `Linked! This Discord account now maps to Paperclip user \`${paperclipUserId}\`. Try \`/plate\`.`;
}

export async function handleUnlink(ctx: HandlerContext, discordUserId: string): Promise<string> {
  ctx.store.unlinkUser(discordUserId);
  return "Unlinked. Run /link again to reconnect your Paperclip account.";
}

function requireLink(ctx: HandlerContext, discordUserId: string) {
  const link = ctx.store.getLinkByDiscordUser(discordUserId);
  if (!link) {
    throw new Error("NOT_LINKED");
  }
  return link;
}

const NOT_LINKED_MESSAGE = "You're not linked to a Paperclip account yet. Run `/link <paperclip-user-id>` first.";

export async function handlePlate(ctx: HandlerContext, discordUserId: string): Promise<string> {
  let link;
  try {
    link = requireLink(ctx, discordUserId);
  } catch {
    return NOT_LINKED_MESSAGE;
  }
  const issues = await ctx.paperclip.getMineInbox(link.paperclipUserId);
  if (issues.length === 0) {
    return "Nothing on your plate right now.";
  }
  const lines = issues.map((issue) => {
    const url = issueUrl(issue.identifier, ctx.issuePrefix, ctx.dashboardUrl);
    return `- **${issue.identifier}** [${issue.status}/${issue.priority}] ${issue.title} — <${url}>`;
  });
  return `**On your plate (${issues.length}):**\n${lines.join("\n")}`;
}

export async function handleStatus(
  ctx: HandlerContext,
  discordUserId: string,
  identifier: string,
): Promise<string> {
  try {
    requireLink(ctx, discordUserId);
  } catch {
    return NOT_LINKED_MESSAGE;
  }
  const issue = await ctx.paperclip.findIssueByIdentifier(identifier);
  if (!issue) {
    return `No issue found matching \`${identifier}\`.`;
  }
  const comments = await ctx.paperclip.getComments(issue.id, { order: "desc" });
  const latest = comments.slice(0, 3).reverse();
  const url = issueUrl(issue.identifier, ctx.issuePrefix, ctx.dashboardUrl);
  const header = `**${issue.identifier}** [${issue.status}/${issue.priority}] ${issue.title}\n<${url}>`;
  if (latest.length === 0) {
    return `${header}\n_No comments yet._`;
  }
  const commentLines = latest.map((c) => {
    const author = c.authorAgentId ? "agent" : c.onBehalfOfUserId || c.authorUserId ? "human" : "system";
    const body = c.body.length > 300 ? `${c.body.slice(0, 300)}…` : c.body;
    return `> [${author}] ${body}`;
  });
  return `${header}\n\n**Latest comments:**\n${commentLines.join("\n")}`;
}

export async function handleReply(
  ctx: HandlerContext,
  discordUserId: string,
  discordDisplayName: string,
  identifier: string,
  body: string,
): Promise<string> {
  let link;
  try {
    link = requireLink(ctx, discordUserId);
  } catch {
    return NOT_LINKED_MESSAGE;
  }
  const issue = await ctx.paperclip.findIssueByIdentifier(identifier);
  if (!issue) {
    return `No issue found matching \`${identifier}\`.`;
  }
  // The API derives comment attribution from the authenticated caller (this
  // bridge's own agent identity) and rejects an agent picking a different
  // onBehalfOfUserId — see paperclipClient.ts#postComment. Fold the real
  // human's identity into the visible body instead, so provenance survives.
  const attributed = `**Via Discord, on behalf of ${discordDisplayName} (Paperclip user \`${link.paperclipUserId}\`):**\n${body}`;
  await ctx.paperclip.postComment(issue.id, attributed);
  return `Posted your comment on **${issue.identifier}**.`;
}

async function findLatestPendingConfirmation(paperclip: PaperclipClient, issueId: string) {
  const interactions = await paperclip.listInteractions(issueId);
  return (
    interactions
      .filter((i) => i.kind === "request_confirmation" && i.status === "pending")
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null
  );
}

export async function handleApprove(
  ctx: HandlerContext,
  discordUserId: string,
  identifier: string,
): Promise<string> {
  return resolveConfirmation(ctx, discordUserId, identifier, "accept");
}

export async function handleReject(
  ctx: HandlerContext,
  discordUserId: string,
  identifier: string,
  reason?: string,
): Promise<string> {
  return resolveConfirmation(ctx, discordUserId, identifier, "reject", reason);
}

async function resolveConfirmation(
  ctx: HandlerContext,
  discordUserId: string,
  identifier: string,
  action: "accept" | "reject",
  reason?: string,
): Promise<string> {
  try {
    requireLink(ctx, discordUserId);
  } catch {
    return NOT_LINKED_MESSAGE;
  }
  const issue = await ctx.paperclip.findIssueByIdentifier(identifier);
  if (!issue) {
    return `No issue found matching \`${identifier}\`.`;
  }
  const pending = await findLatestPendingConfirmation(ctx.paperclip, issue.id);
  if (!pending) {
    return `No pending confirmation to ${action} on **${issue.identifier}**.`;
  }
  try {
    if (action === "accept") {
      await ctx.paperclip.acceptInteraction(issue.id, pending.id);
      return `Approved "${pending.title ?? "the pending confirmation"}" on **${issue.identifier}**.`;
    }
    await ctx.paperclip.rejectInteraction(issue.id, pending.id, reason ? { reason } : {});
    return `Rejected "${pending.title ?? "the pending confirmation"}" on **${issue.identifier}**.`;
  } catch (err) {
    if (err instanceof PaperclipApiError && err.status === 403) {
      return (
        `Couldn't ${action} — this confirmation is board-only (default resolver policy). ` +
        `Ask the assignee to create it with \`resolverPolicy: "board_or_agents"\` so this bridge can resolve it from chat, ` +
        `or resolve it from the Paperclip dashboard.`
      );
    }
    throw err;
  }
}

export async function handleCreate(
  ctx: HandlerContext,
  discordUserId: string,
  title: string,
  description: string | undefined,
): Promise<string> {
  let link;
  try {
    link = requireLink(ctx, discordUserId);
  } catch {
    return NOT_LINKED_MESSAGE;
  }
  const issue = await ctx.paperclip.createIssue({
    title,
    description,
    assigneeUserId: link.paperclipUserId,
    createdByUserId: link.paperclipUserId,
  });
  const url = issueUrl(issue.identifier, ctx.issuePrefix, ctx.dashboardUrl);
  return `Created **${issue.identifier}**: ${issue.title} — <${url}>`;
}
