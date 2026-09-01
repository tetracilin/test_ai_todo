import type { TranscriptEntry } from "@paperclipai/adapter-utils";

export const NOTEBOOKLM_LOCAL_TRANSCRIPT_MAX_CHARS = 16_000;
export const NOTEBOOKLM_LOCAL_TRANSCRIPT_TRUNCATION_MARKER =
  "…[NotebookLM transcript output truncated]";

function boundTranscriptText(value: string): string {
  if (value.length <= NOTEBOOKLM_LOCAL_TRANSCRIPT_MAX_CHARS) return value;
  return `${value.slice(0, NOTEBOOKLM_LOCAL_TRANSCRIPT_MAX_CHARS)}\n${NOTEBOOKLM_LOCAL_TRANSCRIPT_TRUNCATION_MARKER}`;
}

function formatJson(value: unknown): string | null {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return null;
  }
}

export function parseNotebookLmLocalStdoutLine(line: string, ts: string): TranscriptEntry[] {
  try {
    const parsed: unknown = JSON.parse(line);
    const rendered = formatJson(parsed);
    if (rendered !== null) {
      return [{ kind: "stdout", ts, text: boundTranscriptText(rendered) }];
    }
  } catch {
    // Raw output is expected for commands without an explicitly-supported --json mode.
  }
  return [{ kind: "stdout", ts, text: boundTranscriptText(line) }];
}
