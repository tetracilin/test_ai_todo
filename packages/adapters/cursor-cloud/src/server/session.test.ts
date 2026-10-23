import { describe, expect, it } from "vitest";
import { sessionCodec } from "./session.js";

describe("cursorCloud sessionCodec", () => {
  it("normalizes legacy and current session identifiers", () => {
    expect(
      sessionCodec.deserialize({
        agentId: "agent-123",
        runId: "run-456",
        envType: "pool",
        envName: "trusted",
        repos: [{ url: "https://github.com/paperclipai/paperclip.git", startingRef: "main" }],
      }),
    ).toEqual({
      cursorAgentId: "agent-123",
      latestRunId: "run-456",
      runtime: "cloud",
      envType: "pool",
      envName: "trusted",
      repos: [{ url: "https://github.com/paperclipai/paperclip.git", startingRef: "main" }],
    });
  });

  it("drops invalid session payloads and exposes the display id", () => {
    expect(sessionCodec.deserialize({ latestRunId: "run-1" })).toBeNull();
    expect(sessionCodec.getDisplayId?.({
      cursorAgentId: "agent-789",
      latestRunId: "run-101",
    })).toBe("agent-789");
  });

  it("rejects non-object payloads and skips repos without a url", () => {
    expect(sessionCodec.deserialize(null)).toBeNull();
    expect(sessionCodec.deserialize("agent-1")).toBeNull();
    expect(sessionCodec.deserialize(["agent-1"])).toBeNull();
    expect(
      sessionCodec.deserialize({
        cursorAgentId: "agent-1",
        repos: [{ startingRef: "main" }, { url: "  " }, { url: "https://example.com/r.git" }],
      }),
    ).toEqual({
      cursorAgentId: "agent-1",
      runtime: "cloud",
      repos: [{ url: "https://example.com/r.git" }],
    });
  });
});
