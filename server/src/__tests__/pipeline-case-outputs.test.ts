import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companies, createDb, pipelineCaseIssueLinks } from "@paperclipai/db";
import { ISSUE_DOSSIER_DOCUMENT_KEY } from "@paperclipai/shared";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { documentService } from "../services/documents.js";
import { issueService } from "../services/issues.js";
import { pipelineCaseOutputsService } from "../services/pipeline-case-outputs.js";
import { pipelineService, type PipelineActor } from "../services/pipelines.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;
if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres pipeline case output tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("pipelineCaseOutputsService", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db!: ReturnType<typeof createDb>;

  const userActor: PipelineActor = { type: "user", userId: "board-user" };

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-pipeline-case-outputs-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("does not list a source issue's internal dossier as a case output", async () => {
    const [company] = await db.insert(companies).values({
      name: "Outputs Co",
      issuePrefix: `O${randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      defaultResponsibleUserId: "board-user",
    }).returning();
    const pipelines = pipelineService(db, { heartbeat: { wakeup: async () => null } });
    const pipeline = await pipelines.createPipeline({
      companyId: company!.id,
      key: `content-${randomUUID().slice(0, 8)}`,
      name: "Content",
      enforceTransitions: false,
      actor: userActor,
    });
    const ingested = await pipelines.ingestCase({
      companyId: company!.id,
      pipelineId: pipeline.id,
      caseKey: "launch",
      title: "Launch",
      actor: userActor,
    });

    // issueService.create() seeds the intake dossier (PC-002 AC1) from the description, which for
    // a stage automation issue is the agent-facing prompt.
    const automationIssue = await issueService(db).create(company!.id, {
      title: "Content / Drafting: Launch",
      description: "Complete the stage task, then update the pipeline case.",
      status: "todo",
      priority: "medium",
    } as any);
    await db.insert(pipelineCaseIssueLinks).values({
      companyId: company!.id,
      caseId: ingested.case.id,
      issueId: automationIssue.id,
      role: "automation",
    });
    await documentService(db).upsertIssueDocument({
      issueId: automationIssue.id,
      key: "draft",
      title: "Draft",
      format: "markdown",
      body: "Launch blog post draft.",
      createdByUserId: "board-user",
    });

    const outputs = await pipelineCaseOutputsService(db).listCaseOutputs(company!.id, ingested.case.id);
    const documentKeys = outputs.items.flatMap((item) => (item.kind === "document" ? [item.documentKey] : []));

    expect(documentKeys).toEqual(["draft"]);
    expect(documentKeys).not.toContain(ISSUE_DOSSIER_DOCUMENT_KEY);
  });
});
