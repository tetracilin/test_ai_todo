import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  createSchedulingRoutineSchema,
  generateSchedulingRoutineIssuesSchema,
  updateSchedulingRoutineSchema,
  upsertIssueSchedulingSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { badRequest, forbidden } from "../errors.js";
import { accessService, logActivity, schedulingService } from "../services/index.js";
import { authorizationDeniedDetails } from "../services/authorization.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

export function schedulingRoutes(db: Db) {
  const router = Router();
  const svc = schedulingService(db);
  const access = accessService(db);

  function actorIds(req: import("express").Request) {
    return {
      agentId: req.actor.type === "agent" ? req.actor.agentId : null,
      userId: req.actor.type === "board" ? req.actor.userId ?? null : null,
    };
  }

  function parseDateQueryParam(value: unknown, paramName: string): Date | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string" || value.trim() === "") {
      throw badRequest(`${paramName} must be a date string`);
    }
    const normalized = value.trim();
    const dateMatch = /^(\d{4})-(\d{2})-(\d{2})(?:T.*(?:Z|[+-]\d{2}:\d{2}))?$/.exec(normalized);
    if (!dateMatch) throw badRequest(`${paramName} is not a valid date`);
    const [, yearText, monthText, dayText] = dateMatch;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const calendarDate = new Date(Date.UTC(year, month - 1, day));
    if (
      calendarDate.getUTCFullYear() !== year ||
      calendarDate.getUTCMonth() !== month - 1 ||
      calendarDate.getUTCDate() !== day
    ) {
      throw badRequest(`${paramName} is not a valid date`);
    }
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) throw badRequest(`${paramName} is not a valid date`);
    return parsed;
  }

  function parseScheduledIssuesLimit(value: unknown): number {
    if (value === undefined) return 50;
    if (typeof value !== "string" || !/^\d+$/.test(value)) throw badRequest("limit must be an integer");
    const limit = Number(value);
    if (limit < 1 || limit > 100) throw badRequest("limit must be between 1 and 100");
    return limit;
  }

  function parseCursor(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string" || value.trim() === "") throw badRequest("cursor must be a non-empty string");
    return value;
  }

  async function assertCanGenerate(req: import("express").Request, companyId: string) {
    assertCompanyAccess(req, companyId);
    const decision = await access.decide({
      actor: req.actor,
      action: "tasks:assign",
      resource: { type: "issue", companyId, issueId: null, projectId: null },
    });
    if (!decision.allowed) throw forbidden(decision.explanation, authorizationDeniedDetails(decision));
  }

  // --- Per-issue scheduling fields ---

  router.get("/companies/:companyId/issues/:issueId/scheduling", async (req, res) => {
    const companyId = req.params.companyId as string;
    const issueId = req.params.issueId as string;
    assertCompanyAccess(req, companyId);
    const scheduling = await svc.getIssueScheduling(companyId, issueId);
    res.json({ scheduling });
  });

  router.put(
    "/companies/:companyId/issues/:issueId/scheduling",
    validate(upsertIssueSchedulingSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const issueId = req.params.issueId as string;
      await assertCanGenerate(req, companyId);
      const scheduling = await svc.upsertIssueScheduling(companyId, issueId, req.body);
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        agentApiKeyId: actor.agentApiKeyId,
        action: "issue.scheduling_updated",
        entityType: "issue",
        entityId: issueId,
        details: {
          scheduledAt: scheduling.scheduledAt,
          deferUntil: scheduling.deferUntil,
          scheduledDurationMinutes: scheduling.scheduledDurationMinutes,
        },
      });
      res.json({ scheduling });
    },
  );

  router.delete("/companies/:companyId/issues/:issueId/scheduling", async (req, res) => {
    const companyId = req.params.companyId as string;
    const issueId = req.params.issueId as string;
    await assertCanGenerate(req, companyId);
    const deleted = await svc.clearIssueScheduling(companyId, issueId);
    if (deleted) {
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        agentApiKeyId: actor.agentApiKeyId,
        action: "issue.scheduling_cleared",
        entityType: "issue",
        entityId: issueId,
      });
    }
    res.json({ deleted });
  });

  router.get("/companies/:companyId/scheduled-issues", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const from = parseDateQueryParam(req.query.from, "from");
    const to = parseDateQueryParam(req.query.to, "to");
    if (from && to && from > to) throw badRequest("from must be before or equal to to");
    const limit = parseScheduledIssuesLimit(req.query.limit);
    const cursor = parseCursor(req.query.cursor);
    const result = await svc.listScheduledIssues(companyId, { from, to, limit, cursor });
    res.json(result);
  });

  // --- Recurring scheduling routines (templates) ---

  router.get("/companies/:companyId/scheduling-routines", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const routines = await svc.listRoutines(companyId);
    res.json({ routines });
  });

  router.get("/companies/:companyId/scheduling-routines/:routineId", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const routine = await svc.getRoutine(companyId, req.params.routineId as string);
    res.json(routine);
  });

  router.post(
    "/companies/:companyId/scheduling-routines",
    validate(createSchedulingRoutineSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      await assertCanGenerate(req, companyId);
      const created = await svc.createRoutine(companyId, req.body, actorIds(req));
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        agentApiKeyId: actor.agentApiKeyId,
        action: "scheduling_routine.created",
        entityType: "scheduling_routine",
        entityId: created.id,
        details: { title: created.title, recurrenceRule: created.recurrenceRule },
      });
      res.status(201).json(created);
    },
  );

  router.patch(
    "/companies/:companyId/scheduling-routines/:routineId",
    validate(updateSchedulingRoutineSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const routineId = req.params.routineId as string;
      await assertCanGenerate(req, companyId);
      const updated = await svc.updateRoutine(companyId, routineId, req.body);
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        agentApiKeyId: actor.agentApiKeyId,
        action: "scheduling_routine.updated",
        entityType: "scheduling_routine",
        entityId: updated.id,
        details: { title: updated.title, status: updated.status },
      });
      res.json(updated);
    },
  );

  router.delete("/companies/:companyId/scheduling-routines/:routineId", async (req, res) => {
    const companyId = req.params.companyId as string;
    const routineId = req.params.routineId as string;
    await assertCanGenerate(req, companyId);
    const deleted = await svc.deleteRoutine(companyId, routineId);
    if (deleted) {
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        agentApiKeyId: actor.agentApiKeyId,
        action: "scheduling_routine.deleted",
        entityType: "scheduling_routine",
        entityId: routineId,
      });
    }
    res.json({ deleted });
  });

  router.post(
    "/companies/:companyId/scheduling-routines/generate",
    validate(generateSchedulingRoutineIssuesSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      await assertCanGenerate(req, companyId);
      const results = await svc.generateDueIssues(companyId, req.body);
      res.json({ results });
    },
  );

  router.post(
    "/companies/:companyId/scheduling-routines/:routineId/generate",
    validate(generateSchedulingRoutineIssuesSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const routineId = req.params.routineId as string;
      await assertCanGenerate(req, companyId);
      const result = await svc.generateDueIssuesForRoutine(companyId, routineId, req.body);
      res.json(result);
    },
  );

  return router;
}
