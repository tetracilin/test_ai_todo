import { z } from "zod";
import { ISSUE_PRIORITIES } from "../constants.js";

export const schedulingRoutineStatusSchema = z.enum(["active", "paused"]);

export const schedulingRecurrenceRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("daily") }),
  z.object({
    kind: z.literal("weekly"),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  }),
]);

export const schedulingTimeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "scheduledTime must be in HH:MM 24-hour format");

export const upsertIssueSchedulingSchema = z
  .object({
    scheduledAt: z.coerce.date().nullable().optional(),
    deferUntil: z.coerce.date().nullable().optional(),
    scheduledDurationMinutes: z.number().int().min(1).max(24 * 60).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one scheduling field is required",
  });

export const createSchedulingRoutineSchema = z.object({
  projectId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10000).nullable().optional(),
  assigneeAgentId: z.string().uuid().nullable().optional(),
  assigneeUserId: z.string().trim().min(1).nullable().optional(),
  priority: z.enum(ISSUE_PRIORITIES).optional(),
  recurrenceRule: schedulingRecurrenceRuleSchema,
  timezone: z.string().trim().min(1).max(100).optional(),
  scheduledTime: schedulingTimeOfDaySchema.nullable().optional(),
  estimateMinutes: z.number().int().min(1).max(24 * 60).nullable().optional(),
}).refine((value) => !(value.assigneeAgentId && value.assigneeUserId), {
  message: "Scheduling routine can only have one assignee",
});

export const updateSchedulingRoutineSchema = z
  .object({
    projectId: z.string().uuid().nullable().optional(),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(10000).nullable().optional(),
    assigneeAgentId: z.string().uuid().nullable().optional(),
    assigneeUserId: z.string().trim().min(1).nullable().optional(),
    priority: z.enum(ISSUE_PRIORITIES).optional(),
    status: schedulingRoutineStatusSchema.optional(),
    recurrenceRule: schedulingRecurrenceRuleSchema.optional(),
    timezone: z.string().trim().min(1).max(100).optional(),
    scheduledTime: schedulingTimeOfDaySchema.nullable().optional(),
    estimateMinutes: z.number().int().min(1).max(24 * 60).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one scheduling routine field is required",
  })
  .refine((value) => !(value.assigneeAgentId && value.assigneeUserId), {
    message: "Scheduling routine can only have one assignee",
  });

export const generateSchedulingRoutineIssuesSchema = z.object({
  asOf: z.coerce.date().optional(),
  maxDays: z.number().int().min(1).max(60).optional(),
});

export type UpsertIssueScheduling = z.infer<typeof upsertIssueSchedulingSchema>;
export type CreateSchedulingRoutine = z.infer<typeof createSchedulingRoutineSchema>;
export type UpdateSchedulingRoutine = z.infer<typeof updateSchedulingRoutineSchema>;
export type GenerateSchedulingRoutineIssues = z.infer<typeof generateSchedulingRoutineIssuesSchema>;
