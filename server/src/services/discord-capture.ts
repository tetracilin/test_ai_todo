import { and, desc, eq, isNull, notInArray, or } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { issues, projects } from "@paperclipai/db";
import { isAllowedContentType, normalizeUploadAttachmentContentType } from "../attachment-types.js";
import { HttpError } from "../errors.js";
import { logger } from "../middleware/logger.js";
import type { StorageService } from "../storage/types.js";
import { logActivity } from "./activity-log.js";
import { ensureTriageLabelId } from "./discord-intake.js";
import { sniffAndValidateContentType, uploadMinioEvidenceFile } from "./evidence-provider-minio.js";
import { issueDossierService } from "./issue-dossier.js";
import { issueEvidenceLinkService, type EvidenceSource } from "./issue-evidence-links.js";
import { issueService } from "./issues.js";
import {
  STRUCTURING_MAX_CARDS,
  parseStructuringOutput,
  type CaptureEvidenceType,
  type StructuringCard,
  type StructuringClient,
  type StructuringUnavailableReason,
} from "./wp0-structuring.js";

// F-CAP-1 capture pipeline and F-CAP-2 fallback (WP-0 verb 1).
//
// A photo or file an engineer DMs the bot becomes evidence on one of their own
// open cards: fetch the bytes, ask the model ONCE which card it belongs to,
// store the bytes in the evidence bucket, link them with `source = bot`, and
// write one dossier Evidence-log line carrying the caption verbatim.
//
// Whatever goes wrong after the bytes are in hand, the capture is still filed:
// an unusable model answer is re-prompted once and then lands on the engineer's
// triage card, and so does a provider that cannot be reached. The only
// outcomes that store nothing are a download that failed (the engineer
// resends) and an evidence store that is down (the bridge replays the message).

/** This is the first and only `bot` producer (PC-011 AC2): a filing act that arrived through the chat bot. */
const CAPTURE_EVIDENCE_SOURCE: EvidenceSource = "bot";

/** Discord serves attachment bytes from these hosts only; nothing else is ever fetched. */
export const DISCORD_ATTACHMENT_HOSTS = ["cdn.discordapp.com", "media.discordapp.net"] as const;
export const MEDIA_FETCH_TIMEOUT_MS = 30_000;
/** The model is asked at most twice per capture: the one call, and the one re-prompt of F-CAP-2. */
export const CAPTURE_MAX_LLM_CALLS = 2;
export const CAPTURE_TRIAGE_CARD_TITLE = "Unsorted chat captures";
const CLOSED_ISSUE_STATUSES = ["done", "cancelled"];
const SUMMARY_CAPTION_MAX_CHARS = 80;

export interface CaptureAttachment {
  id: string;
  filename: string;
  contentType: string | null;
  size: number;
  url: string;
}

export interface CaptureInput {
  companyId: string;
  userId: string;
  discordUserId: string;
  discordMessageId: string;
  /** The engineer's text for this capture: the media message's own text and/or the paired message. */
  caption: string | null;
  attachments: CaptureAttachment[];
  maxBytes: number;
}

export type CaptureTriageReason =
  | "no_open_cards"
  /** The model answered twice and neither answer was usable. */
  | "unstructured"
  /** The model said no card fits. */
  | "no_match"
  | "provider_unavailable";

export type CaptureResult =
  | { kind: "filed"; card: CaptureCard; summary: string; llmCalls: number }
  | { kind: "triage"; reason: CaptureTriageReason; card: CaptureCard; llmCalls: number }
  /** Nothing was stored; the engineer resends (a new message id, so nothing blocks it). */
  | { kind: "media_fetch_failed"; filename: string }
  /** The bytes are not what the file claims to be; nothing was stored. */
  | { kind: "media_rejected"; filename: string };

export interface CaptureCard {
  id: string;
  identifier: string | null;
  title: string;
}

class MediaFetchError extends Error {}

export type MediaFetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Downloads one Discord attachment. The URL comes from the bridge, but it is
 * still checked here: https, a Discord CDN host, no redirect, and never more
 * than `maxBytes` read into memory.
 */
export async function fetchDiscordAttachment(url: string, maxBytes: number, doFetch: MediaFetch = (target, init) => fetch(target, init)): Promise<Buffer> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new MediaFetchError("attachment_url_invalid");
  }
  const allowedHost = (DISCORD_ATTACHMENT_HOSTS as readonly string[]).includes(parsed.hostname.toLowerCase());
  if (parsed.protocol !== "https:" || !allowedHost || parsed.username || parsed.password || parsed.port) {
    throw new MediaFetchError("attachment_url_not_discord");
  }
  let response: Response;
  try {
    response = await doFetch(parsed.toString(), { redirect: "error", signal: AbortSignal.timeout(MEDIA_FETCH_TIMEOUT_MS) });
  } catch {
    throw new MediaFetchError("attachment_unreachable");
  }
  if (!response.ok || !response.body) throw new MediaFetchError("attachment_unavailable");
  const declaredLength = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new MediaFetchError("attachment_too_large");

  const chunks: Buffer[] = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new MediaFetchError("attachment_too_large");
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    if (error instanceof MediaFetchError) throw error;
    throw new MediaFetchError("attachment_stream_failed");
  }
  if (total === 0) throw new MediaFetchError("attachment_empty");
  return Buffer.concat(chunks, total);
}

function oneLine(value: string): string {
  // Backticks delimit fields in a dossier line, so one in a caption could forge a field.
  return value.replace(/`/gu, "'").replace(/\s+/gu, " ").trim();
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** The dossier Evidence-log caption: what it is, its name, then the engineer's words verbatim. */
export function captureDossierCaption(input: { evidenceType: CaptureEvidenceType | null; filename: string; caption: string | null; gloss: string | null }): string {
  const parts = [`[${input.evidenceType ?? "unstructured"}] ${oneLine(input.filename)}`];
  if (input.caption) parts.push(`"${oneLine(input.caption)}"`);
  if (input.gloss) parts.push(`(EN: ${oneLine(input.gloss)})`);
  return parts.join(" — ");
}

/** The `{{summary}}` of the confirmation line: what was filed, in the engineer's own words. */
export function captureSummary(filenames: string[], caption: string | null): string {
  const files = filenames.length === 1 ? `tệp ${oneLine(filenames[0]!)}` : `${filenames.length} tệp`;
  return caption ? `${files}: "${clip(oneLine(caption), SUMMARY_CAPTION_MAX_CHARS)}"` : files;
}

function triageOriginId(userId: string): string {
  return `discord-capture-triage:${userId}`;
}

export interface DiscordCaptureDeps {
  storage: StorageService;
  structuring: StructuringClient;
  fetchMedia?: MediaFetch;
}

export function discordCaptureService(db: Db, deps: DiscordCaptureDeps) {
  const issueSvc = issueService(db);
  const dossierSvc = issueDossierService(db);
  const evidenceLinks = issueEvidenceLinkService(db);

  /**
   * The cards a capture may be filed on: open, and the engineer is the assignee
   * or the creator (PC-003 AC2). The triage card is the fallback destination,
   * never a candidate.
   */
  async function openCards(companyId: string, userId: string) {
    const rows = await db.select({ id: issues.id, identifier: issues.identifier, title: issues.title, project: projects.name, originId: issues.originId })
      .from(issues)
      .leftJoin(projects, eq(issues.projectId, projects.id))
      .where(and(
        eq(issues.companyId, companyId),
        or(eq(issues.assigneeUserId, userId), eq(issues.createdByUserId, userId)),
        notInArray(issues.status, CLOSED_ISSUE_STATUSES),
        isNull(issues.hiddenAt),
      ))
      .orderBy(desc(issues.updatedAt))
      .limit(STRUCTURING_MAX_CARDS + 1);
    return rows.filter((row) => row.originId !== triageOriginId(userId) && row.identifier).slice(0, STRUCTURING_MAX_CARDS);
  }

  /** The engineer's one open triage card, created on first use and reused while it stays open. */
  async function triageCard(companyId: string, userId: string): Promise<CaptureCard> {
    const [existing] = await db.select({ id: issues.id, identifier: issues.identifier, title: issues.title })
      .from(issues)
      .where(and(
        eq(issues.companyId, companyId),
        eq(issues.originKind, "discord"),
        eq(issues.originId, triageOriginId(userId)),
        notInArray(issues.status, CLOSED_ISSUE_STATUSES),
        isNull(issues.hiddenAt),
      ))
      .orderBy(desc(issues.createdAt))
      .limit(1);
    if (existing) return existing;
    const created = await issueSvc.create(companyId, {
      title: CAPTURE_TRIAGE_CARD_TITLE,
      description: "Captures the chat bot could not place on a card. Move each evidence item to the right card, then close this one.",
      priority: "medium",
      projectId: null,
      assigneeUserId: userId,
      createdByUserId: userId,
      originKind: "discord",
      originId: triageOriginId(userId),
      labelIds: [await ensureTriageLabelId(db, companyId)],
    });
    await logActivity(db, {
      companyId,
      actorType: "user",
      actorId: userId,
      action: "issue.created",
      entityType: "issue",
      entityId: created.id,
      details: { title: created.title, identifier: created.identifier, source: "discord_capture", triage: true },
    });
    return { id: created.id, identifier: created.identifier, title: created.title };
  }

  /** Stores every file and links it on the card as bot-filed evidence, with one dossier line each. */
  async function fileOnCard(
    input: CaptureInput,
    card: CaptureCard,
    files: Array<{ attachment: CaptureAttachment; contentType: string; body: Buffer }>,
    structured: { evidenceType: CaptureEvidenceType; gloss: string } | null,
  ) {
    for (const file of files) {
      let externalObjectId: string;
      try {
        ({ externalObjectId } = await uploadMinioEvidenceFile(db, deps.storage, {
          companyId: input.companyId,
          originalFilename: file.attachment.filename,
          declaredContentType: file.contentType,
          body: file.body,
          maxBytes: input.maxBytes,
        }));
      } catch (error) {
        // The bytes were validated before this point, so a failure here is the
        // store itself. A 503 leaves the message unsettled and the bridge replays it.
        if (error instanceof HttpError && error.status < 500 && error.status !== 409) throw error;
        logger.error({ err: error, companyId: input.companyId }, "discord capture: evidence store write failed");
        throw new HttpError(503, "evidence_storage_unavailable");
      }
      const { link, created } = await evidenceLinks.link(card.id, { externalObjectId }, CAPTURE_EVIDENCE_SOURCE, async (tx, result) => {
        if (!result.created) return;
        await logActivity(tx, {
          companyId: input.companyId,
          actorType: "user",
          actorId: input.userId,
          action: "issue.evidence_linked",
          entityType: "issue",
          entityId: card.id,
          details: {
            evidenceLinkId: result.link.id,
            externalObjectId: result.link.externalObjectId,
            providerKey: result.link.providerKey,
            objectType: result.link.objectType,
            source: CAPTURE_EVIDENCE_SOURCE,
            via: "discord_capture",
            discordMessageId: input.discordMessageId,
            evidenceType: structured?.evidenceType ?? null,
          },
        });
      });
      // A re-sent photo that is already on this card is the same filing act: no second line.
      if (!created) continue;
      const caption = captureDossierCaption({
        evidenceType: structured?.evidenceType ?? null,
        filename: file.attachment.filename,
        caption: input.caption,
        gloss: structured?.gloss ?? null,
      });
      await dossierSvc.appendEvidenceLine(card.id, link, caption, { userId: input.userId }).catch((err) => {
        logger.warn({ err, issueId: card.id }, "discord capture: failed to append dossier evidence-log line");
      });
    }
  }

  async function logOutcome(input: CaptureInput, card: CaptureCard, details: Record<string, unknown>) {
    await logActivity(db, {
      companyId: input.companyId,
      actorType: "user",
      actorId: input.userId,
      action: "discord.capture_filed",
      entityType: "issue",
      entityId: card.id,
      details: { discordMessageId: input.discordMessageId, attachments: input.attachments.length, hasCaption: Boolean(input.caption), ...details },
    });
  }

  return {
    async capture(input: CaptureInput): Promise<CaptureResult> {
      // 1. Bytes first, all or nothing: a capture is filed whole or not at all.
      const files: Array<{ attachment: CaptureAttachment; contentType: string; body: Buffer }> = [];
      for (const attachment of input.attachments) {
        let body: Buffer;
        try {
          body = await fetchDiscordAttachment(attachment.url, input.maxBytes, deps.fetchMedia);
        } catch (error) {
          if (!(error instanceof MediaFetchError)) throw error;
          logger.warn({ companyId: input.companyId, code: error.message }, "discord capture: media fetch failed");
          return { kind: "media_fetch_failed", filename: attachment.filename };
        }
        const declared = normalizeUploadAttachmentContentType({ contentType: attachment.contentType, originalFilename: attachment.filename, isAllowedContentType });
        try {
          files.push({ attachment, contentType: sniffAndValidateContentType(body, declared), body });
        } catch {
          return { kind: "media_rejected", filename: attachment.filename };
        }
      }

      // 2. Zero open cards goes to triage explicitly, with no model call at all.
      const cards = await openCards(input.companyId, input.userId);
      if (cards.length === 0) {
        const card = await triageCard(input.companyId, input.userId);
        await fileOnCard(input, card, files, null);
        await logOutcome(input, card, { outcome: "triage", reason: "no_open_cards", llmCalls: 0 });
        return { kind: "triage", reason: "no_open_cards", card, llmCalls: 0 };
      }

      // 3. The one bounded call, and at most one re-prompt when its answer is unusable.
      const offered: StructuringCard[] = cards.map((card) => ({ identifier: card.identifier!, title: card.title, project: card.project }));
      const identifiers = offered.map((card) => card.identifier);
      const message = { caption: input.caption, filenames: input.attachments.map((attachment) => attachment.filename) };
      let llmCalls = 0;
      let previousReply: string | undefined;
      let structured: ReturnType<typeof parseStructuringOutput> = null;
      let unavailable: StructuringUnavailableReason | null = null;
      while (llmCalls < CAPTURE_MAX_LLM_CALLS && !structured) {
        llmCalls += 1;
        const reply = await deps.structuring.call({ companyId: input.companyId, cards: offered, message, previousReply });
        if (!reply.ok) {
          unavailable = reply.reason;
          break;
        }
        structured = parseStructuringOutput(reply.text, identifiers);
        previousReply = reply.text;
      }

      // 4. A usable answer naming one of the engineer's own cards files the evidence there.
      const chosen = structured?.card ? cards.find((card) => card.identifier === structured!.card) ?? null : null;
      if (structured && chosen) {
        const card: CaptureCard = { id: chosen.id, identifier: chosen.identifier, title: chosen.title };
        await fileOnCard(input, card, files, structured);
        await logOutcome(input, card, { outcome: "filed", llmCalls, evidenceType: structured.evidenceType });
        return { kind: "filed", card, summary: captureSummary(message.filenames, input.caption), llmCalls };
      }

      // 5. F-CAP-2: everything else is filed raw on the triage card. Never lost.
      const reason: CaptureTriageReason = unavailable ? "provider_unavailable" : structured ? "no_match" : "unstructured";
      const card = await triageCard(input.companyId, input.userId);
      await fileOnCard(input, card, files, structured ? { evidenceType: structured.evidenceType, gloss: structured.gloss } : null);
      await logOutcome(input, card, { outcome: "triage", reason, llmCalls, ...(unavailable ? { providerFailure: unavailable } : {}) });
      return { kind: "triage", reason, card, llmCalls };
    },
  };
}
