import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  companies,
  createDb,
  externalObjects,
  issueEvidenceLinks,
  issues,
  projectWorkspaces,
  projects,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";
import { createEvidenceStorageReaper } from "../services/evidence-storage-reaper.js";
import type { StorageProvider, PutObjectInput, GetObjectInput, GetObjectResult, HeadObjectResult, ListObjectsInput, ListObjectsResult } from "../storage/types.js";
import { createStorageService } from "../storage/service.js";

const execFileAsync = promisify(execFile);

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;
if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres evidence provider route tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

/** An in-memory S3-shaped provider so these tests exercise the real StorageService wrapper. */
function createFakeStorageProvider(): StorageProvider & { objects: Map<string, Buffer>; puts: number } {
  const objects = new Map<string, Buffer>();
  return {
    id: "s3",
    objects,
    puts: 0,
    async putObject(input: PutObjectInput) {
      this.puts += 1;
      const body = input.body instanceof Buffer ? input.body : Buffer.concat(await collectStream(input.body));
      objects.set(input.objectKey, body);
    },
    async getObject(input: GetObjectInput): Promise<GetObjectResult> {
      const body = objects.get(input.objectKey);
      if (!body) throw new Error("not found");
      const { Readable } = await import("node:stream");
      return { stream: Readable.from(body), contentLength: body.length };
    },
    async headObject(input: GetObjectInput): Promise<HeadObjectResult> {
      const body = objects.get(input.objectKey);
      return body ? { exists: true, contentLength: body.length } : { exists: false };
    },
    async deleteObject(input: GetObjectInput) {
      objects.delete(input.objectKey);
    },
    async listObjects(_input: ListObjectsInput): Promise<ListObjectsResult> {
      return { objects: [], truncated: false };
    },
  } as StorageProvider & { objects: Map<string, Buffer>; puts: number };
}

async function collectStream(stream: NodeJS.ReadableStream): Promise<Buffer[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return chunks;
}

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5]);

describeEmbeddedPostgres("evidence providers routes (F-007-2/3/4)", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db: ReturnType<typeof createDb>;
  let gitRepoDir: string | null = null;
  let commitHash = "";

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-evidence-providers-");
    db = createDb(tempDb.connectionString);

    gitRepoDir = await mkdtemp(path.join(tmpdir(), "paperclip-evidence-git-"));
    await execFileAsync("git", ["init", "-q"], { cwd: gitRepoDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: gitRepoDir });
    await execFileAsync("git", ["config", "user.name", "Test"], { cwd: gitRepoDir });
    await writeFile(path.join(gitRepoDir, "a.txt"), "hello");
    await execFileAsync("git", ["add", "a.txt"], { cwd: gitRepoDir });
    await execFileAsync("git", ["commit", "-q", "-m", "initial"], { cwd: gitRepoDir });
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: gitRepoDir });
    commitHash = stdout.trim();
  }, 60_000);

  afterEach(async () => {
    await db.delete(issueEvidenceLinks);
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(projectWorkspaces);
    await db.delete(projects);
    await db.delete(externalObjects);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
    if (gitRepoDir) await rm(gitRepoDir, { recursive: true, force: true });
  });

  let issueCounter = 0;

  async function seedCompany() {
    const companyId = randomUUID();
    const prefix = `EP${companyId.replaceAll("-", "").slice(0, 6).toUpperCase()}`;
    await db.insert(companies).values({
      id: companyId,
      name: "Evidence Provider Co",
      issuePrefix: prefix,
      requireBoardApprovalForNewAgents: false,
    });
    return { companyId, prefix };
  }

  async function seedIssue(companyId: string, prefix: string, projectWorkspaceId: string | null = null) {
    issueCounter += 1;
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: `Evidence provider issue ${issueCounter}`,
      status: "todo",
      priority: "medium",
      issueNumber: issueCounter,
      identifier: `${prefix}-${issueCounter}`,
      projectWorkspaceId,
    });
    return issueId;
  }

  async function seedWorkspace(companyId: string, repoUrl: string | null, cwd: string | null) {
    const projectId = randomUUID();
    await db.insert(projects).values({ id: projectId, companyId, name: "Project" });
    const workspaceId = randomUUID();
    await db.insert(projectWorkspaces).values({
      id: workspaceId,
      companyId,
      projectId,
      name: "Workspace",
      repoUrl,
      cwd,
    });
    return workspaceId;
  }

  function createApp(externalStorage: StorageProvider | null) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).actor = { type: "board", source: "local_implicit" };
      next();
    });
    app.use("/api", issueRoutes(db, {} as any, { externalStorage }));
    app.use(errorHandler);
    return app;
  }

  // -- F-007-1's generic descriptor route is closed to "minio" (F-007-2).

  it("refuses providerKey minio on the generic JSON evidence-links route", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    const app = createApp(null);

    const res = await request(app)
      .post(`/api/issues/${issueId}/evidence-links`)
      .send({ providerKey: "minio", objectType: "file", externalId: "whatever" });

    expect(res.status).toBe(422);
    expect(await db.select().from(issueEvidenceLinks)).toHaveLength(0);
  });

  // -- F-007-3: git commit verify + link.

  it("refuses a git evidence submission when the issue has no configured workspace", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix, null);
    const app = createApp(null);

    const res = await request(app).post(`/api/issues/${issueId}/evidence-links`).send({
      providerKey: "git",
      objectType: "commit",
      externalId: commitHash,
      url: `https://github.com/org/repo/commit/${commitHash}`,
    });

    expect(res.status).toBe(422);
  });

  it("refuses a commit URL on a lookalike host even with a real local commit", async () => {
    const { companyId, prefix } = await seedCompany();
    const workspaceId = await seedWorkspace(companyId, "https://github.com/org/repo.git", gitRepoDir);
    const issueId = await seedIssue(companyId, prefix, workspaceId);
    const app = createApp(null);

    const res = await request(app).post(`/api/issues/${issueId}/evidence-links`).send({
      providerKey: "git",
      objectType: "commit",
      externalId: commitHash,
      url: `https://github.com.attacker.example/org/repo/commit/${commitHash}`,
    });

    expect(res.status).toBe(422);
    expect(await db.select().from(issueEvidenceLinks)).toHaveLength(0);
  });

  it("refuses a commit hash that does not exist in the workspace's local repository", async () => {
    const { companyId, prefix } = await seedCompany();
    const workspaceId = await seedWorkspace(companyId, "https://github.com/org/repo.git", gitRepoDir);
    const issueId = await seedIssue(companyId, prefix, workspaceId);
    const app = createApp(null);

    const res = await request(app).post(`/api/issues/${issueId}/evidence-links`).send({
      providerKey: "git",
      objectType: "commit",
      externalId: "0000000000000000000000000000000000dead",
    });

    expect(res.status).toBe(422);
  });

  it("links a real commit URL verified against the issue's own configured repository", async () => {
    const { companyId, prefix } = await seedCompany();
    const workspaceId = await seedWorkspace(companyId, "https://github.com/org/repo.git", gitRepoDir);
    const issueId = await seedIssue(companyId, prefix, workspaceId);
    const app = createApp(null);

    const res = await request(app).post(`/api/issues/${issueId}/evidence-links`).send({
      providerKey: "git",
      objectType: "commit",
      externalId: "ignored",
      url: `https://github.com/org/repo/commit/${commitHash}`,
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ providerKey: "git", externalId: commitHash });
    const [row] = await db.select().from(externalObjects).where(eq(externalObjects.id, res.body.externalObjectId));
    expect(row?.data).toMatchObject({ verifiedHost: "github.com", verifiedRepoPath: "org/repo" });
  });

  it("links a bare local commit hash with no URL", async () => {
    const { companyId, prefix } = await seedCompany();
    const workspaceId = await seedWorkspace(companyId, "https://github.com/org/repo.git", gitRepoDir);
    const issueId = await seedIssue(companyId, prefix, workspaceId);
    const app = createApp(null);

    const res = await request(app).post(`/api/issues/${issueId}/evidence-links`).send({
      providerKey: "git",
      objectType: "commit",
      externalId: commitHash,
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ providerKey: "git", externalId: commitHash });
  });

  // -- F-007-2: MinIO evidence upload.

  it("returns 501 when no external storage is configured", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    const app = createApp(null);

    const res = await request(app)
      .post(`/api/companies/${companyId}/issues/${issueId}/evidence-links/upload`)
      .attach("file", PNG_BYTES, { filename: "a.png", contentType: "image/png" });

    expect(res.status).toBe(501);
  });

  it("uploads a file, stores it, and links it as minio evidence", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    const provider = createFakeStorageProvider();
    const app = createApp(provider);

    const res = await request(app)
      .post(`/api/companies/${companyId}/issues/${issueId}/evidence-links/upload`)
      .attach("file", PNG_BYTES, { filename: "a.png", contentType: "image/png" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ providerKey: "minio", objectType: "file" });
    expect(provider.puts).toBe(1);
    expect(provider.objects.size).toBe(1);
    const [row] = await db.select().from(externalObjects).where(eq(externalObjects.id, res.body.externalObjectId));
    expect(row?.data).toMatchObject({ byteSize: PNG_BYTES.length, contentType: "image/png" });
    expect(row?.nextRefreshAt).toBeNull();
  });

  it("refuses a declared image/png whose bytes are something else", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue(companyId, prefix);
    const provider = createFakeStorageProvider();
    const app = createApp(provider);

    const res = await request(app)
      .post(`/api/companies/${companyId}/issues/${issueId}/evidence-links/upload`)
      .attach("file", Buffer.from("not a png"), { filename: "a.png", contentType: "image/png" });

    expect(res.status).toBe(422);
    expect(provider.puts).toBe(0);
    expect(await db.select().from(issueEvidenceLinks)).toHaveLength(0);
  });

  it("dedupes identical bytes on the same company: one object, no second storage write", async () => {
    const { companyId, prefix } = await seedCompany();
    const firstIssueId = await seedIssue(companyId, prefix);
    const secondIssueId = await seedIssue(companyId, prefix);
    const provider = createFakeStorageProvider();
    const app = createApp(provider);

    const first = await request(app)
      .post(`/api/companies/${companyId}/issues/${firstIssueId}/evidence-links/upload`)
      .attach("file", PNG_BYTES, { filename: "a.png", contentType: "image/png" });
    const second = await request(app)
      .post(`/api/companies/${companyId}/issues/${secondIssueId}/evidence-links/upload`)
      .attach("file", PNG_BYTES, { filename: "a-copy.png", contentType: "image/png" });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.externalObjectId).toBe(first.body.externalObjectId);
    // One upload actually touched storage; the second deduped onto the same row.
    expect(provider.puts).toBe(1);
    expect(await db.select().from(externalObjects)).toHaveLength(1);
    expect(await db.select().from(issueEvidenceLinks)).toHaveLength(2);
  });

  it("does not dedupe identical bytes across two different companies", async () => {
    const companyA = await seedCompany();
    const companyB = await seedCompany();
    const issueA = await seedIssue(companyA.companyId, companyA.prefix);
    const issueB = await seedIssue(companyB.companyId, companyB.prefix);
    const provider = createFakeStorageProvider();
    const app = createApp(provider);

    const a = await request(app)
      .post(`/api/companies/${companyA.companyId}/issues/${issueA}/evidence-links/upload`)
      .attach("file", PNG_BYTES, { filename: "a.png", contentType: "image/png" });
    const b = await request(app)
      .post(`/api/companies/${companyB.companyId}/issues/${issueB}/evidence-links/upload`)
      .attach("file", PNG_BYTES, { filename: "a.png", contentType: "image/png" });

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.externalObjectId).not.toBe(a.body.externalObjectId);
    expect(provider.puts).toBe(2);
  });

  // -- F-007-2's GC backstop.

  describe("evidence storage reaper", () => {
    it("reclaims an unlinked minio object past the threshold and leaves recent/linked ones alone", async () => {
      const { companyId } = await seedCompany();
      const provider = createFakeStorageProvider();
      const storage = createStorageService(provider);

      const stale = await storage.putFile({
        companyId,
        namespace: "evidence",
        originalFilename: "stale.bin",
        contentType: "application/octet-stream",
        body: Buffer.from("stale"),
      });
      const [staleRow] = await db
        .insert(externalObjects)
        .values({
          companyId,
          providerKey: "minio",
          objectType: "file",
          externalId: stale.sha256,
          data: { objectKey: stale.objectKey },
          nextRefreshAt: null,
          createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
        })
        .returning();

      const fresh = await storage.putFile({
        companyId,
        namespace: "evidence",
        originalFilename: "fresh.bin",
        contentType: "application/octet-stream",
        body: Buffer.from("fresh"),
      });
      await db.insert(externalObjects).values({
        companyId,
        providerKey: "minio",
        objectType: "file",
        externalId: fresh.sha256,
        data: { objectKey: fresh.objectKey },
        nextRefreshAt: null,
      });

      const linked = await storage.putFile({
        companyId,
        namespace: "evidence",
        originalFilename: "linked.bin",
        contentType: "application/octet-stream",
        body: Buffer.from("linked"),
      });
      const [linkedRow] = await db
        .insert(externalObjects)
        .values({
          companyId,
          providerKey: "minio",
          objectType: "file",
          externalId: linked.sha256,
          data: { objectKey: linked.objectKey },
          nextRefreshAt: null,
          createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
        })
        .returning();
      const prefix = `RP${companyId.replaceAll("-", "").slice(0, 6).toUpperCase()}`;
      const linkedIssueId = await seedIssue(companyId, prefix);
      await db.insert(issueEvidenceLinks).values({
        companyId,
        issueId: linkedIssueId,
        externalObjectId: linkedRow!.id,
        source: "manual",
      });

      const reaper = createEvidenceStorageReaper({ db, storage, thresholdMs: 24 * 60 * 60 * 1000 });
      const result = await reaper.sweep();

      expect(result).toEqual({ reclaimed: 1, failed: 0 });
      expect(provider.objects.has(stale.objectKey)).toBe(false);
      expect(await db.select().from(externalObjects).where(eq(externalObjects.id, staleRow!.id))).toHaveLength(0);
      // Fresh (too young) and linked (has a link row) both survive.
      expect(provider.objects.has(fresh.objectKey)).toBe(true);
      expect(provider.objects.has(linked.objectKey)).toBe(true);
      expect(await db.select().from(externalObjects)).toHaveLength(2);
    });

    it("is a no-op when there is nothing to reclaim", async () => {
      const provider = createFakeStorageProvider();
      const storage = createStorageService(provider);
      const reaper = createEvidenceStorageReaper({ db, storage });

      expect(await reaper.sweep()).toEqual({ reclaimed: 0, failed: 0 });
    });
  });
});
