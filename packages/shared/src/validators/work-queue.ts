import { z } from "zod";
import { WORK_QUEUE_ITEM_STATUSES } from "../constants.js";

export const workQueueItemStatusSchema = z.enum(WORK_QUEUE_ITEM_STATUSES);

export const createWorkQueueSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
});

export type CreateWorkQueue = z.infer<typeof createWorkQueueSchema>;

export const createWorkQueueItemSchema = z.object({
  title: z.string().min(1),
  body: z.string().optional().nullable(),
  sourceLabel: z.string().max(80).optional().nullable(),
});

export type CreateWorkQueueItem = z.infer<typeof createWorkQueueItemSchema>;

export const promoteWorkQueueItemSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  projectId: z.string().guid().optional().nullable(),
});

export type PromoteWorkQueueItem = z.infer<typeof promoteWorkQueueItemSchema>;

export const dismissWorkQueueItemSchema = z.object({
  reason: z.string().optional().nullable(),
});

export type DismissWorkQueueItem = z.infer<typeof dismissWorkQueueItemSchema>;
