import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  companies,
  createDb,
  issues,
  workQueueItems,
  workQueues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { workQueueService } from "../services/work-queues.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres work queue service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("work queue service", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof workQueueService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-work-queues-");
    db = createDb(tempDb.connectionString);
    svc = workQueueService(db);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(workQueueItems);
    await db.delete(workQueues);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompany(prefix = "WQ") {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: `Company ${prefix}`,
      issuePrefix: prefix,
      requireBoardApprovalForNewAgents: false,
    });
    return companyId;
  }

  it("creates a queue, rejects a duplicate name, and lists queues for the company", async () => {
    const companyId = await seedCompany("CRQ");

    const queue = await svc.createQueue(companyId, { name: "Support Intake", description: "Inbound tickets" });
    expect(queue).toMatchObject({
      companyId,
      name: "Support Intake",
      slug: "support-intake",
      description: "Inbound tickets",
    });

    await expect(svc.createQueue(companyId, { name: "Support Intake" })).rejects.toMatchObject({
      status: 409,
    });

    const listed = await svc.listQueues(companyId);
    expect(listed.map((q) => q.id)).toEqual([queue.id]);
  });

  it("adds items to a queue and lists them, optionally filtered by status", async () => {
    const companyId = await seedCompany("ADI");
    const queue = await svc.createQueue(companyId, { name: "Inbox" });

    const item = await svc.addItem(
      companyId,
      queue.id,
      { title: "Follow up with customer", body: "They asked about billing", sourceLabel: "email" },
      { userId: "user-1" },
    );
    expect(item).toMatchObject({
      companyId,
      queueId: queue.id,
      title: "Follow up with customer",
      sourceLabel: "email",
      status: "open",
      createdByUserId: "user-1",
    });

    const allItems = await svc.listItems(companyId, queue.id);
    expect(allItems.map((i) => i.id)).toEqual([item.id]);

    const openItems = await svc.listItems(companyId, queue.id, { status: "open" });
    expect(openItems).toHaveLength(1);
    const promotedItems = await svc.listItems(companyId, queue.id, { status: "promoted" });
    expect(promotedItems).toHaveLength(0);
  });

  it("promotes an open item into a linked issue and marks it promoted", async () => {
    const companyId = await seedCompany("PRO");
    const queue = await svc.createQueue(companyId, { name: "Inbox" });
    const item = await svc.addItem(
      companyId,
      queue.id,
      { title: "Investigate slow dashboard", body: "Users report timeouts" },
      { agentId: null, userId: "reporter" },
    );

    const { item: promoted, issue } = await svc.promoteItem(
      companyId,
      item.id,
      {},
      { userId: "promoter" },
    );

    expect(issue).toMatchObject({
      companyId,
      title: "Investigate slow dashboard",
      description: "Users report timeouts",
      originKind: "work_queue_item",
      originId: item.id,
    });

    expect(promoted).toMatchObject({
      id: item.id,
      status: "promoted",
      promotedIssueId: issue.id,
      promotedByUserId: "promoter",
    });
    expect(promoted.promotedAt).toBeInstanceOf(Date);

    // Promoting again is rejected since the item is no longer open.
    await expect(svc.promoteItem(companyId, item.id, {}, {})).rejects.toMatchObject({ status: 409 });
  });

  it("allows overriding title/description/projectId on promote", async () => {
    const companyId = await seedCompany("OVR");
    const queue = await svc.createQueue(companyId, { name: "Inbox" });
    const item = await svc.addItem(companyId, queue.id, { title: "Raw intake title" });

    const { issue } = await svc.promoteItem(
      companyId,
      item.id,
      { title: "Refined issue title", description: "Clarified description" },
      {},
    );

    expect(issue).toMatchObject({
      title: "Refined issue title",
      description: "Clarified description",
    });
  });

  it("dismisses an open item with a reason and rejects dismissing it twice", async () => {
    const companyId = await seedCompany("DIS");
    const queue = await svc.createQueue(companyId, { name: "Inbox" });
    const item = await svc.addItem(companyId, queue.id, { title: "Duplicate report" });

    const dismissed = await svc.dismissItem(
      companyId,
      item.id,
      { reason: "Duplicate of existing issue" },
      { userId: "reviewer" },
    );
    expect(dismissed).toMatchObject({
      id: item.id,
      status: "dismissed",
      dismissReason: "Duplicate of existing issue",
      dismissedByUserId: "reviewer",
    });
    expect(dismissed.dismissedAt).toBeInstanceOf(Date);

    await expect(svc.dismissItem(companyId, item.id, {}, {})).rejects.toMatchObject({ status: 409 });
  });

  it("keeps queues and items scoped to their owning company", async () => {
    const companyA = await seedCompany("BND");
    const companyB = await seedCompany("BND2");
    const queue = await svc.createQueue(companyA, { name: "Company A Inbox" });
    const item = await svc.addItem(companyA, queue.id, { title: "Company A item" });

    expect(await svc.getQueue(companyB, queue.id)).toBeNull();
    await expect(svc.listItems(companyB, queue.id)).rejects.toMatchObject({ status: 404 });
    expect(await svc.getItem(companyB, item.id)).toBeNull();
    await expect(svc.promoteItem(companyB, item.id, {}, {})).rejects.toMatchObject({ status: 404 });
    await expect(svc.dismissItem(companyB, item.id, {}, {})).rejects.toMatchObject({ status: 404 });

    // Untouched from company A's perspective.
    const stillOpen = await svc.getItem(companyA, item.id);
    expect(stillOpen?.status).toBe("open");
  });
});
