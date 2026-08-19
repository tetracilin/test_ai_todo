import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  createSchedulingRoutineSchema,
  generateSchedulingRoutineIssuesSchema,
  updateSchedulingRoutineSchema,
  upsertIssueSchedulingSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { badRequest } from "../errors.js";
import { logActivity, schedulingService } from "../services/index.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

export function schedulingRoutes(db: Db) {
  const router = Router();
  const svc = schedulingService(db);

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
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw badRequest(`${paramName} is not a valid date`);
    return parsed;
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
      assertCompanyAccess(req, companyId);
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
    assertCompanyAccess(req, companyId);
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
    const items = await svc.listScheduledIssues(companyId, { from, to });
    res.json({ items });
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
      assertCompanyAccess(req, companyId);
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
      assertCompanyAccess(req, companyId);
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
    assertCompanyAccess(req, companyId);
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
      assertCompanyAccess(req, companyId);
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
      assertCompanyAccess(req, companyId);
      const result = await svc.generateDueIssuesForRoutine(companyId, routineId, req.body);
      res.json(result);
    },
  );

  return router;
}
