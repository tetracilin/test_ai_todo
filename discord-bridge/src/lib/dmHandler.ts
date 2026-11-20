import { MessageReferenceType, type Attachment, type Message } from "discord.js";
import { DiscordIntegrationApiError, type DiscordDirectMessageResult, type DiscordIntegrationClient } from "./discordIntegrationClient.js";

export interface DirectMessageContext {
  paperclip: Pick<DiscordIntegrationClient, "sendDirectMessage">;
}

/**
 * What happened to one DM. `unavailable` means Paperclip could not be reached
 * (network error or 5xx): the message stays in Discord's DM history and the
 * replay (F-DM-3) picks it up. Every other failure is final for this delivery.
 */
export type DirectMessageOutcome = "ignored" | "unlinked" | "duplicate" | "answered" | "unavailable" | "failed";

export function isPaperclipUnavailable(error: unknown): boolean {
  return !(error instanceof DiscordIntegrationApiError) || error.status >= 500;
}

type Submission =
  | { outcome: Exclude<DirectMessageOutcome, "answered"> }
  | { outcome: "answered"; reply: string; holdReplyForCaption: boolean };

function isForward(message: Message): boolean {
  return message.reference?.type === MessageReferenceType.Forward;
}

/**
 * Hands one DM to Paperclip without posting the answer. Guild messages are
 * never read or forwarded, even though the MessageContent intent would deliver
 * them: the bridge only acts on DMs. The server owns every decision (who is
 * linked, which attachments pass, what to say, whether this message id was
 * already answered); the bridge forwards metadata and posts the reply.
 */
async function submitDirectMessage(
  ctx: DirectMessageContext,
  message: Message,
  opts: { replay?: boolean; caption?: Message },
): Promise<Submission> {
  if (message.author.bot || message.guildId !== null) return { outcome: "ignored" };

  // F-004-1: a Discord forward arrives with empty content; the job order is in
  // the snapshot, and the reference names the original message.
  const snapshot = isForward(message) ? message.messageSnapshots?.first() : undefined;

  let result: DiscordDirectMessageResult;
  try {
    result = await ctx.paperclip.sendDirectMessage({
      discordUserId: message.author.id,
      messageId: message.id,
      channelId: message.channelId,
      content: message.content,
      attachments: attachmentMetadata(message.attachments.values()),
      ...(snapshot ? {
        forwarded: {
          messageId: message.reference?.messageId ?? null,
          channelId: message.reference?.channelId ?? null,
          content: snapshot.content ?? "",
          attachments: attachmentMetadata(snapshot.attachments?.values() ?? []),
        },
      } : {}),
      messageCreatedAt: new Date(message.createdTimestamp).toISOString(),
      ...(opts.replay ? { replay: true } : {}),
      ...(opts.caption ? {
        caption: {
          messageId: opts.caption.id,
          content: opts.caption.content,
          messageCreatedAt: new Date(opts.caption.createdTimestamp).toISOString(),
        },
      } : {}),
    });
  } catch (error) {
    logFailure(message, error);
    return { outcome: isPaperclipUnavailable(error) ? "unavailable" : "failed" };
  }
  // Unlinked senders get no reply at all, so a stranger cannot probe the bot.
  if (!result.linked) return { outcome: "unlinked" };
  if (result.duplicate) return { outcome: "duplicate" };
  return { outcome: "answered", reply: result.reply, holdReplyForCaption: result.holdReplyForCaption === true };
}

async function postReply(message: Message, reply: string): Promise<DirectMessageOutcome> {
  try {
    // The reply echoes engineer text (filenames, unknown phrases); never let it ping anyone.
    await message.reply({ content: reply, allowedMentions: { parse: [], repliedUser: false } });
    return "answered";
  } catch (error) {
    // Discord refused the reply. The server already settled the message, so a
    // replay would only be dropped as a duplicate: this is final.
    logFailure(message, error);
    return "failed";
  }
}

/** F-DM-2 DM surface: forward one DM and post the server's answer straight away. */
export async function handleDirectMessage(
  ctx: DirectMessageContext,
  message: Message,
  opts: { replay?: boolean; caption?: Message } = {},
): Promise<DirectMessageOutcome> {
  const submission = await submitDirectMessage(ctx, message, opts);
  return submission.outcome === "answered" ? postReply(message, submission.reply) : submission.outcome;
}

/** How long a photo waits for its caption, or a caption for its photo (F-CAP-1). */
export const DM_PAIRING_WINDOW_MS = 20_000;

interface HeldMedia {
  kind: "media";
  message: Message;
  timer: ReturnType<typeof setTimeout>;
  settle: (outcome: DirectMessageOutcome) => void;
}

interface HeldReply {
  kind: "reply";
  /** The text message that might be a caption. */
  message: Message;
  reply: string;
  timer: ReturnType<typeof setTimeout>;
  settle: (outcome: DirectMessageOutcome) => void;
}

/**
 * F-CAP-1 message pairing for live DMs. In the field a photo and its caption
 * are two messages seconds apart, in either order; they must reach the server
 * as ONE capture so the model sees the caption when it picks the card.
 *
 * - A message that is only files is held for the window. Text from the same
 *   sender inside the window travels with it as the caption; otherwise the
 *   files are sent alone when the window closes.
 * - Text is sent straight away. When the server says it recognised no verb
 *   (`holdReplyForCaption`), the "I did not understand" reply is held for the
 *   window and dropped if files arrive, which then carry the text as caption.
 *
 * Held state is memory only. A bridge that stops while holding a photo loses
 * nothing: the photo is still in the DM history and the F-DM-3 replay sends it
 * (unpaired, which costs the caption a separate answer but never the capture).
 */
export class DmPairing {
  private readonly held = new Map<string, HeldMedia | HeldReply>();

  constructor(private readonly ctx: DirectMessageContext, private readonly windowMs = DM_PAIRING_WINDOW_MS) {}

  async handle(message: Message): Promise<DirectMessageOutcome> {
    if (message.author.bot || message.guildId !== null) return "ignored";
    const author = message.author.id;
    const hasFiles = message.attachments.size > 0 && !isForward(message);
    const hasText = message.content.trim().length > 0;
    const held = this.held.get(author);

    if (held?.kind === "media" && !hasFiles && hasText && !isForward(message)) {
      // Photo first, caption next.
      this.release(author);
      const outcome = await handleDirectMessage(this.ctx, held.message, { caption: message });
      held.settle(outcome);
      return outcome;
    }
    if (held?.kind === "reply" && hasFiles && !hasText) {
      // Caption first, photo next: the held "not understood" reply is never sent.
      this.release(author);
      held.settle("answered");
      return handleDirectMessage(this.ctx, message, { caption: held.message });
    }
    // Anything else ends the wait for whatever was held.
    if (held) await this.flush(author);

    if (hasFiles && !hasText) {
      return new Promise<DirectMessageOutcome>((resolve) => {
        const timer = setTimeout(() => void this.flush(author), this.windowMs);
        this.held.set(author, { kind: "media", message, timer, settle: resolve });
      });
    }

    const submission = await submitDirectMessage(this.ctx, message, {});
    if (submission.outcome !== "answered") return submission.outcome;
    if (!submission.holdReplyForCaption || this.held.has(author)) return postReply(message, submission.reply);
    return new Promise<DirectMessageOutcome>((resolve) => {
      const timer = setTimeout(() => void this.flush(author), this.windowMs);
      this.held.set(author, { kind: "reply", message, reply: submission.reply, timer, settle: resolve });
    });
  }

  /** Stops every timer. Held photos stay in Discord's DM history for the replay. */
  stop() {
    for (const author of [...this.held.keys()]) {
      const held = this.release(author);
      held?.settle("ignored");
    }
  }

  private release(author: string) {
    const held = this.held.get(author);
    if (!held) return undefined;
    clearTimeout(held.timer);
    this.held.delete(author);
    return held;
  }

  /** The window closed (or something else arrived): act on the held item by itself. */
  private async flush(author: string) {
    const held = this.release(author);
    if (!held) return;
    held.settle(held.kind === "media"
      ? await handleDirectMessage(this.ctx, held.message)
      : await postReply(held.message, held.reply));
  }
}

function attachmentMetadata(attachments: Iterable<Attachment>) {
  return [...attachments].map((attachment) => ({
    id: attachment.id,
    filename: attachment.name,
    contentType: attachment.contentType ?? null,
    size: attachment.size,
    // F-CAP-1: the server fetches the bytes itself, after its own type and size gate.
    ...(attachment.url ? { url: attachment.url } : {}),
  }));
}

function logFailure(message: Message, error: unknown) {
  // Never log message content, filenames, or response bodies.
  console.error("discord_dm_failed", {
    messageId: message.id,
    code: error instanceof DiscordIntegrationApiError ? error.code : "unexpected_error",
  });
}
