import { createHash } from "node:crypto";
import { and, eq, isNull, notInArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { labels, projectMemberships, projects } from "@paperclipai/db";
import { INTAKE_TRIAGE_LABEL_NAME } from "@paperclipai/shared";
import { logActivity } from "./activity-log.js";
import { formatChatCorrelationLine, issueDossierService } from "./issue-dossier.js";
import { issueService } from "./issues.js";

// F-004-1 job-order intake (PC-004 AC1/AC4): a job order forwarded (or typed
// after the capture phrase) in a Discord DM becomes a card assigned to the
// engineer, with a seeded dossier, and a resolved project or the triage label.
// Deterministic on purpose: no LLM call decides the title or the project, so
// the same message always lands the same way.

export const INTAKE_TITLE_MAX_CHARS = 120;
const TRIAGE_LABEL_COLOR = "#f59e0b";
const CLOSED_PROJECT_STATUSES = ["completed", "cancelled"];

/** The card title: the job order's first non-empty line, cut at a word boundary. */
export function intakeTitle(text: string): string {
  const firstLine = text.split("\n").map((line) => line.replace(/\s+/gu, " ").trim()).find(Boolean) ?? "";
  if (firstLine.length <= INTAKE_TITLE_MAX_CHARS) return firstLine;
  const cut = firstLine.slice(0, INTAKE_TITLE_MAX_CHARS - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > INTAKE_TITLE_MAX_CHARS / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Case-, spacing- and diacritic-insensitive form, so "Trạm bơm" matches "tram bom". */
function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/giu, "d").toLowerCase().replace(/\s+/gu, " ").trim();
}

/**
 * The project a job order belongs to, among the engineer's own open projects:
 * the only one, or else the only one whose name the text mentions. Anything
 * else is `null` and the card goes to triage — a wrong guess would file the
 * card where its PM never looks.
 */
export function resolveIntakeProject(candidates: Array<{ id: string; name: string }>, text: string): string | null {
  if (candidates.length === 1) return candidates[0]!.id;
  const folded = fold(text);
  const mentioned = candidates.filter((project) => {
    const name = fold(project.name);
    return name.length >= 3 && folded.includes(name);
  });
  return mentioned.length === 1 ? mentioned[0]!.id : null;
}

/**
 * PC-004 AC4 key for `issue_create_idempotency_keys`. A forward carries the
 * original message's id, so re-forwarding it matches even though each forward
 * is a new Discord message; typed text falls back to a hash of its content.
 * Scoped per engineer: two engineers forwarding one order get one card each.
 */
export function intakeIdempotencyKey(input: {
  discordUserId: string;
  origin: { channelId: string; messageId: string } | null;
  text: string;
}): string {
  if (input.origin) return `discord-intake:${input.discordUserId}:msg:${input.origin.channelId}:${input.origin.messageId}`;
  const digest = createHash("sha256").update(fold(input.text)).digest("hex");
  return `discord-intake:${input.discordUserId}:text:${digest}`;
}

export interface IntakeInput {
  companyId: string;
  userId: string;
  discordUserId: string;
  /** The DM that carried the job order. */
  discordMessageId: string;
  /** The forwarded original, when there is one. */
  origin: { channelId: string; messageId: string } | null;
  text: string;
  /** Names of attachments that came with the job order; their bytes are not stored yet (F-CAP-1). */
  attachmentNames: string[];
}

export interface IntakeResult {
  issue: { id: string; identifier: string | null; title: string };
  duplicate: boolean;
  triage: boolean;
}

export function discordIntakeService(db: Db) {
  const issueSvc = issueService(db);
  const dossierSvc = issueDossierService(db);

  async function engineerProjects(companyId: string, userId: string) {
    return db.select({ id: projects.id, name: projects.name })
      .from(projectMemberships)
      .innerJoin(projects, eq(projectMemberships.projectId, projects.id))
      .where(and(
        eq(projectMemberships.companyId, companyId),
        eq(projectMemberships.userId, userId),
        eq(projectMemberships.state, "joined"),
        eq(projects.companyId, companyId),
        isNull(projects.archivedAt),
        notInArray(projects.status, CLOSED_PROJECT_STATUSES),
      ));
  }

  async function triageLabelId(companyId: string) {
    await db.insert(labels).values({ companyId, name: INTAKE_TRIAGE_LABEL_NAME, color: TRIAGE_LABEL_COLOR }).onConflictDoNothing();
    const [label] = await db.select({ id: labels.id }).from(labels).where(and(eq(labels.companyId, companyId), eq(labels.name, INTAKE_TRIAGE_LABEL_NAME)));
    return label!.id;
  }

  return {
    async createFromJobOrder(input: IntakeInput): Promise<IntakeResult> {
      const text = input.text.trim();
      const title = intakeTitle(text);
      const description = input.attachmentNames.length > 0
        ? `${text}\n\nTệp đính kèm (chưa lưu vào thẻ): ${input.attachmentNames.join(", ")}`
        : text;
      const projectId = resolveIntakeProject(await engineerProjects(input.companyId, input.userId), text);
      let duplicate = false;
      const issue = await issueSvc.create(input.companyId, {
        title,
        description,
        priority: "medium",
        projectId,
        assigneeUserId: input.userId,
        createdByUserId: input.userId,
        originKind: "discord",
        originId: `discord-message:${input.origin?.messageId ?? input.discordMessageId}`,
        labelIds: projectId ? [] : [await triageLabelId(input.companyId)],
        idempotencyKey: intakeIdempotencyKey({ discordUserId: input.discordUserId, origin: input.origin, text }),
        allowDuplicate: true,
        onDeduplicated: () => {
          duplicate = true;
        },
      });

      // Checked, not assumed: a first attempt that created the card but died
      // before seeding is retried by the F-DM-3 replay and lands here as a duplicate.
      if (!(await dossierSvc.get(issue.id))) {
        const correlation = formatChatCorrelationLine({
          chatOriginId: input.origin?.messageId ?? input.discordMessageId,
          issueIdentifier: issue.identifier ?? issue.id,
          originKind: "discord",
        });
        await dossierSvc.seed(issue.id, { title: issue.title, jobOrder: `${correlation}\n\n${description}` }, { userId: input.userId });
      }
      if (!duplicate) {
        await logActivity(db, {
          companyId: input.companyId,
          actorType: "user",
          actorId: input.userId,
          action: "issue.created",
          entityType: "issue",
          entityId: issue.id,
          details: { title: issue.title, identifier: issue.identifier, source: "discord_intake", triage: !issue.projectId },
        });
      }
      return { issue: { id: issue.id, identifier: issue.identifier, title: issue.title }, duplicate, triage: !issue.projectId };
    },
  };
}
