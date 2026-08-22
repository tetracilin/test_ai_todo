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

export const schedulingTimezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((timezone) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
      return true;
    } catch {
      return false;
    }
  }, "timezone must be a valid IANA time zone");

const schedulingDateSchema = z.preprocess((value) => {
  if (value instanceof Date) return value;
  if (typeof value !== "string") return value;
  const normalized = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(
    normalized,
  );
  if (!match) return value;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day
  ) {
    return value;
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? value : parsed;
}, z.date());

export const upsertIssueSchedulingSchema = z
  .object({
    scheduledAt: schedulingDateSchema.nullable().optional(),
    deferUntil: schedulingDateSchema.nullable().optional(),
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
  timezone: schedulingTimezoneSchema.optional(),
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
    timezone: schedulingTimezoneSchema.optional(),
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
  asOf: schedulingDateSchema.optional(),
  maxDays: z.number().int().min(1).max(60).optional(),
});

export type UpsertIssueScheduling = z.infer<typeof upsertIssueSchedulingSchema>;
export type CreateSchedulingRoutine = z.infer<typeof createSchedulingRoutineSchema>;
export type UpdateSchedulingRoutine = z.infer<typeof updateSchedulingRoutineSchema>;
export type GenerateSchedulingRoutineIssues = z.infer<typeof generateSchedulingRoutineIssuesSchema>;
