import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  companies,
  createDb,
  externalObjects,
  issueEvidenceLinks,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { TEABLE_BOT_ACCOUNT_SECRET_NAME } from "../services/teable-append.js";
import type { TeableClient, TeableRecord, TeableSecretsDeps } from "../services/teable-client.js";
import {
  TEABLE_MIRROR_ACTIVITY_ACTIONS,
  TEABLE_MIRROR_OBJECT_TYPE,
  TEABLE_MIRROR_PROVIDER_KEY,
  TEABLE_MIRROR_TABLE_SECRET_NAME,
  mirrorRetryDelaySeconds,
  teableMirrorService,
  type MirrorIssueInput,
} from "../services/teable-mirror.js";

/**
 * F-005-1. Runs against real embedded Postgres -- the mirror's whole point is
 * durable `external_objects`/`issue_evidence_links`/`activity_log` state
 * across ticks, so a mocked store would prove nothing about that state
 * surviving between two `syncIssue` calls. Teable itself is always a fake
 * `TeableClient` -- no test opens a socket (same rule as teable-client.test.ts
 * and teable-append.test.ts).
 */

const ALLOWLISTED_TABLE_ID = "tblSlice1Pilot";
const BOT_ACCOUNT_NAME = "Paperclip Bot";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres teable-mirror tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

function fakeSecrets(values: Record<string, string | undefined>): TeableSecretsDeps {
  return {
    getByName: async (_companyId, name) => (values[name] !== undefined ? { id: `secret-${name}` } : null),
    resolveSecretValue: async (_companyId, secretId) => {
      const name = secretId.replace(/^secret-/, "");
      return values[name] ?? "";
    },
  };
}

function teableRecord(overrides: Partial<TeableRecord> = {}): TeableRecord {
  return {
    id: "recMirror01",
    name: "Mirror row",
    fields: {},
    autoNumber: 1,
    createdTime: "2026-09-14T00:00:00.000Z",
    lastModifiedTime: null,
    createdBy: BOT_ACCOUNT_NAME,
    lastModifiedBy: null,
    modifiedAt: new Date("2026-09-14T00:00:00.000Z"),
    ...overrides,
  };
}

function fakeClient(overrides: Partial<TeableClient> = {}): TeableClient {
  return {
    listRecords: vi.fn(),
    getRecord: vi.fn(async () => ({ ok: true as const, data: teableRecord() })),
    createRecords: vi.fn(async () => ({ ok: true as const, data: [teableRecord()] })),
    updateRecord: vi.fn(async () => ({ ok: true as const, data: teableRecord() })),
    listFields: vi.fn(),
    listTables: vi.fn(),
    ...overrides,
  } as unknown as TeableClient;
}

describeEmbeddedPostgres("teable mirror (PC-005 / F-005-1)", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-teable-mirror-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    await db.delete(issueEvidenceLinks);
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(externalObjects);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  let issueCounter = 0;

  async function seedCompany() {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Teable Mirror Co",
      issuePrefix: `TM${companyId.replaceAll("-", "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    return companyId;
  }

  async function seedIssue(companyId: string, overrides: Partial<typeof issues.$inferInsert> = {}) {
    issueCounter += 1;
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: `Mirror issue ${issueCounter}`,
      status: "todo",
      priority: "medium",
      identifier: `TM-${issueCounter}`,
      ...overrides,
    });
    return issueId;
  }

  async function loadIssueInput(issueId: string): Promise<MirrorIssueInput> {
    const [row] = await db
      .select({
        id: issues.id,
        companyId: issues.companyId,
        identifier: issues.identifier,
        title: issues.title,
        status: issues.status,
        assigneeUserId: issues.assigneeUserId,
        assigneeAgentId: issues.assigneeAgentId,
        updatedAt: issues.updatedAt,
        hiddenAt: issues.hiddenAt,
      })
      .from(issues)
      .where(eq(issues.id, issueId));
    if (!row) throw new Error("seeded issue not found");
    return row;
  }

  async function mirrorRow(issueId: string) {
    const [row] = await db
      .select({ object: externalObjects })
      .from(issueEvidenceLinks)
      .innerJoin(externalObjects, eq(issueEvidenceLinks.externalObjectId, externalObjects.id))
      .where(
        and(
          eq(issueEvidenceLinks.issueId, issueId),
          eq(externalObjects.providerKey, TEABLE_MIRROR_PROVIDER_KEY),
          eq(externalObjects.objectType, TEABLE_MIRROR_OBJECT_TYPE),
        ),
      );
    return row?.object ?? null;
  }

  async function activityActionsFor(issueId: string) {
    const rows = await db
      .select({ action: activityLog.action, details: activityLog.details })
      .from(activityLog)
      .where(and(eq(activityLog.entityType, "issue"), eq(activityLog.entityId, issueId)))
      .orderBy(activityLog.createdAt);
    return rows;
  }

  describe("happy path -- create then update on a real change (AC1)", () => {
    it("creates one mirror row, then updates the SAME row when status changes", async () => {
      const companyId = await seedCompany();
      const issueId = await seedIssue(companyId, { status: "todo" });
      const secrets = fakeSecrets({ [TEABLE_MIRROR_TABLE_SECRET_NAME]: ALLOWLISTED_TABLE_ID });

      const createRecords = vi.fn(async () => ({
        ok: true as const,
        data: [teableRecord({ id: "recMirror01", lastModifiedTime: null, createdTime: "2026-09-14T00:00:00.000Z" })],
      }));
      const updateRecord = vi.fn(async () => ({
        ok: true as const,
        data: teableRecord({ id: "recMirror01", lastModifiedTime: "2026-09-14T01:00:00.000Z", lastModifiedBy: BOT_ACCOUNT_NAME }),
      }));
      const client = fakeClient({ createRecords, updateRecord });
      const svc = teableMirrorService(db, { client, secrets });

      const now1 = new Date("2026-09-14T00:00:00.000Z");
      const result1 = await svc.syncIssue({ companyId, issue: await loadIssueInput(issueId), now: now1 });
      expect(result1.status).toBe("created");
      expect(createRecords).toHaveBeenCalledTimes(1);
      expect(createRecords).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId,
          tableId: ALLOWLISTED_TABLE_ID,
          records: [{ fields: expect.objectContaining({ Status: "todo" }) }],
        }),
      );

      const object1 = await mirrorRow(issueId);
      expect(object1).not.toBeNull();
      expect(object1?.externalId).toBe(`${ALLOWLISTED_TABLE_ID}/recMirror01`);

      // AC1: a status change propagates onto the SAME mirrored row, not a new one.
      await db.update(issues).set({ status: "done", updatedAt: new Date("2026-09-14T00:30:00.000Z") }).where(eq(issues.id, issueId));
      const now2 = new Date("2026-09-14T00:31:00.000Z");
      const result2 = await svc.syncIssue({ companyId, issue: await loadIssueInput(issueId), now: now2 });
      expect(result2.status).toBe("updated");
      expect(updateRecord).toHaveBeenCalledTimes(1);
      expect(updateRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId,
          tableId: ALLOWLISTED_TABLE_ID,
          recordId: "recMirror01",
          fields: expect.objectContaining({ Status: "done" }),
        }),
      );
      expect(createRecords).toHaveBeenCalledTimes(1); // never a second row

      const object2 = await mirrorRow(issueId);
      expect(object2?.id).toBe(object1?.id); // same external_objects row, updated in place

      const actions = await activityActionsFor(issueId);
      expect(actions.map((a) => a.action)).toEqual([
        TEABLE_MIRROR_ACTIVITY_ACTIONS.created,
        TEABLE_MIRROR_ACTIVITY_ACTIONS.updated,
      ]);
    });

    it("is a no-op when nothing relevant changed and the recheck window has not elapsed", async () => {
      const companyId = await seedCompany();
      const issueId = await seedIssue(companyId);
      const secrets = fakeSecrets({ [TEABLE_MIRROR_TABLE_SECRET_NAME]: ALLOWLISTED_TABLE_ID });
      const client = fakeClient();
      const svc = teableMirrorService(db, { client, secrets });

      const now = new Date("2026-09-14T00:00:00.000Z");
      await svc.syncIssue({ companyId, issue: await loadIssueInput(issueId), now });
      const result = await svc.syncIssue({ companyId, issue: await loadIssueInput(issueId), now: new Date(now.getTime() + 5_000) });

      expect(result.status).toBe("unchanged");
      expect(client.getRecord).not.toHaveBeenCalled(); // recheck window not elapsed, no Teable call at all
    });
  });

  describe("conflict detection (AC3) -- a Teable-side edit is flagged, never overwritten", () => {
    it("flags a conflict and never calls updateRecord when someone else edited the row in Teable", async () => {
      const companyId = await seedCompany();
      const issueId = await seedIssue(companyId, { status: "todo" });
      const secrets = fakeSecrets({
        [TEABLE_MIRROR_TABLE_SECRET_NAME]: ALLOWLISTED_TABLE_ID,
        [TEABLE_BOT_ACCOUNT_SECRET_NAME]: BOT_ACCOUNT_NAME,
      });
      const createRecords = vi.fn(async () => ({
        ok: true as const,
        data: [teableRecord({ id: "recMirror01", lastModifiedTime: null, createdBy: BOT_ACCOUNT_NAME })],
      }));
      const updateRecord = vi.fn(async () => ({ ok: true as const, data: teableRecord() }));
      const getRecord = vi.fn(async () => ({
        ok: true as const,
        data: teableRecord({
          id: "recMirror01",
          lastModifiedTime: "2026-09-14T02:00:00.000Z",
          lastModifiedBy: "A Human Editor", // NOT the bot account
        }),
      }));
      const client = fakeClient({ createRecords, updateRecord, getRecord });
      const svc = teableMirrorService(db, { client, secrets });

      const now1 = new Date("2026-09-14T00:00:00.000Z");
      await svc.syncIssue({ companyId, issue: await loadIssueInput(issueId), now: now1 });

      // Change the local status too, so the sync does not take the cheap
      // "recheck window not elapsed" shortcut and actually reads Teable.
      await db.update(issues).set({ status: "in_progress" }).where(eq(issues.id, issueId));
      const now2 = new Date("2026-09-14T00:05:00.000Z");
      const result = await svc.syncIssue({ companyId, issue: await loadIssueInput(issueId), now: now2 });

      expect(result.status).toBe("conflict");
      expect(updateRecord).not.toHaveBeenCalled(); // PC-005 AC3: never overwritten

      const actions = await activityActionsFor(issueId);
      expect(actions.map((a) => a.action)).toEqual([
        TEABLE_MIRROR_ACTIVITY_ACTIONS.created,
        TEABLE_MIRROR_ACTIVITY_ACTIONS.conflict,
      ]);

      // Re-running against the SAME unresolved remote edit must not spam a
      // second conflict entry.
      const result2 = await svc.syncIssue({ companyId, issue: await loadIssueInput(issueId), now: new Date(now2.getTime() + 5 * 60_000) });
      expect(result2.status).toBe("conflict");
      const actionsAfter = await activityActionsFor(issueId);
      expect(actionsAfter.filter((a) => a.action === TEABLE_MIRROR_ACTIVITY_ACTIONS.conflict)).toHaveLength(1);
    });

    it("does NOT flag a conflict when the remote edit was bot-authored (F-010-2's own exclusion marker)", async () => {
      const companyId = await seedCompany();
      const issueId = await seedIssue(companyId, { status: "todo" });
      const secrets = fakeSecrets({
        [TEABLE_MIRROR_TABLE_SECRET_NAME]: ALLOWLISTED_TABLE_ID,
        [TEABLE_BOT_ACCOUNT_SECRET_NAME]: BOT_ACCOUNT_NAME,
      });
      const createRecords = vi.fn(async () => ({
        ok: true as const,
        data: [teableRecord({ id: "recMirror01", lastModifiedTime: null, createdBy: BOT_ACCOUNT_NAME })],
      }));
      const updateRecord = vi.fn(async () => ({ ok: true as const, data: teableRecord() }));
      // Someone else's write attribution matches the configured bot account --
      // e.g. PC-010's agent write, or this mirror's own write from another process.
      const getRecord = vi.fn(async () => ({
        ok: true as const,
        data: teableRecord({
          id: "recMirror01",
          lastModifiedTime: "2026-09-14T02:00:00.000Z",
          lastModifiedBy: BOT_ACCOUNT_NAME,
        }),
      }));
      const client = fakeClient({ createRecords, updateRecord, getRecord });
      const svc = teableMirrorService(db, { client, secrets });

      const now1 = new Date("2026-09-14T00:00:00.000Z");
      await svc.syncIssue({ companyId, issue: await loadIssueInput(issueId), now: now1 });

      await db.update(issues).set({ status: "in_progress" }).where(eq(issues.id, issueId));
      const now2 = new Date("2026-09-14T00:05:00.000Z");
      const result = await svc.syncIssue({ companyId, issue: await loadIssueInput(issueId), now: now2 });

      expect(result.status).toBe("updated");
      expect(updateRecord).toHaveBeenCalledTimes(1);

      const actions = await activityActionsFor(issueId);
      expect(actions.map((a) => a.action)).not.toContain(TEABLE_MIRROR_ACTIVITY_ACTIONS.conflict);
    });
  });

  describe("retry-with-backoff on failure (AC4)", () => {
    it("writes an activity_log entry on failure and withholds retries until the backoff elapses", async () => {
      const companyId = await seedCompany();
      const issueId = await seedIssue(companyId);
      const secrets = fakeSecrets({ [TEABLE_MIRROR_TABLE_SECRET_NAME]: ALLOWLISTED_TABLE_ID });
      const createRecords = vi.fn(async () => ({
        ok: false as const,
        error: { code: "teable_unreachable" as const, retryable: true, status: null, message: "Teable did not respond.", attempts: 1 },
      }));
      const client = fakeClient({ createRecords });
      const svc = teableMirrorService(db, { client, secrets });

      // `computeBackoff` measures the failure streak off `activity_log.createdAt`,
      // which Postgres stamps with the REAL wall clock -- so `now` here has to
      // track real time too, not an arbitrary fixed calendar date.
      const now1 = new Date();
      const result1 = await svc.syncIssue({ companyId, issue: await loadIssueInput(issueId), now: now1 });
      expect(result1.status).toBe("failed");
      expect(createRecords).toHaveBeenCalledTimes(1);

      const actions = await activityActionsFor(issueId);
      expect(actions).toHaveLength(1);
      expect(actions[0]!.action).toBe(TEABLE_MIRROR_ACTIVITY_ACTIONS.failed);
      expect(actions[0]!.details).toMatchObject({ phase: "create", code: "teable_unreachable" });

      // Immediately retrying (before the backoff window elapses) must not call Teable again.
      const soon = new Date(now1.getTime() + 5_000);
      const result2 = await svc.syncIssue({ companyId, issue: await loadIssueInput(issueId), now: soon });
      expect(result2.status).toBe("skipped_backoff");
      expect(createRecords).toHaveBeenCalledTimes(1);

      // After the first backoff window elapses, the mirror retries.
      const delaySeconds = mirrorRetryDelaySeconds(1);
      const later = new Date(now1.getTime() + (delaySeconds + 1) * 1000);
      const result3 = await svc.syncIssue({ companyId, issue: await loadIssueInput(issueId), now: later });
      expect(result3.status).toBe("failed");
      expect(createRecords).toHaveBeenCalledTimes(2);

      const actionsAfter = await activityActionsFor(issueId);
      expect(actionsAfter.filter((a) => a.action === TEABLE_MIRROR_ACTIVITY_ACTIONS.failed)).toHaveLength(2);
    });

    it("backoff resets once a sync succeeds", async () => {
      const companyId = await seedCompany();
      const issueId = await seedIssue(companyId);
      const secrets = fakeSecrets({ [TEABLE_MIRROR_TABLE_SECRET_NAME]: ALLOWLISTED_TABLE_ID });
      let shouldFail = true;
      const createRecords = vi.fn(async () =>
        shouldFail
          ? { ok: false as const, error: { code: "teable_unreachable" as const, retryable: true, status: null, message: "down", attempts: 1 } }
          : { ok: true as const, data: [teableRecord({ id: "recMirror01" })] },
      );
      const client = fakeClient({ createRecords });
      const svc = teableMirrorService(db, { client, secrets });

      const now1 = new Date();
      await svc.syncIssue({ companyId, issue: await loadIssueInput(issueId), now: now1 });

      shouldFail = false;
      const delaySeconds = mirrorRetryDelaySeconds(1);
      const later = new Date(now1.getTime() + (delaySeconds + 1) * 1000);
      const result = await svc.syncIssue({ companyId, issue: await loadIssueInput(issueId), now: later });
      expect(result.status).toBe("created");
    });
  });

  describe("skips when not configured", () => {
    it("does nothing and calls Teable zero times when no mirror table secret is set", async () => {
      const companyId = await seedCompany();
      const issueId = await seedIssue(companyId);
      const client = fakeClient();
      const svc = teableMirrorService(db, { client, secrets: fakeSecrets({}) });

      const result = await svc.syncIssue({ companyId, issue: await loadIssueInput(issueId), now: new Date() });
      expect(result.status).toBe("skipped_not_configured");
      expect(client.createRecords).not.toHaveBeenCalled();
    });
  });
});
