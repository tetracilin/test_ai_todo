import { Router, type Request, type Response } from "express";
import { buffer } from "node:stream/consumers";
import type { Db } from "@paperclipai/db";
import { createArtifactEditorSessionSchema } from "@paperclipai/shared";
import type { StorageService } from "../storage/types.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { artifactService, type ArtifactActor } from "../services/artifacts.js";
import {
  WOPI_STAGING_CALLBACK_ORIGIN,
  type WopiSession,
  type WopiSessionStore,
  wopiEditorSessionPayload,
} from "../services/wopi.js";
import { logActivity } from "../services/index.js";

const WOPI_LOCK = "X-WOPI-Lock";
const WOPI_OLD_LOCK = "X-WOPI-OldLock";
const WOPI_OVERRIDE = "X-WOPI-Override";
const WOPI_LOCK_FAILURE_REASON = "X-WOPI-LockFailureReason";
const LOCK_TTL_SECONDS = 30 * 60;

function actorFromRequest(req: Request): ArtifactActor {
  const actor = getActorInfo(req);
  return { createdByAgentId: actor.agentId, createdByUserId: actor.actorType === "user" ? actor.actorId : null };
}

function requestToken(req: Request): string | null {
  const token = req.query.access_token;
  return typeof token === "string" ? token : null;
}

function lockHeader(req: Request, name: string): string | null {
  const value = req.header(name)?.trim();
  return value ? value : null;
}

function sendUnauthorized(res: Response) {
  res.status(401).set("WWW-Authenticate", "Bearer").end();
}

function sendLockConflict(res: Response, current: string | null, reason: string) {
  if (current) res.set(WOPI_LOCK, current);
  res.status(409).set(WOPI_LOCK_FAILURE_REASON, reason).end();
}

function isDocxOrXlsx(artifact: { kind: string; format: unknown }): artifact is { kind: "document"; format: "docx" | "xlsx" } {
  return artifact.kind === "document" && (artifact.format === "docx" || artifact.format === "xlsx");
}

function sessionForRequest(store: WopiSessionStore, req: Request, res: Response): WopiSession | null {
  const session = store.get(requestToken(req), req.params.artifactId as string);
  if (!session) {
    sendUnauthorized(res);
    return null;
  }
  return session;
}

export function wopiRoutes(
  db: Db,
  storage: StorageService,
  sessions: WopiSessionStore,
  externalStorage: StorageService | null = null,
) {
  const router = Router();
  const artifacts = artifactService(db, storage, { label: "External storage", storage: externalStorage });

  router.post("/companies/:companyId/artifacts/:artifactId/editor-sessions", async (req, res) => {
    const companyId = req.params.companyId as string;
    const artifactId = req.params.artifactId as string;
    assertCompanyAccess(req, companyId);
    const actorInfo = getActorInfo(req);
    if (actorInfo.actorType !== "user") {
      res.status(403).json({ error: "Only signed-in users may create editor sessions" });
      return;
    }
    const parsed = createArtifactEditorSessionSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "A non-empty version name is required for DOCX/XLSX saves", details: parsed.error.issues });
      return;
    }
    const artifact = await artifacts.get(companyId, artifactId);
    if (!isDocxOrXlsx(artifact) || !artifact.currentVersionId) {
      res.status(422).json({ error: "Only DOCX and XLSX document artifacts can be edited" });
      return;
    }
    const session = sessions.create({
      companyId,
      artifactId,
      versionId: artifact.currentVersionId,
      versionName: parsed.data.versionName,
      format: artifact.format,
      actor: actorFromRequest(req),
    });
    const callback = `${WOPI_STAGING_CALLBACK_ORIGIN}/api/wopi/files/${encodeURIComponent(artifactId)}`;
    res.status(201).json(wopiEditorSessionPayload({
      format: artifact.format,
      callbackUrl: callback,
      token: session.token,
      expiresAt: session.expiresAt,
    }));
  });

  router.get("/wopi/files/:artifactId", async (req, res) => {
    const session = sessionForRequest(sessions, req, res);
    if (!session) return;
    const artifact = await artifacts.get(session.companyId, session.artifactId);
    if (!isDocxOrXlsx(artifact) || artifact.currentVersionId !== session.versionId) {
      res.status(409).set("X-WOPI-ItemVersion", artifact.currentVersionNumber.toString()).end();
      return;
    }
    res.json({
      BaseFileName: artifact.name,
      OwnerId: session.companyId,
      Size: artifact.currentVersion?.byteSize ?? 0,
      Version: String(artifact.currentVersionNumber),
      UserId: session.actor.createdByUserId ?? "user",
      UserFriendlyName: "Paperclip user",
      UserCanWrite: true,
      SupportsLocks: true,
      SupportsGetLock: true,
      SupportsUpdate: true,
      SupportsRename: false,
      LastModifiedTime: artifact.updatedAt,
    });
  });

  router.get("/wopi/files/:artifactId/contents", async (req, res) => {
    const session = sessionForRequest(sessions, req, res);
    if (!session) return;
    const artifact = await artifacts.get(session.companyId, session.artifactId);
    if (artifact.currentVersionId !== session.versionId) {
      res.status(409).set("X-WOPI-ItemVersion", artifact.currentVersionNumber.toString()).end();
      return;
    }
    const file = await artifacts.getVersionStream(session.companyId, session.artifactId, session.versionId);
    res.set("Content-Type", file.version.contentType);
    res.set("Content-Length", String(file.version.byteSize));
    res.set("Cache-Control", "no-store");
    file.object.stream.pipe(res);
  });

  router.post("/wopi/files/:artifactId/contents", async (req, res) => {
    const session = sessionForRequest(sessions, req, res);
    if (!session) return;
    const override = lockHeader(req, WOPI_OVERRIDE)?.toUpperCase();
    if (override !== "PUT") {
      res.status(501).end();
      return;
    }
    const lock = lockHeader(req, WOPI_LOCK);
    const currentLock = sessions.getLock(session);
    if (!lock || currentLock !== lock) {
      sendLockConflict(res, currentLock, "Lock mismatch");
      return;
    }
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(await buffer(req));
    if (body.length === 0) {
      res.status(400).end();
      return;
    }
    const artifact = await artifacts.get(session.companyId, session.artifactId);
    if (artifact.currentVersionId !== session.versionId) {
      sendLockConflict(res, currentLock, "Artifact version changed");
      return;
    }
    const version = await artifacts.createWopiVersion({
      companyId: session.companyId,
      artifactId: session.artifactId,
      expectedVersionId: session.versionId,
      versionName: session.versionName,
      contentType: artifact.contentType,
      body,
      actor: session.actor,
    });
    await logActivity(db, {
      companyId: session.companyId,
      actorType: "user",
      actorId: session.actor.createdByUserId ?? "board",
      action: "artifact.wopi.version.created",
      entityType: "artifact",
      entityId: session.artifactId,
      details: { versionNumber: version.versionNumber, versionName: version.versionName, editor: "collabora" },
    });
    res.set("X-WOPI-ItemVersion", String(version.versionNumber)).status(200).end();
  });

  router.post("/wopi/files/:artifactId", async (req, res) => {
    const session = sessionForRequest(sessions, req, res);
    if (!session) return;
    const override = lockHeader(req, WOPI_OVERRIDE)?.toUpperCase();
    const lock = lockHeader(req, WOPI_LOCK);
    if (!override) {
      res.status(400).end();
      return;
    }
    if (override === "GET_LOCK") {
      const current = sessions.getLock(session);
      if (current) res.set(WOPI_LOCK, current);
      res.status(200).end();
      return;
    }
    if (override === "LOCK" || override === "REFRESH_LOCK") {
      if (!lock) {
        sendLockConflict(res, sessions.getLock(session), "Missing lock");
        return;
      }
      const result = sessions.lock(session, lock, LOCK_TTL_SECONDS);
      if (!result.ok) {
        sendLockConflict(res, result.current, "Lock mismatch");
        return;
      }
      res.status(200).end();
      return;
    }
    if (override === "UNLOCK") {
      if (!lock) {
        sendLockConflict(res, sessions.getLock(session), "Missing lock");
        return;
      }
      const result = sessions.unlock(session, lock);
      if (!result.ok) {
        sendLockConflict(res, result.current, "Lock mismatch");
        return;
      }
      res.status(200).end();
      return;
    }
    if (override === "UNLOCK_AND_RELOCK") {
      const oldLock = lockHeader(req, WOPI_OLD_LOCK);
      if (!oldLock || !lock) {
        sendLockConflict(res, sessions.getLock(session), "Missing lock");
        return;
      }
      const result = sessions.relock(session, oldLock, lock, LOCK_TTL_SECONDS);
      if (!result.ok) {
        sendLockConflict(res, result.current, "Lock mismatch");
        return;
      }
      res.status(200).end();
      return;
    }
    res.status(501).end();
  });

  return router;
}
