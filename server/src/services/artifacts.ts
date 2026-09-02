import { buffer } from "node:stream/consumers";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { artifactComments, artifacts, artifactVersions, companies, issues } from "@paperclipai/db";
import {
  ARTIFACT_VERSION_NAME_MAX_LENGTH,
  classifyArtifactFormat,
  type Artifact,
  type ArtifactComment,
  type ArtifactVersionSummary,
  type ArtifactWithCurrentVersion,
} from "@paperclipai/shared";
import { conflict, forbidden, notFound, unprocessable } from "../errors.js";
import type { StorageService } from "../storage/types.js";

export interface ArtifactActor {
  createdByUserId: string | null;
  createdByAgentId: string | null;
}

export interface ArtifactExternalSource {
  label: string;
  storage: StorageService | null;
}

interface ArtifactRow {
  id: string;
  companyId: string;
  issueId: string;
  kind: string;
  format: string | null;
  name: string;
  contentType: string;
  currentVersionId: string | null;
  currentVersionNumber: number;
  createdByUserId: string | null;
  createdByAgentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface VersionRow {
  id: string;
  companyId: string;
  artifactId: string;
  versionNumber: number;
  versionName: string | null;
  source: string;
  provider: string;
  objectKey: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  changeSummary: string | null;
  isAutomatic: boolean;
  createdByUserId: string | null;
  createdByAgentId: string | null;
  createdAt: Date;
}

function mapArtifact(row: ArtifactRow): Artifact {
  return {
    id: row.id,
    companyId: row.companyId,
    issueId: row.issueId,
    kind: row.kind as Artifact["kind"],
    format: row.format as Artifact["format"],
    name: row.name,
    contentType: row.contentType,
    currentVersionId: row.currentVersionId,
    currentVersionNumber: row.currentVersionNumber,
    createdByUserId: row.createdByUserId,
    createdByAgentId: row.createdByAgentId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    contentPath: `/api/artifacts/${row.id}/content`,
  };
}

function mapVersion(row: VersionRow): ArtifactVersionSummary {
  return {
    id: row.id,
    artifactId: row.artifactId,
    versionNumber: row.versionNumber,
    versionName: row.versionName,
    source: row.source as ArtifactVersionSummary["source"],
    provider: row.provider as ArtifactVersionSummary["provider"],
    contentType: row.contentType,
    byteSize: row.byteSize,
    changeSummary: row.changeSummary,
    isAutomatic: row.isAutomatic,
    createdByUserId: row.createdByUserId,
    createdByAgentId: row.createdByAgentId,
    createdAt: row.createdAt.toISOString(),
  };
}

function mapComment(row: typeof artifactComments.$inferSelect): ArtifactComment {
  return {
    id: row.id,
    artifactId: row.artifactId,
    body: row.body,
    authorUserId: row.authorUserId,
    authorAgentId: row.authorAgentId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function sha256Of(input: Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

function defaultVersionName(versionNumber: number, isAutomatic: boolean): string {
  return isAutomatic ? `Revision ${versionNumber}` : `v${versionNumber}`;
}

function requireManualVersionName(value: string): string {
  const versionName = value.trim();
  if (!versionName || versionName.length > ARTIFACT_VERSION_NAME_MAX_LENGTH) {
    throw unprocessable("A non-empty version name is required for manual artifact versions");
  }
  return versionName;
}

function assertExternalObjectBelongsToCompany(companyId: string, objectKey: string): void {
  const normalized = objectKey.replace(/\\/g, "/").trim();
  if (!normalized.startsWith(`${companyId}/`) || normalized.split("/").some((part) => part === "..")) {
    throw forbidden("External object does not belong to company");
  }
}

const artifactSelect = {
  id: artifacts.id,
  companyId: artifacts.companyId,
  issueId: artifacts.issueId,
  kind: artifacts.kind,
  format: artifacts.format,
  name: artifacts.name,
  contentType: artifacts.contentType,
  currentVersionId: artifacts.currentVersionId,
  currentVersionNumber: artifacts.currentVersionNumber,
  createdByUserId: artifacts.createdByUserId,
  createdByAgentId: artifacts.createdByAgentId,
  createdAt: artifacts.createdAt,
  updatedAt: artifacts.updatedAt,
};

const versionSelect = {
  id: artifactVersions.id,
  companyId: artifactVersions.companyId,
  artifactId: artifactVersions.artifactId,
  versionNumber: artifactVersions.versionNumber,
  versionName: artifactVersions.versionName,
  source: artifactVersions.source,
  provider: artifactVersions.provider,
  objectKey: artifactVersions.objectKey,
  contentType: artifactVersions.contentType,
  byteSize: artifactVersions.byteSize,
  sha256: artifactVersions.sha256,
  changeSummary: artifactVersions.changeSummary,
  isAutomatic: artifactVersions.isAutomatic,
  createdByUserId: artifactVersions.createdByUserId,
  createdByAgentId: artifactVersions.createdByAgentId,
  createdAt: artifactVersions.createdAt,
};

export function artifactService(
  db: Db,
  storage: StorageService,
  external: ArtifactExternalSource | null,
) {
  async function requireIssue(companyId: string, issueId: string) {
    const issue = await db
      .select({ id: issues.id, companyId: issues.companyId })
      .from(issues)
      .where(and(eq(issues.id, issueId), eq(issues.companyId, companyId)))
      .then((rows) => rows[0] ?? null);
    if (!issue) throw notFound("Issue not found");
    return issue;
  }

  async function getArtifact(companyId: string, artifactId: string): Promise<ArtifactRow> {
    const row = await db
      .select(artifactSelect)
      .from(artifacts)
      .where(and(eq(artifacts.id, artifactId), eq(artifacts.companyId, companyId)))
      .then((rows) => rows[0] ?? null);
    if (!row) throw notFound("Artifact not found");
    return row as ArtifactRow;
  }

  async function getVersion(companyId: string, artifactId: string, versionId: string): Promise<VersionRow> {
    const row = await db
      .select(versionSelect)
      .from(artifactVersions)
      .where(
        and(
          eq(artifactVersions.id, versionId),
          eq(artifactVersions.artifactId, artifactId),
          eq(artifactVersions.companyId, companyId),
        ),
      )
      .then((rows) => rows[0] ?? null);
    if (!row) throw notFound("Artifact version not found");
    return row as VersionRow;
  }

  async function storageForCompany(companyId: string): Promise<{
    storage: StorageService;
    source: "internal" | "external";
  }> {
    const company = await db
      .select({ artifactStorage: companies.artifactStorage })
      .from(companies)
      .where(eq(companies.id, companyId))
      .then((rows) => rows[0] ?? null);
    if (!company) throw notFound("Company not found");
    if (company.artifactStorage === "nas_minio") {
      if (!external?.storage) throw unprocessable("NAS MinIO artifact storage is not configured");
      return { storage: external.storage, source: "external" };
    }
    return { storage, source: "internal" };
  }

  function storageForVersion(source: string): StorageService {
    if (source === "external") {
      if (!external?.storage) throw unprocessable("NAS MinIO artifact storage is not configured");
      return external.storage;
    }
    return storage;
  }

  async function storeObject(
    companyId: string,
    name: string,
    contentType: string,
    body: Buffer,
  ) {
    const target = await storageForCompany(companyId);
    const stored = await target.storage.putFile({
      companyId,
      namespace: "artifacts",
      originalFilename: name,
      contentType,
      body,
    });
    return { ...stored, source: target.source };
  }

  /**
   * Insert a new artifact plus its initial version in one transaction, then
   * point the artifact at that version. Shared by upload and open-from-storage.
   */
  async function insertArtifactWithFirstVersion(input: {
    companyId: string;
    issueId: string;
    name: string;
    contentType: string;
    format: ReturnType<typeof classifyArtifactFormat>;
    versionName: string | null;
    source: "internal" | "external";
    provider: string;
    objectKey: string;
    byteSize: number;
    sha256: string;
    changeSummary: string | null;
    actor: ArtifactActor;
  }) {
    const kind = input.format ? "document" : "attachment";
    const now = new Date();
    return db.transaction(async (tx) => {
      const [artifact] = await tx
        .insert(artifacts)
        .values({
          companyId: input.companyId,
          issueId: input.issueId,
          kind,
          format: input.format,
          name: input.name,
          contentType: input.contentType,
          currentVersionId: null,
          currentVersionNumber: 1,
          createdByUserId: input.actor.createdByUserId,
          createdByAgentId: input.actor.createdByAgentId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      const [version] = await tx
        .insert(artifactVersions)
        .values({
          companyId: input.companyId,
          artifactId: artifact.id,
          versionNumber: 1,
          versionName: input.versionName ?? defaultVersionName(1, false),
          source: input.source,
          provider: input.provider,
          objectKey: input.objectKey,
          contentType: input.contentType,
          byteSize: input.byteSize,
          sha256: input.sha256,
          changeSummary: input.changeSummary,
          isAutomatic: false,
          createdByUserId: input.actor.createdByUserId,
          createdByAgentId: input.actor.createdByAgentId,
          createdAt: now,
        })
        .returning();

      await tx.update(artifacts).set({ currentVersionId: version.id }).where(eq(artifacts.id, artifact.id));

      return { artifact: { ...artifact, currentVersionId: version.id } as ArtifactRow, version: version as VersionRow };
    });
  }

  return {
    listByIssue: async (companyId: string, issueId: string): Promise<ArtifactWithCurrentVersion[]> => {
      const rows = await db
        .select(artifactSelect)
        .from(artifacts)
        .where(and(eq(artifacts.companyId, companyId), eq(artifacts.issueId, issueId)))
        .orderBy(desc(artifacts.updatedAt));
      const currentVersionIds = rows.map((row) => row.currentVersionId).filter((id): id is string => Boolean(id));
      const versionRows = currentVersionIds.length
        ? await db
            .select(versionSelect)
            .from(artifactVersions)
            .where(inArray(artifactVersions.id, currentVersionIds))
        : [];
      const versionById = new Map(versionRows.map((v) => [v.id, v]));
      return rows.map((row) => {
        const current = row.currentVersionId ? versionById.get(row.currentVersionId) ?? null : null;
        return {
          ...mapArtifact(row as ArtifactRow),
          currentVersion: current ? mapVersion(current as VersionRow) : null,
        };
      });
    },

    get: async (companyId: string, artifactId: string): Promise<ArtifactWithCurrentVersion> => {
      const artifact = await getArtifact(companyId, artifactId);
      const current = artifact.currentVersionId
        ? await getVersion(companyId, artifactId, artifact.currentVersionId)
        : null;
      return {
        ...mapArtifact(artifact),
        currentVersion: current ? mapVersion(current) : null,
      };
    },

    listVersions: async (companyId: string, artifactId: string) => {
      const artifact = await getArtifact(companyId, artifactId);
      const versions = await db
        .select(versionSelect)
        .from(artifactVersions)
        .where(and(eq(artifactVersions.companyId, companyId), eq(artifactVersions.artifactId, artifactId)))
        .orderBy(desc(artifactVersions.versionNumber));
      return {
        artifact: mapArtifact(artifact),
        versions: versions.map((v) => mapVersion(v as VersionRow)),
      };
    },

    createFromUpload: async (input: {
      companyId: string;
      issueId: string;
      name: string;
      contentType: string;
      body: Buffer;
      versionName: string | null;
      actor: ArtifactActor;
    }) => {
      await requireIssue(input.companyId, input.issueId);
      const format = classifyArtifactFormat({ contentType: input.contentType, filename: input.name });
      const stored = await storeObject(input.companyId, input.name, input.contentType, input.body);
      const result = await insertArtifactWithFirstVersion({
        companyId: input.companyId,
        issueId: input.issueId,
        name: input.name,
        contentType: stored.contentType,
        format,
        versionName: input.versionName,
        source: stored.source,
        provider: stored.provider,
        objectKey: stored.objectKey,
        byteSize: stored.byteSize,
        sha256: stored.sha256,
        changeSummary: null,
        actor: input.actor,
      });
      return {
        ...mapArtifact(result.artifact),
        currentVersion: mapVersion(result.version),
      };
    },

    openFromStorage: async (input: {
      companyId: string;
      issueId: string;
      source: "internal" | "external";
      objectKey: string;
      versionName: string | null;
      actor: ArtifactActor;
    }) => {
      await requireIssue(input.companyId, input.issueId);
      let contentType = "application/octet-stream";
      let body: Buffer;

      if (input.source === "external") {
        if (!external?.storage) throw unprocessable("External storage is not configured");
        assertExternalObjectBelongsToCompany(input.companyId, input.objectKey);
        const object = await external.storage.getObject(input.companyId, input.objectKey);
        body = Buffer.from(await buffer(object.stream));
        contentType = object.contentType ?? "application/octet-stream";
      } else {
        const object = await storage.getObject(input.companyId, input.objectKey);
        body = Buffer.from(await buffer(object.stream));
        contentType = object.contentType ?? "application/octet-stream";
      }

      if (body.length <= 0) throw unprocessable("File is empty");

      const name = input.objectKey.split("/").pop() ?? "file";
      const format = classifyArtifactFormat({ contentType, filename: name });
      const stored = await storeObject(input.companyId, name, contentType, body);
      const result = await insertArtifactWithFirstVersion({
        companyId: input.companyId,
        issueId: input.issueId,
        name,
        contentType: stored.contentType,
        format,
        versionName: input.versionName,
        source: stored.source,
        provider: stored.provider,
        objectKey: stored.objectKey,
        byteSize: stored.byteSize,
        sha256: stored.sha256,
        changeSummary: null,
        actor: input.actor,
      });
      return {
        ...mapArtifact(result.artifact),
        currentVersion: mapVersion(result.version),
      };
    },

    createVersion: async (input: {
      companyId: string;
      artifactId: string;
      versionName: string;
      contentType: string;
      body: Buffer;
      changeSummary: string | null;
      actor: ArtifactActor;
    }) => {
      const artifact = await getArtifact(input.companyId, input.artifactId);
      if (artifact.format === "markdown") {
        throw conflict("Use the markdown save endpoint to auto-version markdown artifacts");
      }
      // Attachment artifacts are not editable in-app, but replacing their
      // uploaded bytes must still preserve a named version history. Editable
      // binary documents are constrained to their original document format.
      const incomingFormat = classifyArtifactFormat({
        contentType: input.contentType,
        filename: artifact.name,
      });
      if (artifact.format && incomingFormat !== artifact.format) {
        throw unprocessable("Uploaded version format does not match artifact format");
      }
      const stored = await storeObject(input.companyId, artifact.name, input.contentType, input.body);
      const now = new Date();
      return db.transaction(async (tx) => {
        const nextNumber = artifact.currentVersionNumber + 1;
        const [version] = await tx
          .insert(artifactVersions)
          .values({
            companyId: input.companyId,
            artifactId: artifact.id,
            versionNumber: nextNumber,
            versionName: input.versionName,
            source: stored.source,
            provider: stored.provider,
            objectKey: stored.objectKey,
            contentType: stored.contentType,
            byteSize: stored.byteSize,
            sha256: stored.sha256,
            changeSummary: input.changeSummary,
            isAutomatic: false,
            createdByUserId: input.actor.createdByUserId,
            createdByAgentId: input.actor.createdByAgentId,
            createdAt: now,
          })
          .returning();
        await tx
          .update(artifacts)
          .set({
            contentType: stored.contentType,
            currentVersionId: version.id,
            currentVersionNumber: nextNumber,
            updatedAt: now,
          })
          .where(eq(artifacts.id, artifact.id));
        return mapVersion(version as VersionRow);
      });
    },

    createWopiVersion: async (input: {
      companyId: string;
      artifactId: string;
      expectedVersionId: string;
      versionName: string;
      contentType: string;
      body: Buffer;
      actor: ArtifactActor;
    }) => {
      const versionName = requireManualVersionName(input.versionName);
      const artifact = await getArtifact(input.companyId, input.artifactId);
      if ((artifact.format !== "docx" && artifact.format !== "xlsx") || artifact.currentVersionId !== input.expectedVersionId) {
        throw conflict("Artifact version changed before editor save");
      }
      const stored = await storeObject(input.companyId, artifact.name, input.contentType, input.body);
      const now = new Date();
      return db.transaction(async (tx) => {
        const nextNumber = artifact.currentVersionNumber + 1;
        const [version] = await tx
          .insert(artifactVersions)
          .values({
            companyId: input.companyId,
            artifactId: artifact.id,
            versionNumber: nextNumber,
            versionName,
            source: stored.source,
            provider: stored.provider,
            objectKey: stored.objectKey,
            contentType: stored.contentType,
            byteSize: stored.byteSize,
            sha256: stored.sha256,
            changeSummary: "Saved from Collabora Online",
            isAutomatic: false,
            createdByUserId: input.actor.createdByUserId,
            createdByAgentId: input.actor.createdByAgentId,
            createdAt: now,
          })
          .returning();
        const updated = await tx
          .update(artifacts)
          .set({
            contentType: stored.contentType,
            currentVersionId: version.id,
            currentVersionNumber: nextNumber,
            updatedAt: now,
          })
          .where(and(eq(artifacts.id, artifact.id), eq(artifacts.currentVersionId, input.expectedVersionId)))
          .returning({ id: artifacts.id });
        if (updated.length !== 1) {
          throw conflict("Artifact version changed before editor save");
        }
        return mapVersion(version as VersionRow);
      });
    },

    saveMarkdown: async (input: {
      companyId: string;
      artifactId: string;
      body: string;
      changeSummary: string | null;
      actor: ArtifactActor;
    }) => {
      const artifact = await getArtifact(input.companyId, input.artifactId);
      if (artifact.format !== "markdown") {
        throw unprocessable("Markdown save is only available for markdown artifacts");
      }
      const content = Buffer.from(input.body, "utf8");
      const stored = await storeObject(input.companyId, artifact.name, "text/markdown", content);
      const now = new Date();
      return db.transaction(async (tx) => {
        const nextNumber = artifact.currentVersionNumber + 1;
        const [version] = await tx
          .insert(artifactVersions)
          .values({
            companyId: input.companyId,
            artifactId: artifact.id,
            versionNumber: nextNumber,
            versionName: defaultVersionName(nextNumber, true),
            source: stored.source,
            provider: stored.provider,
            objectKey: stored.objectKey,
            contentType: stored.contentType,
            byteSize: stored.byteSize,
            sha256: stored.sha256,
            changeSummary: input.changeSummary,
            isAutomatic: true,
            createdByUserId: input.actor.createdByUserId,
            createdByAgentId: input.actor.createdByAgentId,
            createdAt: now,
          })
          .returning();
        await tx
          .update(artifacts)
          .set({
            currentVersionId: version.id,
            currentVersionNumber: nextNumber,
            updatedAt: now,
          })
          .where(eq(artifacts.id, artifact.id));
        return mapVersion(version as VersionRow);
      });
    },

    restoreVersion: async (input: {
      companyId: string;
      artifactId: string;
      versionId: string;
      versionName: string | null;
      actor: ArtifactActor;
    }) => {
      const artifact = await getArtifact(input.companyId, input.artifactId);
      const target = await getVersion(input.companyId, input.artifactId, input.versionId);
      if (artifact.currentVersionId === target.id) {
        throw conflict("Selected version is already the latest version");
      }
      const object = await storageForVersion(target.source).getObject(input.companyId, target.objectKey);
      const body = Buffer.from(await buffer(object.stream));
      const stored = await storeObject(
        input.companyId,
        artifact.name,
        target.contentType,
        body,
      );
      const now = new Date();
      return db.transaction(async (tx) => {
        const nextNumber = artifact.currentVersionNumber + 1;
        const versionName = input.versionName ?? `Restored from v${target.versionNumber}`;
        const [version] = await tx
          .insert(artifactVersions)
          .values({
            companyId: input.companyId,
            artifactId: artifact.id,
            versionNumber: nextNumber,
            versionName,
            source: stored.source,
            provider: stored.provider,
            objectKey: stored.objectKey,
            contentType: stored.contentType,
            byteSize: stored.byteSize,
            sha256: sha256Of(body),
            changeSummary: `Restored from v${target.versionNumber}`,
            isAutomatic: false,
            createdByUserId: input.actor.createdByUserId,
            createdByAgentId: input.actor.createdByAgentId,
            createdAt: now,
          })
          .returning();
        await tx
          .update(artifacts)
          .set({
            currentVersionId: version.id,
            currentVersionNumber: nextNumber,
            updatedAt: now,
          })
          .where(eq(artifacts.id, artifact.id));
        return mapVersion(version as VersionRow);
      });
    },

    getVersionStream: async (companyId: string, artifactId: string, versionId?: string) => {
      const artifact = await getArtifact(companyId, artifactId);
      const targetVersionId = versionId ?? artifact.currentVersionId;
      if (!targetVersionId) throw notFound("Artifact has no content");
      const version = await getVersion(companyId, artifactId, targetVersionId);
      const object = await storageForVersion(version.source).getObject(companyId, version.objectKey);
      return { artifact: mapArtifact(artifact), version: mapVersion(version), object };
    },

    addComment: async (input: {
      companyId: string;
      artifactId: string;
      body: string;
      actor: ArtifactActor;
    }) => {
      const artifact = await getArtifact(input.companyId, input.artifactId);
      if (artifact.kind !== "document") {
        throw unprocessable("Only document artifacts support comments");
      }
      const now = new Date();
      const [comment] = await db
        .insert(artifactComments)
        .values({
          companyId: input.companyId,
          artifactId: artifact.id,
          body: input.body,
          authorUserId: input.actor.createdByUserId,
          authorAgentId: input.actor.createdByAgentId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return mapComment(comment);
    },

    listComments: async (companyId: string, artifactId: string) => {
      const artifact = await getArtifact(companyId, artifactId);
      const comments = await db
        .select()
        .from(artifactComments)
        .where(and(eq(artifactComments.companyId, companyId), eq(artifactComments.artifactId, artifactId)))
        .orderBy(asc(artifactComments.createdAt));
      return {
        artifact: mapArtifact(artifact),
        comments: comments.map((c) => mapComment(c)),
      };
    },

    listExternalObjects: async (companyId: string, prefix?: string, limit?: number) => {
      if (!external?.storage) throw unprocessable("External storage is not configured");
      const companyPrefix = `${companyId}/`;
      const requestedPrefix = prefix?.replace(/\\/g, "/").trim() || companyPrefix;
      assertExternalObjectBelongsToCompany(companyId, requestedPrefix);
      const result = await external.storage.listObjects({ prefix: requestedPrefix, limit });
      return result.objects
        .filter((o) => !o.key.endsWith("/"))
        .map((o) => ({
          key: o.key,
          name: o.key.split("/").pop() ?? o.key,
          byteSize: o.size,
          lastModified: o.lastModified?.toISOString() ?? null,
          contentType: null,
        }));
    },
  };
}
