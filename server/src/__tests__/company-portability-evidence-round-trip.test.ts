import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  assets,
  companies,
  createDb,
  externalObjects,
  issueAttachments,
  issueDocuments,
  issueEvidenceLinks,
  issues,
} from "@paperclipai/db";

import { companyPortabilityService } from "../services/company-portability.js";
import { documentService } from "../services/documents.js";
import type { StorageService } from "../storage/types.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

/**
 * PC-012: a card's evidence substrate survives export -> import intact.
 *
 * This is the end-to-end proof for the silent failure the unit closes. Before
 * it, `issue_evidence_links` and `external_objects` appeared nowhere in the
 * enumerated portability manifest, so a company export dropped every evidence
 * link while the fidelity report still read clean.
 *
 * It runs against embedded Postgres rather than mocked services because two of
 * the properties under test are only real at the database level: the imported
 * link rows must satisfy their NOT NULL foreign key onto the imported
 * `external_objects` rows, and `source` must land on the column rather than on
 * the column default.
 */

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres evidence round-trip tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

/**
 * Body of the NAS-held artifact. It is planted in the source object's `data`
 * payload -- the shape a caching resolver would leave behind -- so the
 * confidentiality assertion has something real to fail on: if any future
 * change starts carrying `data`, this string turns up in the bundle.
 */
const NAS_FILE_CONTENTS = "NAS-ONLY-BYTES-c4f1c0de-inspection-run-14";
const NAS_PATH_REFERENCE = "nas://vault/2026/inspection-run-14";
const ATTACHMENT_BYTES = Buffer.from("measurement,value\nflow,41.9\n");

/** Minimal in-memory StorageService: enough for attachment bytes to round-trip. */
function createMemoryStorage(): StorageService {
  const objects = new Map<string, Buffer>();
  let counter = 0;
  return {
    provider: "local_disk",
    async putFile({ companyId, namespace, originalFilename, contentType, body }) {
      counter += 1;
      const objectKey = `${namespace}/${counter}-${originalFilename ?? "file"}`;
      objects.set(`${companyId}/${objectKey}`, body);
      return {
        provider: "local_disk",
        objectKey,
        contentType,
        byteSize: body.length,
        sha256: createHash("sha256").update(body).digest("hex"),
        originalFilename,
      };
    },
    async getObject(companyId, objectKey) {
      const body = objects.get(`${companyId}/${objectKey}`);
      if (!body) throw new Error(`No stored object ${objectKey}`);
      return { stream: Readable.from(body), contentType: "application/octet-stream", contentLength: body.length };
    },
    async headObject(companyId, objectKey) {
      const body = objects.get(`${companyId}/${objectKey}`);
      return body ? { exists: true, contentLength: body.length } : { exists: false };
    },
    async deleteObject(companyId, objectKey) {
      objects.delete(`${companyId}/${objectKey}`);
    },
    async listObjects() {
      return { objects: [], truncated: false };
    },
  };
}

describeEmbeddedPostgres("company portability evidence round trip", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-evidence-round-trip-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("carries a card's dossier, attachment, evidence links, and external objects into a fresh company", async () => {
    const storage = createMemoryStorage();
    const portability = companyPortabilityService(db, storage);

    // --- source company -----------------------------------------------------
    const sourceCompanyId = randomUUID();
    await db.insert(companies).values({
      id: sourceCompanyId,
      name: "Evidence Source Co",
      issuePrefix: "EVS",
      requireBoardApprovalForNewAgents: false,
      // PC-011 gate ON. It is operator-writable through PATCH /api/companies,
      // so a round trip that quietly reset it to the column default would
      // re-open a gate the operator had closed.
      evidenceGateEnabled: true,
    });

    const sourceIssueId = randomUUID();
    await db.insert(issues).values({
      id: sourceIssueId,
      companyId: sourceCompanyId,
      identifier: "EVS-1",
      title: "Commission the flow rig",
      description: "Evidence-bearing card.",
      status: "todo",
      priority: "medium",
    });

    await documentService(db).createIssueDocumentsForImport([{
      companyId: sourceCompanyId,
      issueId: sourceIssueId,
      key: "dossier",
      title: "Dossier",
      format: "markdown",
      body: "## Dossier\n\nCommissioning record.\n",
      createdByAgentId: null,
      createdByUserId: null,
      createdByRunId: null,
      sourceTrust: null,
    }]);

    const stored = await storage.putFile({
      companyId: sourceCompanyId,
      namespace: `issues/${sourceIssueId}`,
      originalFilename: "measurements.csv",
      contentType: "text/csv",
      body: ATTACHMENT_BYTES,
    });
    const sourceAssetId = randomUUID();
    await db.insert(assets).values({
      id: sourceAssetId,
      companyId: sourceCompanyId,
      provider: stored.provider,
      objectKey: stored.objectKey,
      contentType: stored.contentType,
      byteSize: stored.byteSize,
      sha256: stored.sha256,
      originalFilename: stored.originalFilename,
    });
    await db.insert(issueAttachments).values({
      companyId: sourceCompanyId,
      issueId: sourceIssueId,
      assetId: sourceAssetId,
      // Filed by the WP-0 chat bot: the value the pilot metric is computed from.
      source: "bot",
    });

    // One evidence link per provider. The `nas` row is the confidentiality
    // case: a path reference on the row, and cached file content in `data`
    // that must not leave the instance.
    const teableObjectId = randomUUID();
    const gitObjectId = randomUUID();
    const nasObjectId = randomUUID();
    await db.insert(externalObjects).values([
      {
        id: teableObjectId,
        companyId: sourceCompanyId,
        providerKey: "teable",
        objectType: "row",
        externalId: "tblIntake/recFlow14",
        sanitizedCanonicalUrl: "https://teable.example.com/tblIntake/recFlow14",
        displayTitle: "Intake row 14",
      },
      {
        id: gitObjectId,
        companyId: sourceCompanyId,
        providerKey: "git",
        objectType: "commit",
        externalId: "9f1c0de",
        sanitizedCanonicalUrl: "https://git.example.com/rig/commit/9f1c0de",
        displayTitle: "Calibrate flow sensor",
      },
      {
        id: nasObjectId,
        companyId: sourceCompanyId,
        providerKey: "nas",
        objectType: "file",
        externalId: "vault/2026/inspection-run-14",
        sanitizedCanonicalUrl: NAS_PATH_REFERENCE,
        displayTitle: "inspection-run-14",
        data: { cachedBody: NAS_FILE_CONTENTS },
      },
    ]);
    await db.insert(issueEvidenceLinks).values([
      { companyId: sourceCompanyId, issueId: sourceIssueId, externalObjectId: teableObjectId, source: "bot" },
      { companyId: sourceCompanyId, issueId: sourceIssueId, externalObjectId: gitObjectId, source: "manual" },
      { companyId: sourceCompanyId, issueId: sourceIssueId, externalObjectId: nasObjectId, source: "bot" },
    ]);

    // --- export -------------------------------------------------------------
    const exported = await portability.exportBundle(sourceCompanyId, {
      include: { company: true, agents: false, projects: false, issues: true },
    });

    expect(exported.manifest.company?.evidenceGateEnabled).toBe(true);

    const exportedTask = exported.manifest.issues.find((issue) => issue.title === "Commission the flow rig");
    expect(exportedTask).toBeDefined();
    expect(exportedTask?.documents?.map((document) => document.key)).toContain("dossier");
    expect(exportedTask?.attachments?.map((attachment) => attachment.source)).toEqual(["bot"]);
    expect(exportedTask?.evidenceLinks?.map((link) => [link.objectRef, link.source])).toEqual(
      expect.arrayContaining([
        ["teable:row:tblIntake/recFlow14", "bot"],
        ["git:commit:9f1c0de", "manual"],
        ["nas:file:vault/2026/inspection-run-14", "bot"],
      ]),
    );
    expect(exported.manifest.externalObjects?.map((entry) => entry.ref).sort()).toEqual([
      "git:commit:9f1c0de",
      "nas:file:vault/2026/inspection-run-14",
      "teable:row:tblIntake/recFlow14",
    ]);

    // --- confidentiality boundary (PC-007 AC3) ------------------------------
    // A regression here is a disclosure, not a lost field.
    const nasEntry = exported.manifest.externalObjects?.find((entry) => entry.providerKey === "nas");
    expect(nasEntry?.sanitizedCanonicalUrl).toBe(NAS_PATH_REFERENCE);
    // The entry is a path reference and nothing more: no payload key at all.
    expect(Object.keys(nasEntry ?? {}).sort()).toEqual([
      "displayTitle",
      "externalId",
      "objectType",
      "providerKey",
      "ref",
      "sanitizedCanonicalUrl",
    ]);
    // No NAS bytes anywhere in the bundle -- manifest, extension yaml, or files.
    const serializedBundle = JSON.stringify(exported.files) + JSON.stringify(exported.manifest);
    expect(serializedBundle).not.toContain(NAS_FILE_CONTENTS);
    // The only content-addressed blob is the uploaded attachment; evidence
    // links never put a byte into blobs/.
    expect(Object.keys(exported.files).filter((filePath) => filePath.startsWith("blobs/"))).toEqual([
      `blobs/${stored.sha256}`,
    ]);

    // --- import into a fresh company ---------------------------------------
    const result = await portability.importBundle(
      {
        source: { type: "inline", rootPath: exported.rootPath, files: exported.files },
        include: { company: true, agents: false, projects: false, issues: true },
        target: { mode: "new_company", newCompanyName: "Evidence Target Co" },
        collisionStrategy: "rename",
      },
      "user-evidence-round-trip",
    );
    const targetCompanyId = result.company.id;
    expect(targetCompanyId).not.toBe(sourceCompanyId);

    const [targetCompany] = await db
      .select({ evidenceGateEnabled: companies.evidenceGateEnabled })
      .from(companies)
      .where(eq(companies.id, targetCompanyId));
    expect(targetCompany?.evidenceGateEnabled).toBe(true);

    const [importedIssue] = await db
      .select({ id: issues.id, title: issues.title })
      .from(issues)
      .where(and(eq(issues.companyId, targetCompanyId), eq(issues.title, "Commission the flow rig")));
    expect(importedIssue).toBeDefined();

    const importedDocuments = await db
      .select({ key: issueDocuments.key })
      .from(issueDocuments)
      .where(and(eq(issueDocuments.companyId, targetCompanyId), eq(issueDocuments.issueId, importedIssue!.id)));
    expect(importedDocuments.map((row) => row.key)).toContain("dossier");

    // --- evidence links, with FK integrity to the imported objects ----------
    // Reading the link rows through an inner join on `external_objects` IS the
    // integrity assertion: a link whose FK pointed at a missing or foreign row
    // could not have been inserted, and one pointing at the SOURCE company's
    // object would surface here with the wrong company id.
    const importedLinks = await db
      .select({
        source: issueEvidenceLinks.source,
        linkCompanyId: issueEvidenceLinks.companyId,
        objectCompanyId: externalObjects.companyId,
        providerKey: externalObjects.providerKey,
        objectType: externalObjects.objectType,
        externalId: externalObjects.externalId,
        sanitizedCanonicalUrl: externalObjects.sanitizedCanonicalUrl,
        data: externalObjects.data,
      })
      .from(issueEvidenceLinks)
      .innerJoin(externalObjects, eq(issueEvidenceLinks.externalObjectId, externalObjects.id))
      .where(eq(issueEvidenceLinks.issueId, importedIssue!.id));

    expect(importedLinks).toHaveLength(3);
    for (const link of importedLinks) {
      expect(link.linkCompanyId).toBe(targetCompanyId);
      expect(link.objectCompanyId).toBe(targetCompanyId);
    }
    const byProvider = new Map(importedLinks.map((link) => [link.providerKey, link] as const));
    expect(byProvider.get("teable")?.source).toBe("bot");
    expect(byProvider.get("git")?.source).toBe("manual");
    expect(byProvider.get("nas")?.source).toBe("bot");
    expect(byProvider.get("teable")?.externalId).toBe("tblIntake/recFlow14");
    expect(byProvider.get("git")?.sanitizedCanonicalUrl).toBe("https://git.example.com/rig/commit/9f1c0de");

    // The NAS artifact arrives as a path reference with no cached content.
    expect(byProvider.get("nas")?.sanitizedCanonicalUrl).toBe(NAS_PATH_REFERENCE);
    expect(byProvider.get("nas")?.data).toEqual({});

    // --- attachment provenance ---------------------------------------------
    const importedAttachments = await db
      .select({ source: issueAttachments.source, sha256: assets.sha256 })
      .from(issueAttachments)
      .innerJoin(assets, eq(issueAttachments.assetId, assets.id))
      .where(and(eq(issueAttachments.companyId, targetCompanyId), eq(issueAttachments.issueId, importedIssue!.id)));
    expect(importedAttachments).toHaveLength(1);
    expect(importedAttachments[0]?.sha256).toBe(stored.sha256);
    // PC-011: `source` is the column the pilot's pass/abort metric is computed
    // from, so a reset to the "manual" default would silently move the band.
    expect(importedAttachments[0]?.source).toBe("bot");
  }, 120_000);

  it("dedupes an external object when the same bundle is imported into a company that already holds it", async () => {
    const storage = createMemoryStorage();
    const portability = companyPortabilityService(db, storage);

    const sourceCompanyId = randomUUID();
    await db.insert(companies).values({
      id: sourceCompanyId,
      name: "Evidence Dedupe Co",
      issuePrefix: "EVD",
      requireBoardApprovalForNewAgents: false,
    });
    const sourceIssueId = randomUUID();
    await db.insert(issues).values({
      id: sourceIssueId,
      companyId: sourceCompanyId,
      identifier: "EVD-1",
      title: "Dedupe card",
      description: "",
      status: "todo",
      priority: "medium",
    });
    const objectId = randomUUID();
    await db.insert(externalObjects).values({
      id: objectId,
      companyId: sourceCompanyId,
      providerKey: "teable",
      objectType: "row",
      externalId: "tblIntake/recDedupe",
      sanitizedCanonicalUrl: "https://teable.example.com/tblIntake/recDedupe",
      displayTitle: "Dedupe row",
    });
    await db.insert(issueEvidenceLinks).values({
      companyId: sourceCompanyId,
      issueId: sourceIssueId,
      externalObjectId: objectId,
      source: "manual",
    });

    const exported = await portability.exportBundle(sourceCompanyId, {
      include: { company: true, agents: false, projects: false, issues: true },
    });

    const first = await portability.importBundle(
      {
        source: { type: "inline", rootPath: exported.rootPath, files: exported.files },
        include: { company: true, agents: false, projects: false, issues: true },
        target: { mode: "new_company", newCompanyName: "Evidence Dedupe Target" },
        collisionStrategy: "rename",
      },
      "user-evidence-dedupe",
    );
    // Re-importing the same bundle into the SAME company must attach to the
    // existing artifact row on (company, provider, object type, external id)
    // rather than duplicating it.
    await portability.importBundle(
      {
        source: { type: "inline", rootPath: exported.rootPath, files: exported.files },
        include: { company: true, agents: false, projects: false, issues: true },
        target: { mode: "existing_company", companyId: first.company.id },
        collisionStrategy: "rename",
      },
      "user-evidence-dedupe",
    );

    const importedObjects = await db
      .select({ id: externalObjects.id })
      .from(externalObjects)
      .where(and(
        eq(externalObjects.companyId, first.company.id),
        eq(externalObjects.externalId, "tblIntake/recDedupe"),
      ));
    expect(importedObjects).toHaveLength(1);
  }, 120_000);
});
