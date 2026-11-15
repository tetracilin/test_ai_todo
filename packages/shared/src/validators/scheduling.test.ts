import { describe, expect, it } from "vitest";
import {
  createScheduledIssueSchema,
  createSchedulingRoutineSchema,
  generateSchedulingRoutineIssuesSchema,
  updateSchedulingRoutineSchema,
  upsertIssueSchedulingSchema,
} from "./scheduling.js";

describe("scheduling routine validators", () => {
  it("rejects invalid IANA timezones on create and update", () => {
    expect(
      createSchedulingRoutineSchema.safeParse({
        title: "Daily task",
        recurrenceRule: { kind: "daily" },
        timezone: "Mars/Olympus_Mons",
      }).success,
    ).toBe(false);
    expect(updateSchedulingRoutineSchema.safeParse({ timezone: "Not a timezone" }).success).toBe(false);
  });

  it("accepts canonical IANA timezones and UTC", () => {
    for (const timezone of ["UTC", "America/New_York", "Asia/Ho_Chi_Minh"]) {
      expect(
        createSchedulingRoutineSchema.safeParse({
          title: "Daily task",
          recurrenceRule: { kind: "daily" },
          timezone,
        }).success,
      ).toBe(true);
    }
  });

  it("rejects normalized and timezone-less scheduling dates", () => {
    for (const input of [
      { schema: upsertIssueSchedulingSchema, value: { scheduledAt: "2026-02-30T00:00:00Z" } },
      { schema: upsertIssueSchedulingSchema, value: { deferUntil: "2026-08-22T09:00:00" } },
      { schema: generateSchedulingRoutineIssuesSchema, value: { asOf: "2026-02-30T00:00:00Z" } },
      { schema: generateSchedulingRoutineIssuesSchema, value: { asOf: "2026-08-22T09:00:00" } },
    ]) {
      expect(input.schema.safeParse(input.value).success).toBe(false);
    }
  });
});

describe("createScheduledIssueSchema", () => {
  it("accepts a title with an estimate and trims the title", () => {
    const parsed = createScheduledIssueSchema.parse({ title: "  Write report  ", estimateMinutes: 30 });
    expect(parsed.title).toBe("Write report");
    expect(parsed.estimateMinutes).toBe(30);
  });

  it("rejects an empty or whitespace-only title", () => {
    expect(createScheduledIssueSchema.safeParse({ title: "" }).success).toBe(false);
    expect(createScheduledIssueSchema.safeParse({ title: "   " }).success).toBe(false);
  });

  it("rejects an estimate outside 1 to 1440 minutes and a non-uuid clientRequestId", () => {
    expect(createScheduledIssueSchema.safeParse({ title: "x", estimateMinutes: 0 }).success).toBe(false);
    expect(createScheduledIssueSchema.safeParse({ title: "x", estimateMinutes: 1441 }).success).toBe(false);
    expect(createScheduledIssueSchema.safeParse({ title: "x", clientRequestId: "abc" }).success).toBe(false);
  });
});
