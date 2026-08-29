import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  artifactComments,
  artifacts,
  artifactVersions,
  companies,
  createDb,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { artifactService } from "../services/artifacts.js";
import { createStorageService } from "../storage/service.js";
import { createLocalDiskStorageProvider } from "../storage/local-disk-provider.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres artifact service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("artifact service", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let storageDir: string;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-artifact-service-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    await db.delete(artifactComments);
    await db.delete(artifactVersions);
    await db.delete(artifacts);
    await db.delete(issues);
    await db.delete(companies);
    if (storageDir) {
      await fs.rm(storageDir, { recursive: true, force: true });
    }
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function setupCompanyIssue() {
    const companyId = randomUUID();
    const issueId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Test Co" });
    await db.insert(issues).values({ id: issueId, companyId, title: "A task" });
    return { companyId, issueId };
  }

  async function makeService() {
    storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "artifact-storage-"));
    const storage = createStorageService(createLocalDiskStorageProvider(storageDir));
    const svc = artifactService(db, storage, null);
    return { storage, svc };
  }

  const actor = { createdByUserId: "user-1", createdByAgentId: null };

  it("classifies markdown uploads as editable documents with an initial version", async () => {
    const { companyId, issueId } = await setupCompanyIssue();
    const { svc } = await makeService();

    const artifact = await svc.createFromUpload({
      companyId,
      issueId,
      name: "notes.md",
      contentType: "text/markdown",
      body: Buffer.from("# hello", "utf8"),
      versionName: null,
      actor,
    });

    expect(artifact.kind).toBe("document");
    expect(artifact.format).toBe("markdown");
    expect(artifact.currentVersionNumber).toBe(1);
    expect(artifact.currentVersion?.versionNumber).toBe(1);
    expect(artifact.currentVersion?.versionName).toBe("v1");
  });

  it("auto-versions markdown on save without requiring a version name", async () => {
    const { companyId, issueId } = await setupCompanyIssue();
    const { svc } = await makeService();

    const artifact = await svc.createFromUpload({
      companyId,
      issueId,
      name: "notes.md",
      contentType: "text/markdown",
      body: Buffer.from("# v1", "utf8"),
      versionName: null,
      actor,
    });

    const v2 = await svc.saveMarkdown({
      companyId,
      artifactId: artifact.id,
      body: "# v2 edited",
      changeSummary: "edited",
      actor,
    });

    expect(v2.versionNumber).toBe(2);
    expect(v2.isAutomatic).toBe(true);
    expect(v2.versionName).toBe("Revision 2");

    const versions = await svc.listVersions(companyId, artifact.id);
    expect(versions.versions).toHaveLength(2);
    expect(versions.versions[0].versionNumber).toBe(2);
  });

  it("treats docx as an editable document and accepts manually named versions", async () => {
    const { companyId, issueId } = await setupCompanyIssue();
    const { svc } = await makeService();

    const artifact = await svc.createFromUpload({
      companyId,
      issueId,
      name: "report.docx",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      body: Buffer.from("docx-bytes"),
      versionName: "Draft 1",
      actor,
    });

    expect(artifact.kind).toBe("document");
    expect(artifact.format).toBe("docx");
    expect(artifact.currentVersion?.versionName).toBe("Draft 1");

    const v2 = await svc.createVersion({
      companyId,
      artifactId: artifact.id,
      versionName: "Final",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      body: Buffer.from("docx-bytes-v2"),
      changeSummary: null,
      actor,
    });

    expect(v2.versionNumber).toBe(2);
    expect(v2.versionName).toBe("Final");
    expect(v2.isAutomatic).toBe(false);
  });

  it("treats other file types as non-editable attachments with upload-only version control", async () => {
    const { companyId, issueId } = await setupCompanyIssue();
    const { svc } = await makeService();

    const artifact = await svc.createFromUpload({
      companyId,
      issueId,
      name: "scan.pdf",
      contentType: "application/pdf",
      body: Buffer.from("pdf-bytes"),
      versionName: null,
      actor,
    });

    expect(artifact.kind).toBe("attachment");
    expect(artifact.format).toBeNull();

    const v2 = await svc.createVersion({
      companyId,
      artifactId: artifact.id,
      versionName: "Reviewed scan",
      contentType: "application/pdf",
      body: Buffer.from("pdf-bytes-2"),
      changeSummary: null,
      actor,
    });
    expect(v2.versionNumber).toBe(2);
    expect(v2.versionName).toBe("Reviewed scan");
    expect(v2.isAutomatic).toBe(false);
  });

  it("persists and retrieves comments on document artifacts", async () => {
    const { companyId, issueId } = await setupCompanyIssue();
    const { svc } = await makeService();

    const artifact = await svc.createFromUpload({
      companyId,
      issueId,
      name: "notes.md",
      contentType: "text/markdown",
      body: Buffer.from("# hello", "utf8"),
      versionName: null,
      actor,
    });

    await svc.addComment({ companyId, artifactId: artifact.id, body: "first", actor });
    await svc.addComment({ companyId, artifactId: artifact.id, body: "second", actor });

    const result = await svc.listComments(companyId, artifact.id);
    expect(result.comments).toHaveLength(2);
    expect(result.comments.map((c) => c.body)).toEqual(["first", "second"]);
  });

  it("rejects comments on attachment-only artifacts", async () => {
    const { companyId, issueId } = await setupCompanyIssue();
    const { svc } = await makeService();

    const artifact = await svc.createFromUpload({
      companyId,
      issueId,
      name: "image.png",
      contentType: "image/png",
      body: Buffer.from("png-bytes"),
      versionName: null,
      actor,
    });

    expect(artifact.kind).toBe("attachment");
    await expect(
      svc.addComment({ companyId, artifactId: artifact.id, body: "nope", actor }),
    ).rejects.toThrow("Only document artifacts support comments");
  });

  it("restores a prior version as a new current version", async () => {
    const { companyId, issueId } = await setupCompanyIssue();
    const { svc } = await makeService();

    const artifact = await svc.createFromUpload({
      companyId,
      issueId,
      name: "notes.md",
      contentType: "text/markdown",
      body: Buffer.from("# original", "utf8"),
      versionName: null,
      actor,
    });
    const v2 = await svc.saveMarkdown({ companyId, artifactId: artifact.id, body: "# edited", changeSummary: null, actor });
    const v3 = await svc.saveMarkdown({ companyId, artifactId: artifact.id, body: "# edited again", changeSummary: null, actor });
    expect(v3.versionNumber).toBe(3);

    const restored = await svc.restoreVersion({ companyId, artifactId: artifact.id, versionId: v2.id, versionName: null, actor });
    expect(restored.versionNumber).toBe(4);
    expect(restored.versionName).toBe("Restored from v2");

    const current = await svc.get(companyId, artifact.id);
    expect(current.currentVersionNumber).toBe(4);
    expect(current.currentVersionId).toBe(restored.id);

    // Content is byte-for-byte the restored version's bytes.
    const stream = await svc.getVersionStream(companyId, artifact.id);
    const chunks: Buffer[] = [];
    for await (const chunk of stream.object.stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    expect(Buffer.concat(chunks).toString("utf8")).toBe("# edited");
  });
});
