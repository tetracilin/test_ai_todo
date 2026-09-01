import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  createWorkQueueItemSchema,
  createWorkQueueSchema,
  dismissWorkQueueItemSchema,
  promoteWorkQueueItemSchema,
  workQueueItemStatusSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { badRequest } from "../errors.js";
import { workQueueService, logActivity } from "../services/index.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

export function workQueueRoutes(db: Db) {
  const router = Router();
  const svc = workQueueService(db);

  function actorRef(actor: ReturnType<typeof getActorInfo>) {
    return {
      agentId: actor.agentId,
      userId: actor.actorType === "user" ? actor.actorId : null,
    };
  }

  function parseStatus(value: unknown) {
    if (value === undefined) return undefined;
    const result = workQueueItemStatusSchema.safeParse(value);
    if (!result.success) throw badRequest("Invalid status query parameter");
    return result.data;
  }

  router.get("/companies/:companyId/work-queues", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await svc.listQueues(companyId));
  });

  router.post("/companies/:companyId/work-queues", validate(createWorkQueueSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const created = await svc.createQueue(companyId, req.body);
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      agentApiKeyId: actor.agentApiKeyId,
      action: "work_queue.created",
      entityType: "work_queue",
      entityId: created.id,
      details: { name: created.name },
    });
    res.status(201).json(created);
  });

  router.get("/companies/:companyId/work-queues/:queueId/items", async (req, res) => {
    const companyId = req.params.companyId as string;
    const queueId = req.params.queueId as string;
    assertCompanyAccess(req, companyId);
    const status = parseStatus(req.query.status);
    res.json(await svc.listItems(companyId, queueId, { status }));
  });

  router.post(
    "/companies/:companyId/work-queues/:queueId/items",
    validate(createWorkQueueItemSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const queueId = req.params.queueId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const created = await svc.addItem(companyId, queueId, req.body, actorRef(actor));
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        agentApiKeyId: actor.agentApiKeyId,
        action: "work_queue_item.added",
        entityType: "work_queue_item",
        entityId: created.id,
        details: { queueId, title: created.title, sourceLabel: created.sourceLabel },
      });
      res.status(201).json(created);
    },
  );

  router.post(
    "/companies/:companyId/work-queues/:queueId/items/:itemId/promote",
    validate(promoteWorkQueueItemSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const itemId = req.params.itemId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const { item, issue } = await svc.promoteItem(companyId, itemId, req.body, actorRef(actor));
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        agentApiKeyId: actor.agentApiKeyId,
        action: "work_queue_item.promoted",
        entityType: "work_queue_item",
        entityId: itemId,
        details: { issueId: issue.id },
      });
      res.json({ item, issue });
    },
  );

  router.post(
    "/companies/:companyId/work-queues/:queueId/items/:itemId/dismiss",
    validate(dismissWorkQueueItemSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const itemId = req.params.itemId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const dismissed = await svc.dismissItem(companyId, itemId, req.body, actorRef(actor));
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        agentApiKeyId: actor.agentApiKeyId,
        action: "work_queue_item.dismissed",
        entityType: "work_queue_item",
        entityId: itemId,
        details: { reason: dismissed.dismissReason },
      });
      res.json(dismissed);
    },
  );

  return router;
}
