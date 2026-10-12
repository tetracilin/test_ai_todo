import { describe, expect, it } from "vitest";
import { buildLineDiff } from "./line-diff";

describe("buildLineDiff", () => {
  it("emits context rows when both sides are identical", () => {
    const rows = buildLineDiff("a\nb\nc", "a\nb\nc");
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.kind === "context")).toBe(true);
  });

  it("marks added and removed lines", () => {
    const rows = buildLineDiff("a\nb\nc", "a\nB\nc");
    const kinds = rows.map((row) => row.kind);
    expect(kinds).toContain("removed");
    expect(kinds).toContain("added");
    const removed = rows.find((row) => row.kind === "removed");
    const added = rows.find((row) => row.kind === "added");
    expect(removed?.text).toBe("b");
    expect(added?.text).toBe("B");
  });

  it("handles empty old text as full insertion", () => {
    const rows = buildLineDiff("", "x\ny");
    expect(rows.filter((row) => row.kind === "added")).toHaveLength(2);
  });

  it("numbers context rows on both sides and keeps numbering independent across changes", () => {
    const rows = buildLineDiff("a\nb\nc", "a\nc\nd");
    expect(rows).toEqual([
      { kind: "context", oldLineNumber: 1, newLineNumber: 1, text: "a" },
      { kind: "removed", oldLineNumber: 2, newLineNumber: null, text: "b" },
      { kind: "context", oldLineNumber: 3, newLineNumber: 2, text: "c" },
      { kind: "added", oldLineNumber: null, newLineNumber: 3, text: "d" },
    ]);
  });

  it("marks every old line removed when the new text shares no lines", () => {
    const rows = buildLineDiff("x\ny", "z");
    expect(rows.filter((row) => row.kind === "removed").map((row) => row.text)).toEqual(["x", "y"]);
    expect(rows.filter((row) => row.kind === "added").map((row) => row.text)).toEqual(["z"]);
    expect(rows.some((row) => row.kind === "context")).toBe(false);
  });
});
