import { Router, type Request, type Response } from "express";
import type { Db } from "@paperclipai/db";
import {
  createScratchNoteSchema,
  createStoryMapActivitySchema,
  createStoryMapEpicSchema,
  createStoryMapReleaseSchema,
  createStoryMapStorySchema,
  createStoryMapTaskSchema,
  moveStoryMapItemSchema,
  moveStoryMapStorySchema,
  updateScratchNoteSchema,
  updateStoryMapActivitySchema,
  updateStoryMapEpicSchema,
  updateStoryMapReleaseSchema,
  updateStoryMapStorySchema,
  updateStoryMapTaskSchema,
} from "@paperclipai/shared";
import type { ZodTypeAny } from "zod";
import { validate } from "../middleware/validate.js";
import { forbidden } from "../errors.js";
import { accessService, logActivity, storyMapService } from "../services/index.js";
import type { MovableStoryMapKind } from "../services/story-map.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";

type Service = ReturnType<typeof storyMapService>;
type Row = { id: string };

interface ItemKind {
  /** URL segment, e.g. "activities". */
  path: string;
  /** Activity-log entity type and action prefix, e.g. "story_map_activity". */
  entity: string;
  createSchema: ZodTypeAny;
  updateSchema: ZodTypeAny;
  create: (svc: Service, companyId: string, body: any) => Promise<Row>;
  update: (svc: Service, companyId: string, id: string, body: any) => Promise<Row>;
  remove: (svc: Service, companyId: string, id: string) => Promise<Row>;
  /** Fields copied from the row into the activity-log details. */
  logFields: string[];
}

const ITEM_KINDS: ItemKind[] = [
  {
    path: "activities",
    entity: "story_map_activity",
    createSchema: createStoryMapActivitySchema,
    updateSchema: updateStoryMapActivitySchema,
    create: (svc, companyId, body) => svc.createActivity(companyId, body),
    update: (svc, companyId, id, body) => svc.updateActivity(companyId, id, body),
    remove: (svc, companyId, id) => svc.deleteActivity(companyId, id),
    logFields: ["name", "position"],
  },
  {
    path: "tasks",
    entity: "story_map_task",
    createSchema: createStoryMapTaskSchema,
    updateSchema: updateStoryMapTaskSchema,
    create: (svc, companyId, body) => svc.createTask(companyId, body),
    update: (svc, companyId, id, body) => svc.updateTask(companyId, id, body),
    remove: (svc, companyId, id) => svc.deleteTask(companyId, id),
    logFields: ["name", "activityId", "position"],
  },
  {
    path: "releases",
    entity: "story_map_release",
    createSchema: createStoryMapReleaseSchema,
    updateSchema: updateStoryMapReleaseSchema,
    create: (svc, companyId, body) => svc.createRelease(companyId, body),
    update: (svc, companyId, id, body) => svc.updateRelease(companyId, id, body),
    remove: (svc, companyId, id) => svc.deleteRelease(companyId, id),
    logFields: ["name", "targetDate", "position"],
  },
  {
    path: "epics",
    entity: "story_map_epic",
    createSchema: createStoryMapEpicSchema,
    updateSchema: updateStoryMapEpicSchema,
    create: (svc, companyId, body) => svc.createEpic(companyId, body),
    update: (svc, companyId, id, body) => svc.updateEpic(companyId, id, body),
    remove: (svc, companyId, id) => svc.deleteEpic(companyId, id),
    logFields: ["name", "taskId", "position"],
  },
  {
    path: "stories",
    entity: "story_map_story",
    createSchema: createStoryMapStorySchema,
    updateSchema: updateStoryMapStorySchema,
    create: (svc, companyId, body) => svc.createStory(companyId, body),
    update: (svc, companyId, id, body) => svc.updateStory(companyId, id, body),
    remove: (svc, companyId, id) => svc.deleteStory(companyId, id),
    logFields: ["title", "taskId", "epicId", "releaseId", "status", "position"],
  },
];

function pick(row: Row, fields: string[]) {
  const values = row as unknown as Record<string, unknown>;
  return Object.fromEntries(fields.map((field) => [field, values[field]]));
}

export function storyMapRoutes(db: Db) {
  const router = Router();
  const svc = storyMapService(db);
  const access = accessService(db);

  async function log(req: Request, companyId: string, action: string, entityType: string, entityId: string, details: Record<string, unknown>) {
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      agentApiKeyId: actor.agentApiKeyId,
      action,
      entityType,
      entityId,
      details,
    });
  }

  /** Writes are for signed-in board users; reads follow company access. */
  function authorizeWrite(req: Request, companyId: string) {
    assertBoard(req);
    assertCompanyAccess(req, companyId);
  }

  /** Owners and admins of the company moderate the scratch pad (AD-106). */
  async function canModerate(req: Request, companyId: string) {
    if (req.actor.type !== "board") return false;
    if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) return true;
    const userId = req.actor.userId;
    if (!userId) return false;
    const membership = await access.getMembership(companyId, "user", userId);
    return membership?.status === "active" && (membership.membershipRole === "owner" || membership.membershipRole === "admin");
  }

  async function authorizeModerate(req: Request, companyId: string) {
    authorizeWrite(req, companyId);
    if (!(await canModerate(req, companyId))) throw forbidden("Only company owners and admins can do this");
  }

  function requireUserId(req: Request) {
    const userId = req.actor.userId;
    if (!userId) throw forbidden("A signed-in user is required");
    return userId;
  }

  router.get("/companies/:companyId/story-map", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await svc.getTree(companyId));
  });

  // Paths are literal on purpose: the OpenAPI coverage test reads them from this file.
  function itemHandlers(path: string) {
    const kind = ITEM_KINDS.find((entry) => entry.path === path)!;
    return {
      create: async (req: Request, res: Response) => {
        const companyId = req.params.companyId as string;
        authorizeWrite(req, companyId);
        const created = await kind.create(svc, companyId, req.body);
        await log(req, companyId, `${kind.entity}.created`, kind.entity, created.id, pick(created, kind.logFields));
        res.status(201).json(created);
      },
      update: async (req: Request, res: Response) => {
        const companyId = req.params.companyId as string;
        authorizeWrite(req, companyId);
        const updated = await kind.update(svc, companyId, req.params.itemId as string, req.body);
        await log(req, companyId, `${kind.entity}.updated`, kind.entity, updated.id, pick(updated, kind.logFields));
        res.json(updated);
      },
      move: async (req: Request, res: Response) => {
        const companyId = req.params.companyId as string;
        authorizeWrite(req, companyId);
        const moved = await svc.moveItem(companyId, path as MovableStoryMapKind, req.params.itemId as string, req.body);
        await log(req, companyId, `${kind.entity}.moved`, kind.entity, moved.id, {
          beforeId: req.body.beforeId ?? null,
          ...(req.body.releaseId !== undefined ? { releaseId: req.body.releaseId } : {}),
        });
        res.json(moved);
      },
      remove: async (req: Request, res: Response) => {
        const companyId = req.params.companyId as string;
        authorizeWrite(req, companyId);
        const removed = await kind.remove(svc, companyId, req.params.itemId as string);
        await log(req, companyId, `${kind.entity}.deleted`, kind.entity, removed.id, pick(removed, kind.logFields));
        res.json({ ok: true });
      },
    };
  }

  const activities = itemHandlers("activities");
  router.post("/companies/:companyId/story-map/activities", validate(createStoryMapActivitySchema), activities.create);
  router.patch("/companies/:companyId/story-map/activities/:itemId", validate(updateStoryMapActivitySchema), activities.update);
  router.post("/companies/:companyId/story-map/activities/:itemId/move", validate(moveStoryMapItemSchema), activities.move);
  router.delete("/companies/:companyId/story-map/activities/:itemId", activities.remove);

  const tasks = itemHandlers("tasks");
  router.post("/companies/:companyId/story-map/tasks", validate(createStoryMapTaskSchema), tasks.create);
  router.patch("/companies/:companyId/story-map/tasks/:itemId", validate(updateStoryMapTaskSchema), tasks.update);
  router.post("/companies/:companyId/story-map/tasks/:itemId/move", validate(moveStoryMapItemSchema), tasks.move);
  router.delete("/companies/:companyId/story-map/tasks/:itemId", tasks.remove);

  const releases = itemHandlers("releases");
  router.post("/companies/:companyId/story-map/releases", validate(createStoryMapReleaseSchema), releases.create);
  router.patch("/companies/:companyId/story-map/releases/:itemId", validate(updateStoryMapReleaseSchema), releases.update);
  router.post("/companies/:companyId/story-map/releases/:itemId/move", validate(moveStoryMapItemSchema), releases.move);
  router.delete("/companies/:companyId/story-map/releases/:itemId", releases.remove);

  const epics = itemHandlers("epics");
  router.post("/companies/:companyId/story-map/epics", validate(createStoryMapEpicSchema), epics.create);
  router.patch("/companies/:companyId/story-map/epics/:itemId", validate(updateStoryMapEpicSchema), epics.update);
  router.post("/companies/:companyId/story-map/epics/:itemId/move", validate(moveStoryMapItemSchema), epics.move);
  router.delete("/companies/:companyId/story-map/epics/:itemId", epics.remove);

  const stories = itemHandlers("stories");
  router.post("/companies/:companyId/story-map/stories", validate(createStoryMapStorySchema), stories.create);
  router.patch("/companies/:companyId/story-map/stories/:itemId", validate(updateStoryMapStorySchema), stories.update);
  router.post("/companies/:companyId/story-map/stories/:itemId/move", validate(moveStoryMapStorySchema), stories.move);
  router.delete("/companies/:companyId/story-map/stories/:itemId", stories.remove);

  router.get("/companies/:companyId/scratch-notes", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json({
      notes: await svc.listScratchNotes(companyId),
      viewerUserId: req.actor.type === "board" ? (req.actor.userId ?? null) : null,
      canModerate: await canModerate(req, companyId),
    });
  });

  router.post("/companies/:companyId/scratch-notes", validate(createScratchNoteSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    authorizeWrite(req, companyId);
    const created = await svc.createScratchNote(companyId, requireUserId(req), req.body);
    // The note text is not copied into the activity log; only its size.
    await log(req, companyId, "scratch_note.created", "scratch_note", created.id, { length: created.body.length });
    res.status(201).json(created);
  });

  router.patch("/companies/:companyId/scratch-notes/:noteId", validate(updateScratchNoteSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    authorizeWrite(req, companyId);
    const updated = await svc.updateScratchNote(companyId, req.params.noteId as string, requireUserId(req), req.body);
    await log(req, companyId, "scratch_note.updated", "scratch_note", updated.id, { length: updated.body.length });
    res.json(updated);
  });

  router.post("/companies/:companyId/scratch-notes/:noteId/promote", async (req, res) => {
    const companyId = req.params.companyId as string;
    await authorizeModerate(req, companyId);
    const result = await svc.promoteScratchNote(companyId, req.params.noteId as string);
    // The first promotion also creates the idea column. Log what it created.
    if (result.createdParents.activity) {
      await log(req, companyId, "story_map_activity.created", "story_map_activity", result.createdParents.activity.id, pick(result.createdParents.activity, ["name", "position"]));
    }
    if (result.createdParents.task) {
      await log(req, companyId, "story_map_task.created", "story_map_task", result.createdParents.task.id, pick(result.createdParents.task, ["name", "activityId", "position"]));
    }
    await log(req, companyId, "scratch_note.promoted", "scratch_note", result.note.id, { storyId: result.story.id });
    await log(req, companyId, "story_map_story.created", "story_map_story", result.story.id, pick(result.story, ["title", "taskId", "releaseId", "status", "position"]));
    res.json(result);
  });

  router.post("/companies/:companyId/scratch-notes/:noteId/archive", async (req, res) => {
    const companyId = req.params.companyId as string;
    await authorizeModerate(req, companyId);
    const archived = await svc.archiveScratchNote(companyId, req.params.noteId as string);
    await log(req, companyId, "scratch_note.archived", "scratch_note", archived.id, {});
    res.json(archived);
  });

  router.delete("/companies/:companyId/scratch-notes/:noteId", async (req, res) => {
    const companyId = req.params.companyId as string;
    authorizeWrite(req, companyId);
    const removed = await svc.deleteScratchNote(companyId, req.params.noteId as string, requireUserId(req));
    await log(req, companyId, "scratch_note.deleted", "scratch_note", removed.id, {});
    res.json({ ok: true });
  });

  return router;
}
