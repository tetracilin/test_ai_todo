import { describe, expect, it } from "vitest";
import {
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
