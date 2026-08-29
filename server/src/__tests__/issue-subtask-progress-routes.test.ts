import { randomUUID } from "node:crypto";
import request from "supertest";
import { expect, it } from "vitest";
import { issues } from "@paperclipai/db";
import { issueRoutes } from "../routes/issues.js";
import {
  describeEmbeddedPostgres,
  resetCompanyIssueFixtures,
  routeApp,
  seedCompanyWithBoardAccess,
  useEmbeddedPostgres,
} from "./helpers/route-test-harness.js";

describeEmbeddedPostgres("issue subtask progress and ordering", () => {
  const ctx = useEmbeddedPostgres("paperclip-issue-subtask-progress-", {
    resetEach: resetCompanyIssueFixtures,
  });

  async function seed() {
    const company = await seedCompanyWithBoardAccess(ctx.db, "Subtask progress");
    const companyId = company.companyId;
    const parentId = randomUUID();
    const childA = randomUUID();
    const childB = randomUUID();
    const childC = randomUUID();

    await ctx.db.insert(issues).values([
      { id: parentId, companyId, title: "Parent", status: "todo", priority: "medium" },
    ]);
    await ctx.db.insert(issues).values([
      {
        id: childA,
        companyId,
        title: "A",
        status: "todo",
        priority: "medium",
        parentId,
        progress: 50,
        sortOrder: 2,
      },
      {
        id: childB,
        companyId,
        title: "B",
        status: "in_progress",
        priority: "medium",
        parentId,
        progress: 100,
        sortOrder: 0,
      },
      {
        id: childC,
        companyId,
        title: "C",
        status: "todo",
        priority: "medium",
        parentId,
        progress: 100,
        sortOrder: 1,
      },
    ]);

    return { ...company, parentId, childA, childB, childC };
  }

  type Seeded = Awaited<ReturnType<typeof seed>>;

  function appFor(seeded: Seeded) {
    return routeApp(ctx.db, seeded.actor, issueRoutes);
  }

  it("lists subtasks ordered by sortOrder and exposes progress/sortOrder", async () => {
    const seeded = await seed();
    const res = await request(appFor(seeded))
      .get(`/api/issues/${seeded.parentId}/subtasks`)
      .expect(200);
    const body = res.body as Array<{ id: string; sortOrder: number; progress: number }>;
    expect(body.map((child) => child.id)).toEqual([seeded.childB, seeded.childC, seeded.childA]);
    expect(body.map((child) => child.sortOrder)).toEqual([0, 1, 2]);
    expect(body.map((child) => child.progress)).toEqual([100, 100, 50]);
  });

  it("aggregates parent progress from direct children", async () => {
    const seeded = await seed();
    const res = await request(appFor(seeded))
      .get(`/api/issues/${seeded.parentId}/subtasks/progress`)
      .expect(200);
    // children progress: 50, 100, 100 -> total 3, completed 2, mean 250/3 = 83
    expect(res.body).toEqual({ total: 3, completed: 2, progress: 83 });
  });

  it("returns zero progress for a parent with no children", async () => {
    const seeded = await seed();
    const lonelyId = randomUUID();
    await ctx.db.insert(issues).values([
      { id: lonelyId, companyId: seeded.companyId, title: "Lonely", status: "todo", priority: "medium" },
    ]);
    const res = await request(appFor(seeded))
      .get(`/api/issues/${lonelyId}/subtasks/progress`)
      .expect(200);
    expect(res.body).toEqual({ total: 0, completed: 0, progress: 0 });
  });

  it("creates a subtask under a parent with progress and sortOrder", async () => {
    const seeded = await seed();
    const res = await request(appFor(seeded))
      .post(`/api/issues/${seeded.parentId}/children`)
      .send({ title: "New subtask", progress: 25, sortOrder: 3 })
      .expect(201);
    const issue = res.body as {
      id: string;
      parentId: string | null;
      progress: number;
      sortOrder: number;
    };
    expect(issue.parentId).toBe(seeded.parentId);
    expect(issue.progress).toBe(25);
    expect(issue.sortOrder).toBe(3);
  });

  it("updates subtask status and progress via PATCH", async () => {
    const seeded = await seed();
    const updated = await request(appFor(seeded))
      .patch(`/api/issues/${seeded.childA}`)
      .send({ status: "done", progress: 90 })
      .expect(200);
    expect((updated.body as { status: string; progress: number })).toMatchObject({
      status: "done",
      progress: 90,
    });
    const res = await request(appFor(seeded))
      .get(`/api/issues/${seeded.childA}`)
      .expect(200);
    expect(res.body).toMatchObject({ status: "done", progress: 90 });
  });
});
