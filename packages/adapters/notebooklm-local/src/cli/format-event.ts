import pc from "picocolors";

const MAX_RENDERED_CHARS = 8_000;
const TRUNCATION_MARKER = "…[truncated by Paperclip notebooklm_local adapter]";
const AUTH_FAILURE_CODES = new Set(["notebooklm_local_auth_failed", "notebooklm_local_auth_invalid"]);
const SECRET_KEY_PATTERN = /(?:cookie|token|secret|password|authorization|account|email|profile|sid)/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isTruncated(value: unknown): boolean {
  return value === true || (typeof value === "string" && /truncat/i.test(value));
}

function redactProfileData(value: unknown, key = ""): unknown {
  if (SECRET_KEY_PATTERN.test(key)) return "[redacted]";
  if (typeof value === "string") {
    return value
      .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "[redacted-email]")
      .replace(/(?:__Secure-[\w-]+|SID|HSID|SSID|APISID|SAPISID)=[^\s;]+/gi, "[redacted-cookie]")
      .replace(/\b(?:account|profile)\s*:\s*[^\r\n]+/gi, "[redacted-profile-data]");
  }
  if (Array.isArray(value)) return value.map((entry) => redactProfileData(entry));
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(Object.entries(record).map(([entryKey, entryValue]) => [
    entryKey,
    redactProfileData(entryValue, entryKey),
  ]));
}

function boundedText(value: string): { text: string; truncated: boolean } {
  if (value.length <= MAX_RENDERED_CHARS) return { text: value, truncated: false };
  return {
    text: `${value.slice(0, MAX_RENDERED_CHARS)}\n${TRUNCATION_MARKER}`,
    truncated: true,
  };
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(redactProfileData(value), null, 2);
  } catch {
    return "[unserializable NotebookLM result]";
  }
}

function printText(label: string, value: unknown, color: (text: string) => string): void {
  const text = asString(value);
  if (!text) return;
  const bounded = boundedText(redactProfileData(text) as string);
  console.log(color(label));
  console.log(bounded.text);
  if (bounded.truncated) console.log(pc.yellow("output truncated"));
}

function printResult(record: Record<string, unknown>): void {
  const resultJson = asRecord(record.resultJson) ?? asRecord(record.result) ?? record;
  const errorCode = asString(record.errorCode) || asString(resultJson.errorCode);
  const timedOut = record.timedOut === true || resultJson.timedOut === true || errorCode === "notebooklm_local_timeout";
  const isAuthFailure = AUTH_FAILURE_CODES.has(errorCode);
  const isError = timedOut || isAuthFailure || Boolean(errorCode) || record.exitCode === null ||
    (typeof record.exitCode === "number" && record.exitCode !== 0);

  if (timedOut) {
    console.log(pc.yellow("NotebookLM command timed out"));
  } else if (isAuthFailure) {
    console.log(pc.red("NotebookLM authentication failed. Run nlm login out of band."));
  } else if (isError) {
    console.log(pc.red(`NotebookLM command failed${errorCode ? `: ${errorCode}` : ""}`));
  } else {
    console.log(pc.green("NotebookLM command completed"));
  }

  const errorMessage = asString(record.errorMessage) || asString(resultJson.errorMessage);
  if (errorMessage) console.log((isError ? pc.red : pc.gray)(redactProfileData(errorMessage) as string));

  const json = resultJson.json;
  if (json !== undefined && json !== null) {
    const bounded = boundedText(safeJson(json));
    console.log(pc.cyan("JSON result:"));
    console.log(bounded.text);
    if (bounded.truncated || isTruncated(resultJson.jsonTruncated)) console.log(pc.yellow("JSON output truncated"));
  }

  printText("stdout:", resultJson.stdout, pc.gray);
  if (isTruncated(resultJson.stdoutTruncated)) console.log(pc.yellow("stdout truncated"));
  printText("stderr:", resultJson.stderr, pc.red);
  if (isTruncated(resultJson.stderrTruncated)) console.log(pc.yellow("stderr truncated"));
}

// notebooklm_local is one-shot, not an event-stream protocol. Most stdout log
// chunks are raw `nlm` text; final structured results are JSON emitted by the
// Paperclip heartbeat layer. Only format known result envelopes, preserving raw
// CLI output otherwise. Credentials and profile data are redacted before print.
export function formatNotebookLmLocalStdoutEvent(raw: string, _debug: boolean): void {
  const line = raw.trim();
  if (!line) return;

  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = asRecord(JSON.parse(line));
  } catch {
    const bounded = boundedText(redactProfileData(line) as string);
    console.log(bounded.text);
    if (bounded.truncated) console.log(pc.yellow("output truncated"));
    return;
  }

  if (!parsed) {
    console.log(line);
    return;
  }

  const type = asString(parsed.type);
  const resultLike = type === "result" || type === "notebooklm_local.result" ||
    "resultJson" in parsed || "errorCode" in parsed || "timedOut" in parsed;
  if (resultLike) {
    printResult(parsed);
    return;
  }

  // A successful `nlm` command can itself emit a JSON object rather than a
  // Paperclip result envelope. It is still raw command stdout, so render it
  // instead of hiding it in non-debug CLI mode.
  const bounded = boundedText(safeJson(parsed));
  console.log(bounded.text);
  if (bounded.truncated) console.log(pc.yellow("output truncated"));
}
