import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { activityLog, companies, companyMemberships, createDb, issueLabels, issues, labels, projectMemberships, projects, type Db } from "@paperclipai/db";
import { DOSSIER_SECTION_HEADINGS, INTAKE_TRIAGE_LABEL_NAME } from "@paperclipai/shared";
import {
  INTAKE_TITLE_MAX_CHARS,
  discordIntakeService,
  intakeIdempotencyKey,
  intakeTitle,
  resolveIntakeProject,
} from "../services/discord-intake.js";
import { issueDossierService, parseChatCorrelation } from "../services/issue-dossier.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

describe("intakeTitle", () => {
  it("titles the card from the first non-empty line", () => {
    expect(intakeTitle("\n  Thay tủ   điện tầng 3 \nHạn thứ 6")).toBe("Thay tủ điện tầng 3");
  });

  it("cuts a long first line at a word boundary", () => {
    const title = intakeTitle(`${"khảo sát ".repeat(30)}xong`);
    expect(title.length).toBeLessThanOrEqual(INTAKE_TITLE_MAX_CHARS);
    expect(title.endsWith("sát…")).toBe(true);
  });
});

describe("resolveIntakeProject", () => {
  const pump = { id: "p-pump", name: "Trạm bơm Hoà Lạc" };
  const camera = { id: "p-camera", name: "Camera kho B" };

  it("takes the engineer's only project", () => {
    expect(resolveIntakeProject([pump], "việc gì đó")).toBe("p-pump");
  });

  it("matches a project name without diacritics or case", () => {
    expect(resolveIntakeProject([pump, camera], "Kiem tra TRAM BOM hoa lac sang mai")).toBe("p-pump");
  });

  it("goes to triage rather than guess", () => {
    expect(resolveIntakeProject([pump, camera], "việc chung chung")).toBeNull();
    expect(resolveIntakeProject([pump, camera], "trạm bơm hoà lạc và camera kho b")).toBeNull();
    expect(resolveIntakeProject([], "trạm bơm hoà lạc")).toBeNull();
  });
});

describe("intakeIdempotencyKey", () => {
  it("keys a forward on the original message, whatever forwarded it", () => {
    const origin = { channelId: "c-1", messageId: "m-1" };
    expect(intakeIdempotencyKey({ discordUserId: "u-1", origin, text: "a" })).toBe(intakeIdempotencyKey({ discordUserId: "u-1", origin, text: "b" }));
    expect(intakeIdempotencyKey({ discordUserId: "u-1", origin, text: "a" })).not.toBe(intakeIdempotencyKey({ discordUserId: "u-2", origin, text: "a" }));
  });

  it("keys typed text on its content, ignoring case and spacing", () => {
    expect(intakeIdempotencyKey({ discordUserId: "u-1", origin: null, text: "Thay  tủ điện" })).toBe(intakeIdempotencyKey({ discordUserId: "u-1", origin: null, text: "thay tủ điện" }));
  });
});

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("discordIntakeService.createFromJobOrder (F-004-1)", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-discord-intake-");
    db = createDb(tempDb.connectionString);
  }, 90_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function engineer(projectNames: string[] = []) {
    const companyId = randomUUID();
    const userId = `user-${randomUUID()}`;
    await db.insert(companies).values({ id: companyId, name: "Pilot", issuePrefix: `I${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}` });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, status: "active", membershipRole: "member" });
    const projectIds: string[] = [];
    for (const name of projectNames) {
      const [project] = await db.insert(projects).values({ companyId, name }).returning({ id: projects.id });
      await db.insert(projectMemberships).values({ companyId, projectId: project!.id, userId });
      projectIds.push(project!.id);
    }
    return { companyId, userId, projectIds };
  }

  function jobOrder(who: { companyId: string; userId: string }, overrides: Record<string, unknown> = {}) {
    return {
      companyId: who.companyId,
      userId: who.userId,
      discordUserId: `discord-${who.userId}`,
      discordMessageId: `dm-${randomUUID()}`,
      origin: { channelId: "origin-channel", messageId: "origin-1" },
      text: "Thay tủ điện tầng 3\nHạn thứ 6, gọi anh Nam trước khi lên",
      attachmentNames: [],
      ...overrides,
    };
  }

  it("creates one card assigned to the engineer in their project, with a five-section dossier", async () => {
    const who = await engineer(["Toà nhà A"]);

    const result = await discordIntakeService(db).createFromJobOrder(jobOrder(who));

    expect(result).toMatchObject({ duplicate: false, triage: false });
    const [card] = await db.select().from(issues).where(eq(issues.id, result.issue.id));
    expect(card).toMatchObject({ title: "Thay tủ điện tầng 3", assigneeUserId: who.userId, createdByUserId: who.userId, projectId: who.projectIds[0], originKind: "discord" });
    const dossier = await issueDossierService(db).get(result.issue.id);
    expect(Object.keys(dossier!.document.sections)).toEqual([...DOSSIER_SECTION_HEADINGS]);
    expect(dossier!.document.sections["Job order"]).toContain("gọi anh Nam trước khi lên");
    expect(parseChatCorrelation(dossier!.document)).toEqual({ chatOriginId: "origin-1", issueIdentifier: result.issue.identifier, originKind: "discord" });
    const created = await db.select().from(activityLog).where(and(eq(activityLog.entityId, result.issue.id), eq(activityLog.action, "issue.created")));
    expect(created).toHaveLength(1);
  });

  it("answers a re-forward of the same job order with the same card", async () => {
    const who = await engineer(["Toà nhà A"]);
    const intake = discordIntakeService(db);

    const first = await intake.createFromJobOrder(jobOrder(who));
    const again = await intake.createFromJobOrder(jobOrder(who));

    expect(again).toMatchObject({ duplicate: true, issue: { id: first.issue.id } });
    expect(await db.select().from(issues).where(eq(issues.companyId, who.companyId))).toHaveLength(1);
    const created = await db.select().from(activityLog).where(and(eq(activityLog.companyId, who.companyId), eq(activityLog.action, "issue.created")));
    expect(created).toHaveLength(1);
  });

  it("routes an unresolvable project to the triage label instead of failing", async () => {
    const who = await engineer(["Toà nhà A", "Toà nhà B"]);

    const result = await discordIntakeService(db).createFromJobOrder(jobOrder(who, { text: "Việc chung, chưa rõ ở đâu" }));

    expect(result.triage).toBe(true);
    const [card] = await db.select().from(issues).where(eq(issues.id, result.issue.id));
    expect(card!.projectId).toBeNull();
    const attached = await db.select({ name: labels.name }).from(issueLabels).innerJoin(labels, eq(issueLabels.labelId, labels.id)).where(eq(issueLabels.issueId, result.issue.id));
    expect(attached).toEqual([{ name: INTAKE_TRIAGE_LABEL_NAME }]);
  });

  it("reuses one triage label per company", async () => {
    const who = await engineer();
    const intake = discordIntakeService(db);

    await intake.createFromJobOrder(jobOrder(who, { origin: null, text: "Việc thứ nhất" }));
    await intake.createFromJobOrder(jobOrder(who, { origin: null, text: "Việc thứ hai" }));

    expect(await db.select().from(labels).where(eq(labels.companyId, who.companyId))).toHaveLength(1);
  });

  it("seeds the dossier on a retry when the first attempt died after creating the card", async () => {
    const who = await engineer(["Toà nhà A"]);
    const intake = discordIntakeService(db);
    const first = await intake.createFromJobOrder(jobOrder(who));
    const { issueDocuments } = await import("@paperclipai/db");
    await db.delete(issueDocuments).where(eq(issueDocuments.issueId, first.issue.id));

    await intake.createFromJobOrder(jobOrder(who));

    expect(await issueDossierService(db).get(first.issue.id)).not.toBeNull();
  });
});
