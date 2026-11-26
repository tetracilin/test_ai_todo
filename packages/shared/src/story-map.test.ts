import { describe, expect, it } from "vitest";
import {
  SCRATCH_NOTE_MAX_LENGTH,
  STORY_MAP_MAX_POSITION,
  createStoryMapActivitySchema,
  updateStoryMapActivitySchema,
  createScratchNoteSchema,
  createStoryMapReleaseSchema,
  createStoryMapStorySchema,
  updateScratchNoteSchema,
  updateStoryMapStorySchema,
} from "./index.js";

const ID = "11111111-1111-4111-8111-111111111111";

describe("scratch note schema", () => {
  it("accepts plain text up to the limit", () => {
    expect(createScratchNoteSchema.safeParse({ body: "x".repeat(SCRATCH_NOTE_MAX_LENGTH) }).success).toBe(true);
  });

  it("rejects text over the limit, empty text and blank text", () => {
    expect(createScratchNoteSchema.safeParse({ body: "x".repeat(SCRATCH_NOTE_MAX_LENGTH + 1) }).success).toBe(false);
    expect(createScratchNoteSchema.safeParse({ body: "" }).success).toBe(false);
    expect(updateScratchNoteSchema.safeParse({ body: "   " }).success).toBe(false);
  });
});

describe("story map schemas", () => {
  it("requires a task for a story and trims the title", () => {
    expect(createStoryMapStorySchema.safeParse({ title: "A story" }).success).toBe(false);
    const parsed = createStoryMapStorySchema.parse({ taskId: ID, title: "  A story  " });
    expect(parsed.title).toBe("A story");
  });

  it("allows a story to be moved back to Unscheduled with a null release", () => {
    expect(updateStoryMapStorySchema.safeParse({ releaseId: null }).success).toBe(true);
  });

  it("rejects an empty story update and an unknown status", () => {
    expect(updateStoryMapStorySchema.safeParse({}).success).toBe(false);
    expect(updateStoryMapStorySchema.safeParse({ status: "finished" }).success).toBe(false);
  });

  it("accepts a release target date only as a calendar date", () => {
    expect(createStoryMapReleaseSchema.safeParse({ name: "Release 1", targetDate: "2026-12-31" }).success).toBe(true);
    expect(createStoryMapReleaseSchema.safeParse({ name: "Release 1", targetDate: "next week" }).success).toBe(false);
    expect(createStoryMapReleaseSchema.safeParse({ name: "Release 1" }).success).toBe(true);
  });
  it("caps positions so they fit a Postgres integer and an append cannot overflow", () => {
    expect(createStoryMapActivitySchema.safeParse({ name: "A", position: STORY_MAP_MAX_POSITION }).success).toBe(true);
    expect(createStoryMapActivitySchema.safeParse({ name: "A", position: STORY_MAP_MAX_POSITION + 1 }).success).toBe(false);
    expect(createStoryMapActivitySchema.safeParse({ name: "A", position: 3_000_000_000 }).success).toBe(false);
    expect(updateStoryMapActivitySchema.safeParse({ position: 2147483647 }).success).toBe(false);
    expect(createStoryMapActivitySchema.safeParse({ name: "A", position: -1 }).success).toBe(false);
  });
});
