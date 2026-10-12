import { afterEach, describe, expect, it, vi } from "vitest";
import { printGrokStreamEvent } from "./format-event.js";

describe("printGrokStreamEvent", () => {
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});

  afterEach(() => {
    spy.mockClear();
  });

  it("prints thought/text/end events", () => {
    printGrokStreamEvent(JSON.stringify({ type: "thought", data: "Plan" }), false);
    printGrokStreamEvent(JSON.stringify({ type: "text", data: "hello" }), false);
    printGrokStreamEvent(JSON.stringify({ type: "end", stopReason: "EndTurn", sessionId: "sess-1" }), false);

    const lines = spy.mock.calls.map((call) => String(call[0]));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("thinking: Plan");
    expect(lines[1]).toContain("assistant: hello");
    expect(lines[2]).toContain("Grok run completed (stopReason=EndTurn session=sess-1)");
  });

  it("prints structured error, unknown event and non-JSON lines, and ignores blank input", () => {
    printGrokStreamEvent(JSON.stringify({ type: "error", message: "boom" }), false);
    printGrokStreamEvent(JSON.stringify({ type: "error" }), false);
    printGrokStreamEvent(JSON.stringify({ type: "mystery", x: 1 }), false);
    printGrokStreamEvent("not json", false);
    printGrokStreamEvent("   ", false);

    const lines = spy.mock.calls.map((call) => String(call[0]));
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("error: boom");
    expect(lines[1]).toContain("error: Grok error");
    expect(lines[2]).toContain("event: mystery");
    expect(lines[3]).toBe("not json");
  });
});
