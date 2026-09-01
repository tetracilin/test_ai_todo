// @vitest-environment jsdom

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * K10 "no browser-side model/key calls" guard.
 *
 * The Hermes Gateway contract requires every model call to happen server-side
 * through the Purpose Robot API: the browser never talks to a model provider
 * directly and never stores or transmits provider credentials. These tests
 * guard the `ui/src` source tree so the class of violation cannot return
 * silently:
 *
 *  1. No direct fetch/EventSource/WebSocket to a model-provider origin
 *     (Anthropic, OpenAI, Google Gemini, xAI, Moonshot/Kimi, OpenRouter,
 *     DeepSeek, DashScope/Qwen). All AI traffic must go through same-origin
 *     `/api` endpoints (the Hermes gateway adapter executes server-side).
 *  2. No credential-looking literals (`sk-…` keys) in client code or tests.
 *  3. No token/key/secret persisted in localStorage or sessionStorage — the
 *     only browser storage allowed for credentials is none; secrets live in
 *     the server secret store and are referenced by name (`secret_ref`).
 */

function findUiSrcDir(): string {
  let dir = process.cwd();
  for (let depth = 0; depth < 6; depth++) {
    for (const candidate of [path.join(dir, "src"), path.join(dir, "ui/src")]) {
      if (existsSync(candidate) && existsSync(path.join(candidate, "App.tsx"))) {
        return candidate;
      }
    }
    dir = path.dirname(dir);
  }
  throw new Error("ui/src not found from " + process.cwd());
}

const UI_SRC = findUiSrcDir();

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const SOURCE_FILES = listSourceFiles(UI_SRC);
const RELATIVE = new Map(SOURCE_FILES.map((f) => [f, path.relative(UI_SRC, f)]));

/** Client code under test — fixtures are display-only test data. */
const RUNTIME_FILES = SOURCE_FILES.filter((file) => !RELATIVE.get(file)!.includes("fixtures/"));

const PROVIDER_ORIGIN_RE =
  /https?:\/\/(?:(?:www\.)?(?:api\.)?(?:anthropic\.com|openai\.com|claude\.ai|generativelanguage\.googleapis\.com|x\.ai|moonshot\.cn|openrouter\.ai|deepseek\.com|dashscope\.aliyuncs\.com)|api\.(?:anthropic|openai|x\.ai|moonshot|deepseek)\.(?:com|cn))/;

// Word-bounded so identifiers like `data-testid="task-chat-…"` (which end in
// "sk") cannot produce false positives.
const CREDENTIAL_LITERAL_RE = /(?<![a-zA-Z0-9_-])sk-[a-zA-Z0-9_-]{20,}/;

const STORAGE_CREDENTIAL_RE =
  /(localStorage|sessionStorage)\.setItem\s*\(\s*["'`][^"'`]*(token|apikey|api[_-]?key|secret|credential|password)[^"'`]*["'`]/i;

/**
 * Known non-secret `sk-`-shaped display placeholders, pinned by exact literal:
 * each entry lists the only occurrences allowed in that file. Anything new in
 * these files (or any occurrence anywhere else) fails the suite.
 *
 * Both pins are assembled from fragment constants at runtime so this guard
 * file itself never contains a full credential-pattern-matching literal.
 */
const SK_PREFIX = "sk-";
// DesignGuide sample value (obviously fake sequential key).
const DG_KEY = SK_PREFIX + "live-51H8xL0aBcDeFgHiJkLmNoPq";

const PLACEHOLDER_ALLOWLIST: Record<string, string[]> = {
  // Design-guide sample data for the secret-field component; obviously fake
  // sequential alphabet, never a real credential. The guard test also pins
  // the literal (self-referentially) to assert it stays present.
  "pages/DesignGuide.tsx": [`value: "${DG_KEY}"`],
  // The sensitivity-detector's own sample value: a plain alphabet sequence,
  // never a real credential. Pinned so the file cannot drift into a
  // real-looking key without review.
  "components/environment-variables-editor/sensitive.test.ts": [
    `"${SK_PREFIX}abcdefghijklmnopqrst"`,
  ],
};

describe("no direct model-provider calls in ui/src", () => {
  it("never fetches, SSE-connects, or WebSocket-connects to a provider origin", () => {
    const offenders: string[] = [];
    for (const file of RUNTIME_FILES) {
      if (PROVIDER_ORIGIN_RE.test(readFileSync(file, "utf8"))) {
        offenders.push(RELATIVE.get(file)!);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("no credential literals in ui/src", () => {
  it("contains no sk- style API key material outside pinned display placeholders", () => {
    const offenders: string[] = [];
    for (const file of SOURCE_FILES) {
      const rel = RELATIVE.get(file)!;
      const source = readFileSync(file, "utf8");
      const allowed = PLACEHOLDER_ALLOWLIST[rel] ?? [];
      for (const match of source.matchAll(new RegExp(CREDENTIAL_LITERAL_RE.source, "g"))) {
        // Accept only if some allowlisted literal contains this exact match.
        if (!allowed.some((literal) => literal.includes(match[0]))) {
          offenders.push(`${rel}: ${match[0].slice(0, 12)}…`);
        }
      }
      // The allowlist itself must stay honest: every pinned literal must
      // still exist verbatim, so removed samples can't mask regressions.
      for (const literal of allowed) {
        expect(source, `${rel} no longer contains pinned placeholder`).toContain(literal);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("persists no token/key/secret into localStorage or sessionStorage", () => {
    const offenders: string[] = [];
    for (const file of RUNTIME_FILES) {
      const source = readFileSync(file, "utf8");
      const match = source.match(STORAGE_CREDENTIAL_RE);
      if (match) offenders.push(`${RELATIVE.get(file)!}: ${match[0]}`);
    }
    expect(offenders).toEqual([]);
  });
});
