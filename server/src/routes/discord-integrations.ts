import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, isNull, lte } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import {
  companyMemberships,
  discordDeliveryAttempts,
  discordGuildIntegrations,
  discordInboundRequests,
  discordLinkCodes,
  discordNotificationPreferences,
  discordProjectChannelMappings,
  discordUserLinks,
  integrationEventOutbox,
  issues,
  projects,
} from "@paperclipai/db";
import { badRequest, forbidden, HttpError, unauthorized } from "../errors.js";
import { issueService } from "../services/issues.js";
import { assertCompanyAccess, assertInstanceAdmin } from "./authz.js";

export const DISCORD_NOTIFICATION_EVENTS = [
  "issue.created",
  "issue.status_changed",
  "issue.assignee_changed",
  "issue.priority_changed",
  "issue.comment_created",
  "issue.blocked",
  "issue.unblocked",
  "issue.completed",
] as const;

const eventType = z.enum(DISCORD_NOTIFICATION_EVENTS);
const bridgeTaskSchema = z.object({
  discordInteractionId: z.string().trim().min(1).max(128),
  discordUserId: z.string().trim().min(1).max(128),
  guildId: z.string().trim().min(1).max(128).nullable(),
  channelId: z.string().trim().min(1).max(128),
  parentChannelId: z.string().trim().min(1).max(128).nullable().optional(),
  commandName: z.literal("paperclip task create"),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(8_000).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
}).strict();
const preferenceSchema = z.object({
  preferences: z.array(z.object({
    eventType,
    enabled: z.boolean(),
    deliveryMode: z.enum(["dm", "channel"]),
    channelId: z.string().trim().min(1).max(128).nullable(),
  }).strict()).max(DISCORD_NOTIFICATION_EVENTS.length),
}).strict();
const mappingSchema = z.object({
  guildId: z.string().trim().min(1).max(128),
  channelId: z.string().trim().min(1).max(128),
  projectId: z.string().uuid(),
  enabled: z.boolean().default(true),
  allowTaskCreate: z.boolean().default(false),
  notificationEvents: z.array(eventType).default([]),
}).strict();
const acknowledgementSchema = z.object({
  outcome: z.enum(["delivered", "suppressed", "retryable_failure", "terminal_failure"]),
  discordMessageId: z.string().trim().min(1).max(128).optional(),
  errorCode: z.string().trim().min(1).max(80).optional(),
  retryAfterSeconds: z.number().finite().min(0).max(86_400).optional(),
}).strict();

function codeHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
function bridgeAuthorized(header: string | undefined) {
  const expected = process.env.PAPERCLIP_DISCORD_BRIDGE_TOKEN?.trim();
  const supplied = header?.replace(/^Bearer\s+/i, "").trim();
  if (!expected || !supplied) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}
function assertBridge(req: { header(name: string): string | undefined }) {
  if (!process.env.PAPERCLIP_DISCORD_BRIDGE_TOKEN?.trim()) throw unauthorized("Discord bridge is not configured");
  if (!bridgeAuthorized(req.header("authorization"))) throw unauthorized("Discord bridge authentication required");
}
function asHttp(code: string, status: number) {
  if (status === 401) return new HttpError(401, code, { code });
  if (status === 403) return forbidden(code, { code });
  return new HttpError(status, code, { code });
}
function issueUrl(issue: { id: string; identifier: string | null }) {
  const base = process.env.PAPERCLIP_DASHBOARD_URL?.replace(/\/$/, "") ?? "";
  return `${base}/issues/${encodeURIComponent(issue.identifier ?? issue.id)}`;
}

export function discordIntegrationRoutes(db: Db) {
  const router = Router();
  const issueSvc = issueService(db);


  async function browserUser(req: { actor: { type: string; userId?: string } }) {
    if (req.actor.type !== "board" || !req.actor.userId) throw unauthorized("Board authentication required");
    return req.actor.userId;
  }
  async function settings(userId: string, companyId: string) {
    const [link, preferences] = await Promise.all([
      db.select().from(discordUserLinks).where(and(eq(discordUserLinks.companyId, companyId), eq(discordUserLinks.userId, userId), eq(discordUserLinks.active, true))).then((rows) => rows[0] ?? null),
      db.select().from(discordNotificationPreferences).where(and(eq(discordNotificationPreferences.companyId, companyId), eq(discordNotificationPreferences.userId, userId))),
    ]);
    const byEvent = new Map(preferences.map((row) => [row.eventType, row]));
    return {
      link: { status: link ? "linked" : "unlinked", discordUserId: link?.discordUserId ?? null },
      preferences: DISCORD_NOTIFICATION_EVENTS.map((name) => {
        const row = byEvent.get(name);
        return { eventType: name, enabled: row?.enabled ?? false, deliveryMode: row?.deliveryMode ?? "dm", channelId: row?.channelId ?? null };
      }),
    };
  }

  router.get("/integrations/discord/settings", async (req, res) => {
    const userId = await browserUser(req);
    const companyId = typeof req.query.companyId === "string" ? req.query.companyId : null;
    if (!companyId) throw badRequest("companyId is required");
    assertCompanyAccess(req, companyId);
    res.json(await settings(userId, companyId));
  });

  router.post("/integrations/discord/link-codes", async (req, res) => {
    const userId = await browserUser(req);
    const companyId = typeof req.body?.companyId === "string" ? req.body.companyId : null;
    if (!companyId) throw badRequest("companyId is required");
    assertCompanyAccess(req, companyId);
    const code = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await db.insert(discordLinkCodes).values({ companyId, userId, codeHash: codeHash(code), expiresAt });
    res.status(201).json({ code, expiresAt: expiresAt.toISOString() });
  });

  const updatePreferences = async (req: Request, res: Response) => {
    const userId = await browserUser(req);
    const companyId = typeof req.body?.companyId === "string" ? req.body.companyId : null;
    if (!companyId) throw badRequest("companyId is required");
    assertCompanyAccess(req, companyId);
    const input = preferenceSchema.parse(req.body);
    const channelIds = input.preferences
      .filter((preference) => preference.enabled && preference.deliveryMode === "channel" && preference.channelId)
      .map((preference) => preference.channelId!);
    if (channelIds.length > 0) {
      const mappings = await db.select({ channelId: discordProjectChannelMappings.channelId })
        .from(discordProjectChannelMappings)
        .where(and(
          eq(discordProjectChannelMappings.companyId, companyId),
          eq(discordProjectChannelMappings.enabled, true),
          inArray(discordProjectChannelMappings.channelId, [...new Set(channelIds)]),
        ));
      if (mappings.length !== new Set(channelIds).size) {
        throw forbidden("notification_channel_not_mapped", { code: "notification_channel_not_mapped" });
      }
    }
    const now = new Date();
    for (const preference of input.preferences) {
      await db.insert(discordNotificationPreferences).values({ companyId, userId, ...preference, updatedAt: now })
        .onConflictDoUpdate({ target: [discordNotificationPreferences.companyId, discordNotificationPreferences.userId, discordNotificationPreferences.eventType], set: { enabled: preference.enabled, deliveryMode: preference.deliveryMode, channelId: preference.channelId, updatedAt: now } });
    }
    res.json(await settings(userId, companyId));
  };

  router.patch("/integrations/discord/preferences", updatePreferences);
  // Legacy Account Settings client path. Both endpoints retain caller-owned
  // preference semantics while deployments migrate to the approved contract.
  router.put("/integrations/discord/notification-preferences", updatePreferences);

  const updateChannelMapping = async (req: Request, res: Response) => {
    const userId = await browserUser(req);
    const companyId = typeof req.body?.companyId === "string" ? req.body.companyId : null;
    if (!companyId) throw badRequest("companyId is required");
    assertCompanyAccess(req, companyId);
    assertInstanceAdmin(req);
    const { companyId: _companyId, ...input } = mappingSchema.extend({ companyId: z.string().uuid() }).parse(req.body);
    const project = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, input.projectId), eq(projects.companyId, companyId))).then((rows) => rows[0] ?? null);
    if (!project) throw forbidden("project_access_denied", { code: "project_access_denied" });
    const now = new Date();
    await db.insert(discordProjectChannelMappings).values({ companyId, ...input, createdByUserId: userId, updatedAt: now })
      .onConflictDoUpdate({ target: [discordProjectChannelMappings.guildId, discordProjectChannelMappings.channelId], set: { projectId: input.projectId, enabled: input.enabled, allowTaskCreate: input.allowTaskCreate, notificationEvents: input.notificationEvents, updatedAt: now } });
    await db.insert(discordGuildIntegrations).values({ companyId, guildId: input.guildId, enabled: true, createdByUserId: userId, updatedAt: now })
      .onConflictDoUpdate({ target: [discordGuildIntegrations.companyId, discordGuildIntegrations.guildId], set: { enabled: true, updatedAt: now } });
    res.status(201).json({ ok: true });
  };

  router.put("/integrations/discord/settings/channel-mappings", updateChannelMapping);
  router.put("/integrations/discord/channel-mappings", updateChannelMapping);

  const consumeLinkCode = async (req: Request, res: Response) => {
    assertBridge(req);
    const input = z.object({ code: z.string().trim().min(1).max(200), discordUserId: z.string().trim().min(1).max(128), guildId: z.string().trim().min(1).max(128).nullable().optional() }).strict().parse(req.body);
    const now = new Date();
    await db.transaction(async (tx) => {
      const code = await tx.select().from(discordLinkCodes).where(eq(discordLinkCodes.codeHash, codeHash(input.code))).then((rows) => rows[0] ?? null);
      if (!code) throw asHttp("invalid_link_code", 400);
      if (code.consumedAt) throw asHttp("link_code_used", 400);
      if (code.expiresAt <= now) throw asHttp("expired_link_code", 400);
      const existing = await tx.select().from(discordUserLinks).where(and(eq(discordUserLinks.companyId, code.companyId), eq(discordUserLinks.discordUserId, input.discordUserId))).then((rows) => rows[0] ?? null);
      if (existing?.active && existing.userId !== code.userId) throw asHttp("discord_account_already_linked", 409);
      const consumed = await tx.update(discordLinkCodes).set({ consumedAt: now })
        .where(and(eq(discordLinkCodes.id, code.id), isNull(discordLinkCodes.consumedAt)))
        .returning({ id: discordLinkCodes.id });
      if (!consumed[0]) throw asHttp("link_code_used", 400);
      await tx.insert(discordUserLinks).values({ companyId: code.companyId, userId: code.userId, discordUserId: input.discordUserId, active: true, primary: true, updatedAt: now })
        .onConflictDoUpdate({ target: [discordUserLinks.companyId, discordUserLinks.discordUserId], set: { userId: code.userId, active: true, primary: true, unlinkedAt: null, updatedAt: now } });
    });
    res.json({ status: "linked" });
  };

  router.post("/integrations/discord/link-codes/consume", consumeLinkCode);
  router.post("/integrations/discord/link", consumeLinkCode);

  router.post("/integrations/discord/unlink", async (req, res) => {
    assertBridge(req);
    const input = z.object({ discordUserId: z.string().trim().min(1).max(128) }).strict().parse(req.body);
    const now = new Date();
    const linked = await db.update(discordUserLinks).set({ active: false, unlinkedAt: now, updatedAt: now }).where(and(eq(discordUserLinks.discordUserId, input.discordUserId), eq(discordUserLinks.active, true))).returning();
    if (linked[0]) await db.update(discordNotificationPreferences).set({ enabled: false, updatedAt: now }).where(and(eq(discordNotificationPreferences.companyId, linked[0].companyId), eq(discordNotificationPreferences.userId, linked[0].userId)));
    res.json({ status: "unlinked" });
  });

  router.post("/integrations/discord/commands/task-create", async (req, res) => {
    assertBridge(req);
    const input = bridgeTaskSchema.parse(req.body);
    const existing = await db.select().from(discordInboundRequests).where(eq(discordInboundRequests.discordInteractionId, input.discordInteractionId)).then((rows) => rows[0] ?? null);
    if (existing?.issueId) {
      const issue = await db.select().from(issues).where(eq(issues.id, existing.issueId)).then((rows) => rows[0] ?? null);
      if (issue) return res.json({ duplicate: true, issue: { id: issue.id, identifier: issue.identifier, title: issue.title, url: issueUrl(issue) } });
    }
    if (existing) throw asHttp("interaction_conflict", 409);
    const mapping = await db.select().from(discordProjectChannelMappings)
      .innerJoin(discordGuildIntegrations, and(
        eq(discordGuildIntegrations.companyId, discordProjectChannelMappings.companyId),
        eq(discordGuildIntegrations.guildId, discordProjectChannelMappings.guildId),
        eq(discordGuildIntegrations.enabled, true),
      ))
      .where(and(
        eq(discordProjectChannelMappings.guildId, input.guildId ?? ""),
        inArray(discordProjectChannelMappings.channelId, [input.channelId, input.parentChannelId ?? ""]),
        eq(discordProjectChannelMappings.enabled, true),
      ))
      .then((rows) => rows[0]?.discord_project_channel_mappings ?? null);
    if (!mapping) throw asHttp("channel_not_mapped", 403);
    if (!mapping.allowTaskCreate) throw asHttp("task_creation_disabled", 403);
    const link = await db.select().from(discordUserLinks).where(and(eq(discordUserLinks.companyId, mapping.companyId), eq(discordUserLinks.discordUserId, input.discordUserId), eq(discordUserLinks.active, true))).then((rows) => rows[0] ?? null);
    if (!link) throw asHttp("not_linked", 403);
    const membership = await db.select({ id: companyMemberships.id }).from(companyMemberships).where(and(eq(companyMemberships.companyId, mapping.companyId), eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, link.userId), eq(companyMemberships.status, "active"))).then((rows) => rows[0] ?? null);
    if (!membership) throw asHttp("project_access_denied", 403);
    await db.insert(discordInboundRequests).values({ discordInteractionId: input.discordInteractionId, discordUserId: input.discordUserId, guildId: input.guildId, channelId: input.channelId, commandName: input.commandName, companyId: mapping.companyId, status: "processing" });
    try {
      const issue = await issueSvc.create(mapping.companyId, { idempotencyKey: `discord:${input.discordInteractionId}`, allowDuplicate: true, title: input.title, description: input.description ?? null, priority: input.priority === "urgent" ? "high" : input.priority ?? "medium", projectId: mapping.projectId, createdByUserId: link.userId, originKind: "discord", originId: input.discordInteractionId, originFingerprint: input.discordInteractionId } as never);
      const event = await db.insert(integrationEventOutbox).values({ idempotencyKey: `discord:issue.created:${issue.id}`, companyId: mapping.companyId, projectId: mapping.projectId, issueId: issue.id, eventType: "issue.created", origin: "discord", originDiscordChannelId: input.channelId, payload: { issueIdentifier: issue.identifier, title: issue.title, issueUrl: issueUrl(issue) } }).returning().then((rows) => rows[0]!);
      await db.update(discordInboundRequests).set({ issueId: issue.id, status: "succeeded", updatedAt: new Date() }).where(eq(discordInboundRequests.discordInteractionId, input.discordInteractionId));
      const recipients = await db.select().from(discordProjectChannelMappings).where(and(eq(discordProjectChannelMappings.companyId, mapping.companyId), eq(discordProjectChannelMappings.projectId, mapping.projectId), eq(discordProjectChannelMappings.enabled, true)));
      for (const recipient of recipients) if (recipient.notificationEvents.includes("issue.created") && recipient.channelId !== input.channelId) await db.insert(discordDeliveryAttempts).values({ eventId: event.id, recipientType: "channel", recipientId: recipient.channelId, idempotencyKey: `${event.id}:channel:${recipient.channelId}` }).onConflictDoNothing();
      res.status(201).json({ duplicate: false, issue: { id: issue.id, identifier: issue.identifier, title: issue.title, url: issueUrl(issue) } });
    } catch (error) {
      await db.update(discordInboundRequests).set({ status: "failed", errorCode: "create_failed", updatedAt: new Date() }).where(eq(discordInboundRequests.discordInteractionId, input.discordInteractionId));
      throw error;
    }
  });

  router.get("/integrations/discord/deliveries/pending", async (req, res) => {
    assertBridge(req);
    const now = new Date();
    const rows = await db.select({ delivery: discordDeliveryAttempts, event: integrationEventOutbox }).from(discordDeliveryAttempts).innerJoin(integrationEventOutbox, eq(discordDeliveryAttempts.eventId, integrationEventOutbox.id)).where(and(eq(discordDeliveryAttempts.status, "pending"), lte(discordDeliveryAttempts.nextAttemptAt, now))).limit(100);
    res.json(rows.map(({ delivery, event }) => ({ id: delivery.id, recipient: { type: delivery.recipientType, id: delivery.recipientId }, event: { id: event.id, idempotencyKey: event.idempotencyKey, occurredAt: event.occurredAt.toISOString(), eventType: event.eventType, origin: event.origin, originDiscordChannelId: event.originDiscordChannelId, ...event.payload } })));
  });

  router.post("/integrations/discord/events/:eventId/deliveries/:deliveryId", async (req, res) => {
    assertBridge(req);
    const input = acknowledgementSchema.parse(req.body);
    const eventId = req.params.eventId as string;
    const deliveryId = req.params.deliveryId as string;
    const delivery = await db.select().from(discordDeliveryAttempts).where(and(eq(discordDeliveryAttempts.id, deliveryId), eq(discordDeliveryAttempts.eventId, eventId))).then((rows) => rows[0] ?? null);
    if (!delivery) throw badRequest("delivery_not_found");
    if (["delivered", "suppressed", "terminal_failure"].includes(delivery.status)) return res.json({ status: delivery.status });
    const now = new Date();
    const retry = input.outcome === "retryable_failure";
    const nextAttemptAt = new Date(now.getTime() + Math.max(1, input.retryAfterSeconds ?? Math.min(3600, 2 ** Math.min(delivery.attempts + 1, 10))) * 1000);
    const status = retry ? "pending" : input.outcome;
    await db.update(discordDeliveryAttempts).set({ status, attempts: delivery.attempts + 1, nextAttemptAt: retry ? nextAttemptAt : now, discordMessageId: input.discordMessageId ?? delivery.discordMessageId, errorCode: input.errorCode ?? null, updatedAt: now }).where(eq(discordDeliveryAttempts.id, deliveryId));
    res.json({ status });
  });

  return router;
}
