import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { pinIssueEventSchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { badRequest, forbidden } from "../errors.js";
import { accessService, calendarEventsService, logActivity, publishActivity } from "../services/index.js";
import type { ActivityPublication } from "../services/activity-log.js";
import { authorizationDeniedDetails } from "../services/authorization.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

function parseDateQuery(value: unknown, name: string): Date | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") throw badRequest(`${name} must be a date string`);
  const parsed = new Date(value.trim());
  if (Number.isNaN(parsed.getTime())) throw badRequest(`${name} is not a valid date`);
  return parsed;
}

function parseLimit(value: unknown): number {
  if (value === undefined) return 50;
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw badRequest("limit must be an integer");
  const limit = Number(value);
  if (limit < 1 || limit > 100) throw badRequest("limit must be between 1 and 100");
  return limit;
}

export function calendarEventsRoutes(db: Db) {
  const router = Router();
  const access = accessService(db);

  async function assertCanChange(req: import("express").Request, companyId: string) {
    assertCompanyAccess(req, companyId);
    const decision = await access.decide({
      actor: req.actor,
      action: "tasks:assign",
      resource: { type: "issue", companyId, issueId: null, projectId: null },
    });
    if (!decision.allowed) throw forbidden(decision.explanation, authorizationDeniedDetails(decision));
  }

  function actorIds(req: import("express").Request) {
    return {
      agentId: req.actor.type === "agent" ? req.actor.agentId ?? null : null,
      userId: req.actor.type === "board" ? req.actor.userId ?? null : null,
    };
  }

  router.get("/companies/:companyId/calendar-events", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const from = parseDateQuery(req.query.from, "from");
    const to = parseDateQuery(req.query.to, "to");
    if (from && to && from > to) throw badRequest("from must be before or equal to to");
    const limit = parseLimit(req.query.limit);
    const cursor = typeof req.query.cursor === "string" && req.query.cursor ? req.query.cursor : undefined;
    res.json(await calendarEventsService(db).listEvents(companyId, { from, to, limit, cursor }));
  });

  router.put(
    "/companies/:companyId/issues/:issueId/event",
    validate(pinIssueEventSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const issueId = req.params.issueId as string;
      await assertCanChange(req, companyId);
      const actor = getActorInfo(req);
      const publications: ActivityPublication[] = [];
      const { event, previous } = await db.transaction(async (tx) => {
        const result = await calendarEventsService(tx as unknown as Db).pinIssue(companyId, issueId, req.body, actorIds(req));
        await logActivity(
          tx as unknown as Db,
          {
            companyId,
            actorType: actor.actorType,
            actorId: actor.actorId,
            agentId: actor.agentId,
            runId: actor.runId,
            agentApiKeyId: actor.agentApiKeyId,
            action: result.previous ? "issue.event_moved" : "issue.event_pinned",
            entityType: "issue",
            entityId: issueId,
            details: {
              eventId: result.event.id,
              startsAt: result.event.startsAt,
              endsAt: result.event.endsAt,
              _previous: result.previous
                ? { startsAt: result.previous.startsAt, endsAt: result.previous.endsAt }
                : null,
            },
          },
          publications,
        );
        return result;
      });
      for (const publication of publications) publishActivity(publication);
      res.json({ event, moved: previous !== null });
    },
  );

  router.delete("/companies/:companyId/issues/:issueId/event", async (req, res) => {
    const companyId = req.params.companyId as string;
    const issueId = req.params.issueId as string;
    await assertCanChange(req, companyId);
    const actor = getActorInfo(req);
    const publications: ActivityPublication[] = [];
    const deleted = await db.transaction(async (tx) => {
      const result = await calendarEventsService(tx as unknown as Db).unpinIssue(companyId, issueId);
      if (result.deleted) {
        await logActivity(
          tx as unknown as Db,
          {
            companyId,
            actorType: actor.actorType,
            actorId: actor.actorId,
            agentId: actor.agentId,
            runId: actor.runId,
            agentApiKeyId: actor.agentApiKeyId,
            action: "issue.event_unpinned",
            entityType: "issue",
            entityId: issueId,
            details: {
              _previous: result.previous
                ? { startsAt: result.previous.startsAt, endsAt: result.previous.endsAt }
                : null,
            },
          },
          publications,
        );
      }
      return result.deleted;
    });
    for (const publication of publications) publishActivity(publication);
    res.json({ deleted });
  });

  return router;
}
