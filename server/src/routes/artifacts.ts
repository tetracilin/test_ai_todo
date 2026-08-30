import { Router, type Request, type Response } from "express";
import multer from "multer";
import type { Db } from "@paperclipai/db";
import {
  createArtifactCommentSchema,
  createArtifactSchema,
  createArtifactVersionSchema,
  listExternalStorageObjectsSchema,
  openArtifactSchema,
  restoreArtifactVersionSchema,
  saveMarkdownArtifactSchema,
} from "@paperclipai/shared";
import type { StorageProvider, StorageService } from "../storage/types.js";
import { MAX_ATTACHMENT_BYTES } from "../attachment-types.js";
import { assertCompanyAccess, getAccessibleResource, getActorInfo } from "./authz.js";
import { artifactService, type ArtifactActor } from "../services/artifacts.js";
import { logActivity } from "../services/index.js";

function actorFromRequest(req: Request): ArtifactActor {
  const actor = getActorInfo(req);
  return {
    createdByAgentId: actor.agentId,
    createdByUserId: actor.actorType === "user" ? actor.actorId : null,
  };
}

async function runSingleFileUpload(
  upload: ReturnType<typeof multer>,
  req: Request,
  res: Response,
) {
  await new Promise<void>((resolve, reject) => {
    upload.single("file")(req, res, (err: unknown) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function handleMulterError(err: unknown, res: Response): boolean {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(422).json({ error: `File exceeds ${MAX_ATTACHMENT_BYTES} bytes` });
      return true;
    }
    res.status(400).json({ error: err.message });
    return true;
  }
  return false;
}

export function artifactRoutes(
  db: Db,
  storage: StorageService,
  externalProvider: StorageProvider | null,
) {
  const router = Router();
  const svc = artifactService(db, storage, {
    label: "External storage",
    provider: externalProvider,
  });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 },
  });

  // Storage sources + external object listing (company-level; must precede
  // the :artifactId routes so "external"/"storage-sources" don't bind as ids).
  router.get("/companies/:companyId/artifacts/storage-sources", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json({
      sources: [
        { id: "internal", label: "Internal storage", provider: storage.provider, configured: true },
        {
          id: "external",
          label: "External storage",
          provider: "s3" as const,
          configured: externalProvider !== null,
        },
      ],
    });
  });

  router.get("/companies/:companyId/artifacts/external/objects", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const query = listExternalStorageObjectsSchema.safeParse(req.query ?? {});
    if (!query.success) {
      res.status(400).json({ error: "Invalid query", details: query.error.issues });
      return;
    }
    const objects = await svc.listExternalObjects(companyId, query.data.prefix, query.data.limit);
    res.json({ objects });
  });

  // List artifacts for a task.
  router.get("/companies/:companyId/issues/:issueId/artifacts", async (req, res) => {
    const companyId = req.params.companyId as string;
    const issueId = req.params.issueId as string;
    assertCompanyAccess(req, companyId);
    const artifacts = await svc.listByIssue(companyId, issueId);
    res.json({ artifacts });
  });

  // Upload a new artifact (version 1).
  router.post("/companies/:companyId/issues/:issueId/artifacts", async (req, res) => {
    const companyId = req.params.companyId as string;
    const issueId = req.params.issueId as string;
    assertCompanyAccess(req, companyId);

    try {
      await runSingleFileUpload(upload, req, res);
    } catch (err) {
      if (handleMulterError(err, res)) return;
      throw err;
    }

    const file = (req as Request & { file?: { mimetype: string; buffer: Buffer; originalname: string } }).file;
    if (!file) {
      res.status(400).json({ error: "Missing file field 'file'" });
      return;
    }

    const parsed = createArtifactSchema.safeParse(req.body ?? { issueId });
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid artifact metadata", details: parsed.error.issues });
      return;
    }
    if (parsed.data.issueId !== issueId) {
      res.status(400).json({ error: "issueId in body does not match URL" });
      return;
    }

    const contentType = (file.mimetype || "application/octet-stream").toLowerCase();
    if (file.buffer.length <= 0) {
      res.status(422).json({ error: "File is empty" });
      return;
    }

    const actor = actorFromRequest(req);
    const artifact = await svc.createFromUpload({
      companyId,
      issueId,
      name: file.originalname || "file",
      contentType,
      body: file.buffer,
      versionName: parsed.data.versionName ?? null,
      actor,
    });

    await logActivity(db, {
      companyId,
      actorType: actor.createdByAgentId ? "agent" : "user",
      actorId: actor.createdByAgentId ?? actor.createdByUserId ?? "board",
      agentId: actor.createdByAgentId,
      action: "artifact.created",
      entityType: "artifact",
      entityId: artifact.id,
      issueId,
      details: { kind: artifact.kind, format: artifact.format, name: artifact.name },
    });

    res.status(201).json(artifact);
  });

  // Open an existing object from internal/external storage as a new artifact.
  router.post("/companies/:companyId/issues/:issueId/artifacts/open", async (req, res) => {
    const companyId = req.params.companyId as string;
    const issueId = req.params.issueId as string;
    assertCompanyAccess(req, companyId);

    const parsed = openArtifactSchema.safeParse(req.body ?? { issueId });
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid open request", details: parsed.error.issues });
      return;
    }
    if (parsed.data.issueId !== issueId) {
      res.status(400).json({ error: "issueId in body does not match URL" });
      return;
    }

    const actor = actorFromRequest(req);
    const artifact = await svc.openFromStorage({
      companyId,
      issueId,
      source: parsed.data.source,
      objectKey: parsed.data.objectKey,
      versionName: parsed.data.versionName ?? null,
      actor,
    });

    await logActivity(db, {
      companyId,
      actorType: actor.createdByAgentId ? "agent" : "user",
      actorId: actor.createdByAgentId ?? actor.createdByUserId ?? "board",
      agentId: actor.createdByAgentId,
      action: "artifact.created",
      entityType: "artifact",
      entityId: artifact.id,
      issueId,
      details: { kind: artifact.kind, format: artifact.format, name: artifact.name, source: parsed.data.source },
    });

    res.status(201).json(artifact);
  });

  // Get a single artifact.
  router.get("/companies/:companyId/artifacts/:artifactId", async (req, res) => {
    const companyId = req.params.companyId as string;
    const artifactId = req.params.artifactId as string;
    const artifact = await getAccessibleResource(req, res, svc.get(companyId, artifactId), "Artifact not found");
    if (!artifact) return;
    res.json(artifact);
  });

  // List versions.
  router.get("/companies/:companyId/artifacts/:artifactId/versions", async (req, res) => {
    const companyId = req.params.companyId as string;
    const artifactId = req.params.artifactId as string;
    assertCompanyAccess(req, companyId);
    const result = await svc.listVersions(companyId, artifactId);
    res.json(result);
  });

  // Create a manually named version with new uploaded content. Attachments are
  // upload-only (not editable in-app) but retain this version history.
  router.post("/companies/:companyId/artifacts/:artifactId/versions", async (req, res) => {
    const companyId = req.params.companyId as string;
    const artifactId = req.params.artifactId as string;
    assertCompanyAccess(req, companyId);

    try {
      await runSingleFileUpload(upload, req, res);
    } catch (err) {
      if (handleMulterError(err, res)) return;
      throw err;
    }

    const file = (req as Request & { file?: { mimetype: string; buffer: Buffer; originalname: string } }).file;
    if (!file) {
      res.status(400).json({ error: "Missing file field 'file'" });
      return;
    }

    const parsed = createArtifactVersionSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid version metadata", details: parsed.error.issues });
      return;
    }

    const actor = actorFromRequest(req);
    const version = await svc.createVersion({
      companyId,
      artifactId,
      versionName: parsed.data.versionName,
      contentType: (file.mimetype || "application/octet-stream").toLowerCase(),
      body: file.buffer,
      changeSummary: parsed.data.changeSummary ?? null,
      actor,
    });

    await logActivity(db, {
      companyId,
      actorType: actor.createdByAgentId ? "agent" : "user",
      actorId: actor.createdByAgentId ?? actor.createdByUserId ?? "board",
      agentId: actor.createdByAgentId,
      action: "artifact.version.created",
      entityType: "artifact",
      entityId: artifactId,
      details: { versionNumber: version.versionNumber, versionName: version.versionName },
    });

    res.status(201).json(version);
  });

  // Save markdown content — always creates a new auto-version.
  router.put("/companies/:companyId/artifacts/:artifactId/markdown", async (req, res) => {
    const companyId = req.params.companyId as string;
    const artifactId = req.params.artifactId as string;
    assertCompanyAccess(req, companyId);

    const parsed = saveMarkdownArtifactSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid markdown body", details: parsed.error.issues });
      return;
    }

    const actor = actorFromRequest(req);
    const version = await svc.saveMarkdown({
      companyId,
      artifactId,
      body: parsed.data.body,
      changeSummary: parsed.data.changeSummary ?? null,
      actor,
    });

    await logActivity(db, {
      companyId,
      actorType: actor.createdByAgentId ? "agent" : "user",
      actorId: actor.createdByAgentId ?? actor.createdByUserId ?? "board",
      agentId: actor.createdByAgentId,
      action: "artifact.version.created",
      entityType: "artifact",
      entityId: artifactId,
      details: { versionNumber: version.versionNumber, versionName: version.versionName, automatic: true },
    });

    res.status(201).json(version);
  });

  // Restore a prior version (creates a new version with that content).
  router.post("/companies/:companyId/artifacts/:artifactId/versions/:versionId/restore", async (req, res) => {
    const companyId = req.params.companyId as string;
    const artifactId = req.params.artifactId as string;
    const versionId = req.params.versionId as string;
    assertCompanyAccess(req, companyId);

    const parsed = restoreArtifactVersionSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid restore request", details: parsed.error.issues });
      return;
    }

    const actor = actorFromRequest(req);
    const version = await svc.restoreVersion({
      companyId,
      artifactId,
      versionId,
      versionName: parsed.data.versionName ?? null,
      actor,
    });

    await logActivity(db, {
      companyId,
      actorType: actor.createdByAgentId ? "agent" : "user",
      actorId: actor.createdByAgentId ?? actor.createdByUserId ?? "board",
      agentId: actor.createdByAgentId,
      action: "artifact.version.restored",
      entityType: "artifact",
      entityId: artifactId,
      details: { versionNumber: version.versionNumber, versionName: version.versionName },
    });

    res.status(201).json(version);
  });

  // Comments on document artifacts.
  router.get("/companies/:companyId/artifacts/:artifactId/comments", async (req, res) => {
    const companyId = req.params.companyId as string;
    const artifactId = req.params.artifactId as string;
    assertCompanyAccess(req, companyId);
    const result = await svc.listComments(companyId, artifactId);
    res.json(result);
  });

  router.post("/companies/:companyId/artifacts/:artifactId/comments", async (req, res) => {
    const companyId = req.params.companyId as string;
    const artifactId = req.params.artifactId as string;
    assertCompanyAccess(req, companyId);

    const parsed = createArtifactCommentSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid comment", details: parsed.error.issues });
      return;
    }

    const actor = actorFromRequest(req);
    const comment = await svc.addComment({
      companyId,
      artifactId,
      body: parsed.data.body,
      actor,
    });

    await logActivity(db, {
      companyId,
      actorType: actor.createdByAgentId ? "agent" : "user",
      actorId: actor.createdByAgentId ?? actor.createdByUserId ?? "board",
      agentId: actor.createdByAgentId,
      action: "artifact.comment.created",
      entityType: "artifact",
      entityId: artifactId,
    });

    res.status(201).json(comment);
  });

  // Download current or specific version content.
  router.get("/companies/:companyId/artifacts/:artifactId/content", async (req, res, next) => {
    const companyId = req.params.companyId as string;
    const artifactId = req.params.artifactId as string;
    assertCompanyAccess(req, companyId);

    const { artifact, version, object } = await svc.getVersionStream(companyId, artifactId);
    const contentType = version.contentType || object.contentType || "application/octet-stream";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", String(version.byteSize || object.contentLength || 0));
    res.setHeader("Cache-Control", "private, max-age=60");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const filename = artifact.name.replaceAll("\"", "");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    object.stream.on("error", (err) => next(err));
    object.stream.pipe(res);
  });

  router.get("/companies/:companyId/artifacts/:artifactId/versions/:versionId/content", async (req, res, next) => {
    const companyId = req.params.companyId as string;
    const artifactId = req.params.artifactId as string;
    const versionId = req.params.versionId as string;
    assertCompanyAccess(req, companyId);

    const { artifact, version, object } = await svc.getVersionStream(companyId, artifactId, versionId);
    const contentType = version.contentType || object.contentType || "application/octet-stream";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", String(version.byteSize || object.contentLength || 0));
    res.setHeader("Cache-Control", "private, max-age=60");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const filename = artifact.name.replaceAll("\"", "");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    object.stream.on("error", (err) => next(err));
    object.stream.pipe(res);
  });

  return router;
}
