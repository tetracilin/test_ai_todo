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

  it("moves activities, tasks and epics before a sibling or to the end, and renumbers", async () => {
    const svc = storyMapService(db);
    const companyId = await seedCompany();
    const a = await svc.createActivity(companyId, { name: "A" });
    await svc.createActivity(companyId, { name: "B" });
    const c = await svc.createActivity(companyId, { name: "C" });

    await svc.moveItem(companyId, "activities", c.id, { beforeId: a.id });
    expect((await svc.getTree(companyId)).activities.map((x) => x.name)).toEqual(["C", "A", "B"]);

    await svc.moveItem(companyId, "activities", c.id, {});
    const tree = await svc.getTree(companyId);
    expect(tree.activities.map((x) => x.name)).toEqual(["A", "B", "C"]);
    expect(tree.activities.map((x) => x.position)).toEqual([0, 1, 2]);

    const t1 = await svc.createTask(companyId, { activityId: a.id, name: "T1" });
    const t2 = await svc.createTask(companyId, { activityId: a.id, name: "T2" });
    await svc.moveItem(companyId, "tasks", t2.id, { beforeId: t1.id });
    expect((await svc.getTree(companyId)).tasks.map((x) => x.name)).toEqual(["T2", "T1"]);

    const e1 = await svc.createEpic(companyId, { taskId: t1.id, name: "E1" });
    await svc.createEpic(companyId, { taskId: t1.id, name: "E2" });
    await svc.moveItem(companyId, "epics", e1.id, {});
    expect((await svc.getTree(companyId)).epics.map((x) => x.name)).toEqual(["E2", "E1"]);
  });

  it("moves a story to a release and places it among the stories of that release", async () => {
    const svc = storyMapService(db);
    const companyId = await seedCompany();
    const activity = await svc.createActivity(companyId, { name: "Plan work" });
    const task = await svc.createTask(companyId, { activityId: activity.id, name: "Create project" });
    const release = await svc.createRelease(companyId, { name: "Release 1" });
    const first = await svc.createStory(companyId, { taskId: task.id, releaseId: release.id, title: "First" });
    const loose = await svc.createStory(companyId, { taskId: task.id, title: "Loose" });
    const second = await svc.createStory(companyId, { taskId: task.id, releaseId: release.id, title: "Second" });

    // No target: goes after the last story already in Release 1.
    const moved = await svc.moveItem(companyId, "stories", loose.id, { releaseId: release.id });
    expect((moved as { releaseId: string | null }).releaseId).toBe(release.id);
    let stories = (await svc.getTree(companyId)).stories;
    expect(stories.filter((s) => s.releaseId === release.id).map((s) => s.title)).toEqual(["First", "Second", "Loose"]);

    // Before a target: lands in front of it.
    await svc.moveItem(companyId, "stories", loose.id, { beforeId: first.id, releaseId: release.id });
    stories = (await svc.getTree(companyId)).stories;
    expect(stories.map((s) => s.title)).toEqual(["Loose", "First", "Second"]);

    // Back to Unscheduled.
    await svc.moveItem(companyId, "stories", second.id, { releaseId: null });
    stories = (await svc.getTree(companyId)).stories;
    expect(stories.find((s) => s.id === second.id)?.releaseId).toBeNull();
  });

  it("keeps the saved order after a reload and rejects bad moves", async () => {
    const svc = storyMapService(db);
    const companyId = await seedCompany();
    const other = await seedCompany();
    const a = await svc.createActivity(companyId, { name: "First step" });
    const b = await svc.createActivity(companyId, { name: "Second step" });
    const foreign = await svc.createActivity(other, { name: "Foreign" });

    await svc.moveItem(companyId, "activities", b.id, { beforeId: a.id });
    // A fresh service instance reads the same order: it is stored, not held in memory.
    const names = (await storyMapService(db).getTree(companyId)).activities.map((x) => x.name);
    expect(names).toEqual(["Second step", "First step"]);

    await expect(svc.moveItem(companyId, "activities", a.id, { beforeId: foreign.id })).rejects.toThrow(/sibling/);
    await expect(svc.moveItem(companyId, "activities", a.id, { beforeId: a.id })).rejects.toThrow(/itself/);
    await expect(svc.moveItem(other, "activities", a.id, {})).rejects.toThrow(/not found/i);
    await expect(svc.moveItem(companyId, "activities", a.id, { releaseId: null })).rejects.toThrow(/story/i);
    await expect(
      svc.moveItem(companyId, "stories", a.id, { releaseId: "99999999-9999-4999-8999-999999999999" }),
    ).rejects.toThrow(/not found/i);
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

  it("promotes a note into the Unscheduled row under a fixed idea column, once", async () => {
    const svc = storyMapService(db);
    const companyId = await seedCompany();
    const note = await svc.createScratchNote(companyId, "u1", { body: "Export the board as PDF\nSo I can share it" });

    const { note: promoted, story } = await svc.promoteScratchNote(companyId, note.id);
    expect(promoted.status).toBe("promoted");
    expect(promoted.promotedStoryId).toBe(story.id);
    expect(story.title).toBe("Export the board as PDF");
    expect(story.description).toContain("So I can share it");
    expect(story.releaseId).toBeNull();

    const tree = await svc.getTree(companyId);
    expect(tree.activities.map((a) => a.name)).toEqual(["Scratch pad ideas"]);
    expect(tree.tasks.map((t) => t.name)).toEqual(["Promoted ideas"]);
    expect(tree.stories.map((s) => s.id)).toEqual([story.id]);

    // A second note reuses the same activity and task.
    const other = await svc.createScratchNote(companyId, "u2", { body: "Dark mode" });
    await svc.promoteScratchNote(companyId, other.id);
    const again = await svc.getTree(companyId);
    expect(again.activities).toHaveLength(1);
    expect(again.tasks).toHaveLength(1);
    expect(again.stories).toHaveLength(2);

    // The same note cannot be promoted twice.
    await expect(svc.promoteScratchNote(companyId, note.id)).rejects.toThrow(/active/);
  });

  it("promotes a note once when two requests arrive together, and reports the parents it created", async () => {
    const svc = storyMapService(db);
    const companyId = await seedCompany();
    const note = await svc.createScratchNote(companyId, "u1", { body: "Export the board as PDF" });

    const results = await Promise.allSettled([
      svc.promoteScratchNote(companyId, note.id),
      svc.promoteScratchNote(companyId, note.id),
      svc.promoteScratchNote(companyId, note.id),
    ]);
    const done = results.filter((r) => r.status === "fulfilled");
    expect(done).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(2);

    const tree = await svc.getTree(companyId);
    expect(tree.stories).toHaveLength(1);
    expect(tree.activities).toHaveLength(1);
    expect(tree.tasks).toHaveLength(1);
    const first = (done[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof svc.promoteScratchNote>>>).value;
    expect(first.note.promotedStoryId).toBe(tree.stories[0]!.id);
    expect(first.createdParents.activity?.name).toBe("Scratch pad ideas");
    expect(first.createdParents.task?.name).toBe("Promoted ideas");

    // The column exists now: a later promotion creates no parents.
    const other = await svc.createScratchNote(companyId, "u2", { body: "Dark mode" });
    const second = await svc.promoteScratchNote(companyId, other.id);
    expect(second.createdParents).toEqual({ activity: null, task: null });
  });

  it("creates the idea column once when different notes are promoted together", async () => {
    const svc = storyMapService(db);
    const companyId = await seedCompany();
    const notes = await Promise.all(
      ["One", "Two", "Three"].map((body, index) => svc.createScratchNote(companyId, `u${index}`, { body })),
    );
    await Promise.all(notes.map((note) => svc.promoteScratchNote(companyId, note.id)));
    const tree = await svc.getTree(companyId);
    expect(tree.activities).toHaveLength(1);
    expect(tree.tasks).toHaveLength(1);
    expect(tree.stories).toHaveLength(3);
  });

  it("keeps positions unique when several moves run together", async () => {
    const svc = storyMapService(db);
    const companyId = await seedCompany();
    const items = [];
    for (const name of ["A", "B", "C", "D", "E"]) items.push(await svc.createActivity(companyId, { name }));

    await Promise.all([
      svc.moveItem(companyId, "activities", items[4]!.id, { beforeId: items[0]!.id }),
      svc.moveItem(companyId, "activities", items[3]!.id, { beforeId: items[0]!.id }),
      svc.moveItem(companyId, "activities", items[0]!.id, {}),
      svc.moveItem(companyId, "activities", items[2]!.id, { beforeId: items[1]!.id }),
    ]);

    const activities = (await svc.getTree(companyId)).activities;
    expect(activities).toHaveLength(5);
    expect(activities.map((a) => a.position).sort()).toEqual([0, 1, 2, 3, 4]);
    expect(new Set(activities.map((a) => a.id)).size).toBe(5);
  });

  it("archives a note and refuses to promote it afterwards", async () => {
    const svc = storyMapService(db);
    const companyId = await seedCompany();
    const note = await svc.createScratchNote(companyId, "u1", { body: "Old idea" });

    const archived = await svc.archiveScratchNote(companyId, note.id);
    expect(archived.status).toBe("archived");
    expect((await svc.archiveScratchNote(companyId, note.id)).status).toBe("archived");
    await expect(svc.promoteScratchNote(companyId, note.id)).rejects.toThrow(/active/);
  });

  it("cannot promote or archive another company's note", async () => {
    const svc = storyMapService(db);
    const companyA = await seedCompany();
    const companyB = await seedCompany();
    const note = await svc.createScratchNote(companyA, "u1", { body: "Private idea" });
    await expect(svc.promoteScratchNote(companyB, note.id)).rejects.toThrow(/not found/i);
    await expect(svc.archiveScratchNote(companyB, note.id)).rejects.toThrow(/not found/i);
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
