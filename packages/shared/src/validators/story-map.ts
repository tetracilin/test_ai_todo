import { z } from "zod";
import { SCRATCH_NOTE_MAX_LENGTH, STORY_MAP_STORY_STATUSES } from "../types/story-map.js";

const id = z.string().guid();
const name = z.string().trim().min(1).max(200);
const longText = z.string().trim().max(10000);
const position = z.number().int().min(0);

export const storyMapStoryStatusSchema = z.enum(STORY_MAP_STORY_STATUSES);

export const createStoryMapActivitySchema = z.object({
  name,
  position: position.optional().nullable(),
});
export const updateStoryMapActivitySchema = z
  .object({ name: name.optional(), position: position.optional() })
  .refine((v) => Object.keys(v).length > 0, { message: "At least one activity field is required" });

export const createStoryMapTaskSchema = z.object({
  activityId: id,
  name,
  position: position.optional().nullable(),
});
export const updateStoryMapTaskSchema = z
  .object({ name: name.optional(), position: position.optional() })
  .refine((v) => Object.keys(v).length > 0, { message: "At least one task field is required" });

export const createStoryMapReleaseSchema = z.object({
  name,
  targetDate: z.string().date().optional().nullable(),
  position: position.optional().nullable(),
});
export const updateStoryMapReleaseSchema = z
  .object({
    name: name.optional(),
    targetDate: z.string().date().optional().nullable(),
    position: position.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "At least one release field is required" });

export const createStoryMapEpicSchema = z.object({
  taskId: id,
  name,
  description: longText.optional().nullable(),
  position: position.optional().nullable(),
});
export const updateStoryMapEpicSchema = z
  .object({
    name: name.optional(),
    description: longText.optional().nullable(),
    position: position.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "At least one epic field is required" });

export const createStoryMapStorySchema = z.object({
  taskId: id,
  epicId: id.optional().nullable(),
  releaseId: id.optional().nullable(),
  title: name,
  description: longText.optional().nullable(),
  acceptanceCriteria: longText.optional().nullable(),
  size: z.string().trim().min(1).max(40).optional().nullable(),
  status: storyMapStoryStatusSchema.optional(),
  position: position.optional().nullable(),
});
export const updateStoryMapStorySchema = z
  .object({
    epicId: id.optional().nullable(),
    releaseId: id.optional().nullable(),
    title: name.optional(),
    description: longText.optional().nullable(),
    acceptanceCriteria: longText.optional().nullable(),
    size: z.string().trim().min(1).max(40).optional().nullable(),
    status: storyMapStoryStatusSchema.optional(),
    position: position.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "At least one story field is required" });

const scratchNoteBody = z.string().trim().min(1).max(SCRATCH_NOTE_MAX_LENGTH);
export const createScratchNoteSchema = z.object({ body: scratchNoteBody });
export const updateScratchNoteSchema = z.object({ body: scratchNoteBody });

export type CreateStoryMapActivity = z.infer<typeof createStoryMapActivitySchema>;
export type UpdateStoryMapActivity = z.infer<typeof updateStoryMapActivitySchema>;
export type CreateStoryMapTask = z.infer<typeof createStoryMapTaskSchema>;
export type UpdateStoryMapTask = z.infer<typeof updateStoryMapTaskSchema>;
export type CreateStoryMapRelease = z.infer<typeof createStoryMapReleaseSchema>;
export type UpdateStoryMapRelease = z.infer<typeof updateStoryMapReleaseSchema>;
export type CreateStoryMapEpic = z.infer<typeof createStoryMapEpicSchema>;
export type UpdateStoryMapEpic = z.infer<typeof updateStoryMapEpicSchema>;
export type CreateStoryMapStory = z.infer<typeof createStoryMapStorySchema>;
export type UpdateStoryMapStory = z.infer<typeof updateStoryMapStorySchema>;
export type CreateScratchNote = z.infer<typeof createScratchNoteSchema>;
export type UpdateScratchNote = z.infer<typeof updateScratchNoteSchema>;
