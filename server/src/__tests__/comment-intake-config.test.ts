import { describe, expect, it } from "vitest";
import { resolveCommentIntakeOptions } from "../config.js";

const DEFAULTS = {
  enabled: true,
  pollIntervalMs: 300_000,
  batchSize: 100,
  runTimeoutMs: 300_000,
  maxConsecutiveFailures: 6,
};

describe("resolveCommentIntakeOptions", () => {
  it("uses built-in defaults when no env is set", () => {
    expect(resolveCommentIntakeOptions({})).toEqual(DEFAULTS);
  });

  it("honors explicit values", () => {
    expect(resolveCommentIntakeOptions({
      PAPERCLIP_COMMENT_INTAKE_ENABLED: "false",
      PAPERCLIP_COMMENT_INTAKE_POLL_INTERVAL_MS: "60000",
      PAPERCLIP_COMMENT_INTAKE_BATCH_SIZE: "25",
      PAPERCLIP_COMMENT_INTAKE_RUN_TIMEOUT_MS: "120000",
      PAPERCLIP_COMMENT_INTAKE_MAX_CONSECUTIVE_FAILURES: "3",
    })).toEqual({
      enabled: false,
      pollIntervalMs: 60_000,
      batchSize: 25,
      runTimeoutMs: 120_000,
      maxConsecutiveFailures: 3,
    });
  });

  it("clamps out-of-range values to the documented bounds", () => {
    expect(resolveCommentIntakeOptions({
      PAPERCLIP_COMMENT_INTAKE_POLL_INTERVAL_MS: "500", // below min 30s
      PAPERCLIP_COMMENT_INTAKE_BATCH_SIZE: "99999", // above max 1000
      PAPERCLIP_COMMENT_INTAKE_RUN_TIMEOUT_MS: "1", // below min 10s
      PAPERCLIP_COMMENT_INTAKE_MAX_CONSECUTIVE_FAILURES: "0", // below min 1
    })).toEqual({
      enabled: true,
      pollIntervalMs: 30_000,
      batchSize: 1_000,
      runTimeoutMs: 10_000,
      maxConsecutiveFailures: 1,
    });
  });

  it("falls back to defaults on non-numeric input", () => {
    expect(resolveCommentIntakeOptions({
      PAPERCLIP_COMMENT_INTAKE_POLL_INTERVAL_MS: "abc",
      PAPERCLIP_COMMENT_INTAKE_BATCH_SIZE: "-",
      PAPERCLIP_COMMENT_INTAKE_RUN_TIMEOUT_MS: "",
      PAPERCLIP_COMMENT_INTAKE_MAX_CONSECUTIVE_FAILURES: "1e999",
    })).toEqual(DEFAULTS);
  });

  it("rounds fractional values", () => {
    const options = resolveCommentIntakeOptions({
      PAPERCLIP_COMMENT_INTAKE_BATCH_SIZE: "10.9",
      PAPERCLIP_COMMENT_INTAKE_POLL_INTERVAL_MS: "45000.5",
    });
    expect(options.batchSize).toBe(11);
    expect(options.pollIntervalMs).toBe(45_001);
  });

  it("treats the enable switch as enabled only for the exact string 'true'", () => {
    expect(resolveCommentIntakeOptions({ PAPERCLIP_COMMENT_INTAKE_ENABLED: "1" }).enabled).toBe(false);
    expect(resolveCommentIntakeOptions({ PAPERCLIP_COMMENT_INTAKE_ENABLED: "TRUE" }).enabled).toBe(false);
    expect(resolveCommentIntakeOptions({ PAPERCLIP_COMMENT_INTAKE_ENABLED: "true" }).enabled).toBe(true);
  });
});
