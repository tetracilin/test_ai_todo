import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveHermesHomeDir } from "./hermes-home.js";

describe("resolveHermesHomeDir", () => {
  const previous = process.env.HERMES_HOME;
  afterEach(() => {
    if (previous === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = previous;
  });

  it("prefers config.env.HERMES_HOME", () => {
    process.env.HERMES_HOME = "/server/home";
    expect(resolveHermesHomeDir({ env: { HERMES_HOME: "/data/hermes", HOME: "/x" } })).toBe(path.resolve("/data/hermes"));
  });

  it("uses config.env.HOME/.hermes when HERMES_HOME is not configured", () => {
    delete process.env.HERMES_HOME;
    expect(resolveHermesHomeDir({ env: { HOME: "/agent/home" } })).toBe(path.join(path.resolve("/agent/home"), ".hermes"));
  });

  it("falls back to the server HERMES_HOME, then the user's ~/.hermes", () => {
    process.env.HERMES_HOME = "/server/home";
    expect(resolveHermesHomeDir({})).toBe(path.resolve("/server/home"));
    delete process.env.HERMES_HOME;
    expect(resolveHermesHomeDir({})).toBe(path.join(os.homedir(), ".hermes"));
  });

  it("ignores blank and non-string values", () => {
    delete process.env.HERMES_HOME;
    expect(resolveHermesHomeDir({ env: { HERMES_HOME: "  ", HOME: 7 } })).toBe(path.join(os.homedir(), ".hermes"));
    expect(resolveHermesHomeDir({ env: ["x"] })).toBe(path.join(os.homedir(), ".hermes"));
  });
});
