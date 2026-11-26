import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { companies, createDb, scratchNotes, storyMaps } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { storyMapService } from "../services/story-map.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("story map service", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-story-map-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    // Deleting the maps and companies cascades to every story map table.
    await db.delete(scratchNotes);
    await db.delete(storyMaps);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompany() {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    return companyId;
  }

  it("returns an empty tree until the first item is written, then keeps one map", async () => {
    const svc = storyMapService(db);
    const companyId = await seedCompany();
    expect((await svc.getTree(companyId)).map).toBeNull();

    await svc.createActivity(companyId, { name: "Plan work" });
    await svc.createRelease(companyId, { name: "Release 1", targetDate: "2026-12-31" });
    const tree = await svc.getTree(companyId);
    expect(tree.map?.companyId).toBe(companyId);
    expect(tree.activities).toHaveLength(1);
    expect(tree.releases[0]?.targetDate).toBe("2026-12-31");
    expect(await db.select().from(storyMaps)).toHaveLength(1);
  });

  it("appends new siblings after the last one and honours an explicit position", async () => {
    const svc = storyMapService(db);
    const companyId = await seedCompany();
    const first = await svc.createActivity(companyId, { name: "First step" });
    const second = await svc.createActivity(companyId, { name: "Second step" });
    const forced = await svc.createActivity(companyId, { name: "Pinned", position: 0 });
    expect([first.position, second.position, forced.position]).toEqual([0, 1, 0]);

    const tree = await svc.getTree(companyId);
    expect(tree.activities.map((a) => a.name)).toEqual(["First step", "Pinned", "Second step"]);
  });

  it("builds four levels and keeps an epic optional", async () => {
    const svc = storyMapService(db);
    const companyId = await seedCompany();
    const activity = await svc.createActivity(companyId, { name: "Plan work" });
    const task = await svc.createTask(companyId, { activityId: activity.id, name: "Create project" });
    const epic = await svc.createEpic(companyId, { taskId: task.id, name: "Project templates" });
    const inEpic = await svc.createStory(companyId, { taskId: task.id, epicId: epic.id, title: "Pick a template" });
    const loose = await svc.createStory(companyId, { taskId: task.id, title: "Rename a project" });

    expect(inEpic.epicId).toBe(epic.id);
    expect(loose.epicId).toBeNull();
    expect(inEpic.releaseId).toBeNull();
    expect(inEpic.status).toBe("planned");
    expect(inEpic.position).toBeLessThan(loose.position);
  });

  it("rejects an epic that belongs to another task", async () => {
    const svc = storyMapService(db);
    const companyId = await seedCompany();
    const activity = await svc.createActivity(companyId, { name: "Plan work" });
    const taskA = await svc.createTask(companyId, { activityId: activity.id, name: "A" });
    const taskB = await svc.createTask(companyId, { activityId: activity.id, name: "B" });
    const epicOfA = await svc.createEpic(companyId, { taskId: taskA.id, name: "Epic of A" });

    await expect(
      svc.createStory(companyId, { taskId: taskB.id, epicId: epicOfA.id, title: "Wrong epic" }),
    ).rejects.toThrow(/different task/);
  });

  it("returns stories to Unscheduled when their release is deleted and keeps them when their epic is deleted", async () => {
    const svc = storyMapService(db);
    const companyId = await seedCompany();
    const activity = await svc.createActivity(companyId, { name: "Plan work" });
    const task = await svc.createTask(companyId, { activityId: activity.id, name: "Create project" });
    const epic = await svc.createEpic(companyId, { taskId: task.id, name: "Project templates" });
    const release = await svc.createRelease(companyId, { name: "Release 1" });
    const story = await svc.createStory(companyId, {
      taskId: task.id,
      epicId: epic.id,
      releaseId: release.id,
      title: "Pick a template",
    });

    await svc.deleteRelease(companyId, release.id);
    await svc.deleteEpic(companyId, epic.id);

    const [kept] = (await svc.getTree(companyId)).stories;
    expect(kept?.id).toBe(story.id);
    expect(kept?.releaseId).toBeNull();
    expect(kept?.epicId).toBeNull();
  });

  it("deletes everything below an activity", async () => {
    const svc = storyMapService(db);
    const companyId = await seedCompany();
    const activity = await svc.createActivity(companyId, { name: "Plan work" });
    const task = await svc.createTask(companyId, { activityId: activity.id, name: "Create project" });
    await svc.createStory(companyId, { taskId: task.id, title: "Pick a template" });

    await svc.deleteActivity(companyId, activity.id);
    const tree = await svc.getTree(companyId);
    expect(tree.activities).toHaveLength(0);
    expect(tree.tasks).toHaveLength(0);
    expect(tree.stories).toHaveLength(0);
  });

  it("never reads or changes another company's items", async () => {
    const svc = storyMapService(db);
    const companyA = await seedCompany();
    const companyB = await seedCompany();
    const activity = await svc.createActivity(companyA, { name: "Plan work" });
    const task = await svc.createTask(companyA, { activityId: activity.id, name: "Create project" });

    expect((await svc.getTree(companyB)).map).toBeNull();
    await expect(svc.createTask(companyB, { activityId: activity.id, name: "Intruder" })).rejects.toThrow(/not found/i);
    await expect(svc.updateTask(companyB, task.id, { name: "Hijacked" })).rejects.toThrow(/not found/i);
    await expect(svc.deleteActivity(companyB, activity.id)).rejects.toThrow(/not found/i);
    expect((await svc.getTree(companyA)).tasks[0]?.name).toBe("Create project");
  });

  it("lets only the author edit or delete a scratch note", async () => {
    const svc = storyMapService(db);
    const companyId = await seedCompany();
    const note = await svc.createScratchNote(companyId, "author-1", { body: "Dark mode for every page" });

    await expect(svc.updateScratchNote(companyId, note.id, "someone-else", { body: "Hijacked" })).rejects.toThrow(
      /author/i,
    );
    await expect(svc.deleteScratchNote(companyId, note.id, "someone-else")).rejects.toThrow(/author/i);

    const edited = await svc.updateScratchNote(companyId, note.id, "author-1", { body: "Edited" });
    expect(edited.body).toBe("Edited");
    expect(edited.authorUserId).toBe("author-1");
    expect(edited.status).toBe("active");

    await svc.deleteScratchNote(companyId, note.id, "author-1");
    expect(await svc.listScratchNotes(companyId)).toHaveLength(0);
  });

  it("lists scratch notes newest first and only for their own company", async () => {
    const svc = storyMapService(db);
    const companyA = await seedCompany();
    const companyB = await seedCompany();
    await svc.createScratchNote(companyA, "u1", { body: "older" });
    await svc.createScratchNote(companyA, "u2", { body: "newer" });
    await svc.createScratchNote(companyB, "u3", { body: "other company" });

    expect((await svc.listScratchNotes(companyA)).map((n) => n.body)).toEqual(["newer", "older"]);
    expect(await svc.listScratchNotes(companyB)).toHaveLength(1);
  });
});
