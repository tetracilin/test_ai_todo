import type { TranscriptEntry } from "@paperclipai/adapter-utils";

// SCAFFOLD ONLY (NLM-A03): no real `nlm` stdout/JSON transcript rendering
// yet (see NLM-A07 "JSON/raw transcript rendering"). Falls back to raw
// stdout lines so the package builds/typechecks with the expected export
// shape.
export function parseNotebookLmLocalStdoutLine(line: string, ts: string): TranscriptEntry[] {
  return [{ kind: "stdout", ts, text: line }];
}
