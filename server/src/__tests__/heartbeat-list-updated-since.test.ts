import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb, heartbeatRuns } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { heartbeatService } from "../services/heartbeat.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres heartbeat list updatedSince tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("heartbeat.list with updatedSince", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-heartbeat-updated-since-");
    db = createDb(tempDb.connectionString);
  }, 90_000);

  afterEach(async () => {
    await db.delete(heartbeatRuns);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("filters runs by updatedSince and orders ascending by updatedAt", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();

    await db.insert(companies).values({ id: companyId, name: "Test Company" });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "test-agent",
      adapterType: "claude-local",
    });

    // Create runs with specific timestamps - created newest-first, but updated oldest-first
    const now = new Date();
    const run1 = randomUUID();
    const run2 = randomUUID();
    const run3 = randomUUID();

    await db.insert(heartbeatRuns).values([
      {
        id: run1,
        companyId,
        agentId,
        status: "completed",
        invocationSource: "api",
        createdAt: new Date(now.getTime() - 3000), // created first
        updatedAt: new Date(now.getTime() - 1000), // updated last
      },
      {
        id: run2,
        companyId,
        agentId,
        status: "completed",
        invocationSource: "api",
        createdAt: new Date(now.getTime() - 2000), // created second
        updatedAt: new Date(now.getTime() - 2000), // updated middle
      },
      {
        id: run3,
        companyId,
        agentId,
        status: "completed",
        invocationSource: "api",
        createdAt: new Date(now.getTime() - 1000), // created last
        updatedAt: new Date(now.getTime() - 3000), // updated first
      },
    ]);

    const heartbeat = heartbeatService(db);

    // Without updatedSince: should return newest-first by createdAt (run3, run2, run1)
    const allRuns = await heartbeat.list(companyId, agentId);
    expect(allRuns.map((r) => r.id)).toEqual([run3, run2, run1]);

    // With updatedSince: should return ascending by updatedAt, filtered
    const cursor = new Date(now.getTime() - 2500);
    const filteredRuns = await heartbeat.list(companyId, agentId, undefined, {
      updatedSince: cursor,
    });

    // Should return run2 and run1 (run3's updatedAt is before cursor)
    // Ordered ascending by updatedAt: run2 (-2000ms), then run1 (-1000ms)
    expect(filteredRuns.map((r) => r.id)).toEqual([run2, run1]);
  });

  it("handles limit correctly with updatedSince ordering", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();

    await db.insert(companies).values({ id: companyId, name: "Test Company" });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "test-agent",
      adapterType: "claude-local",
    });

    const now = new Date();
    const runs = [randomUUID(), randomUUID(), randomUUID()];

    await db.insert(heartbeatRuns).values(
      runs.map((id, i) => ({
        id,
        companyId,
        agentId,
        status: "completed" as const,
        invocationSource: "api" as const,
        createdAt: new Date(now.getTime() - (3 - i) * 1000),
        updatedAt: new Date(now.getTime() - (3 - i) * 1000),
      })),
    );

    const heartbeat = heartbeatService(db);
    const cursor = new Date(now.getTime() - 4000);

    // With limit: 2, should return first 2 in ascending order
    const limited = await heartbeat.list(companyId, agentId, 2, {
      updatedSince: cursor,
    });

    expect(limited).toHaveLength(2);
    expect(limited.map((r) => r.id)).toEqual([runs[0], runs[1]]);
  });
});
