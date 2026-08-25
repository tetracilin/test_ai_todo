#!/usr/bin/env node

import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const CHECKER_MODE = "blocking";

export const HISTORICAL_ALLOWLIST = [
  {
    pattern: "doc/plans/**",
    reason: "Dated upstream design records; retained as historical evidence, not runtime guidance.",
  },
  {
    pattern: "releases/**",
    reason: "Published release history; immutable historical record.",
  },
  {
    pattern: "skills-releases/**",
    reason: "Versioned skill snapshots; retained for release reproducibility.",
  },
  {
    pattern: "**/CHANGELOG.md",
    reason: "Published package history; immutable historical record.",
  },
];

const CONTROL_PATHS = new Set([
  "scripts/check-no-google-runtime.mjs",
  "scripts/check-no-google-runtime.test.mjs",
  "docs/migration/test-ai-todo-inventory.md",
]);

// The bundle scanner's pattern table necessarily names the legacy provider
// strings it detects. It is itself gated by scan-client-bundle.test.mjs and
// only ever runs against built UI output, so treat it as gate control surface
// (excluded from the source scan) rather than a runtime finding.
CONTROL_PATHS.add("scripts/scan-client-bundle.mjs");

export const FORBIDDEN_PATTERNS = [
  { id: "legacy_adapter_id", pattern: /gemini_local/i },
  { id: "legacy_adapter_file", pattern: /(?:^|\/)Dockerfile\.gemini/i },
  { id: "legacy_adapter_package", pattern: /@paperclipai\/adapter-gemini-local/i },
  { id: "legacy_cli_package", pattern: /@google\/gemini-cli/i },
  { id: "legacy_client_sdk", pattern: /@google\/genai|(?:^|["'])firebase(?:\/|["'])/i },
  { id: "legacy_ai_env", pattern: /\b(?:GEMINI_API_KEY|GOOGLE_API_KEY)\b/i },
  { id: "legacy_model_endpoint", pattern: /generativelanguage\.googleapis\.com/i },
  { id: "legacy_data_endpoint", pattern: /(?:firebaseio\.com|firebasestorage\.(?:app|googleapis\.com)|firebaseapp\.com)/i },
  { id: "legacy_app_slug", pattern: /\b(?:google-sheets|google-gemini)\b/i },
  { id: "legacy_app_env", pattern: /\bGOOGLE_SHEETS_[A-Z0-9_]+\b/i },
  { id: "web_api_key_shape", pattern: /AIza[0-9A-Za-z_-]{35}/ },
  { id: "oauth_client_shape", pattern: /[0-9]+-[0-9a-z_]{32}\.apps\.googleusercontent\.com/i },
];

function normalizePath(value) {
  return value.split(path.sep).join("/").replace(/^\.\//, "");
}

function matchesGlob(relativePath, pattern) {
  if (pattern.startsWith("**/")) {
    return relativePath === pattern.slice(3) || relativePath.endsWith(`/${pattern.slice(3)}`);
  }
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return relativePath === prefix || relativePath.startsWith(`${prefix}/`);
  }
  return relativePath === pattern;
}

function historicalAllowlistEntry(relativePath) {
  return HISTORICAL_ALLOWLIST.find((entry) => matchesGlob(relativePath, entry.pattern));
}

function verificationAllowlistPattern(relativePath) {
  if (/\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/i.test(relativePath)) return "**/*.{test,spec}.*";
  if (/(?:^|\/)fixtures(?:\/|$)/.test(relativePath)) return "**/fixtures/**";
  if (relativePath.startsWith("ui/storybook/")) return "ui/storybook/**";
  if (relativePath.startsWith("packages/shared/src/telemetry/generated/")) return "packages/shared/src/telemetry/generated/**";
  if (relativePath === "packages/shared/src/app-definitions.ingestion-report.json") return relativePath;
  if (relativePath === "scripts/general-server-shard-durations.json") return relativePath;
  if (relativePath.startsWith("patches/")) return "patches/**";
  return undefined;
}

function trackedPathsFromGit(repoRoot) {
  const result = spawnSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`git ls-files failed: ${result.stderr.trim() || `exit ${result.status}`}`);
  }
  return result.stdout.split("\0").filter(Boolean);
}

function inspectPath(repoRoot, relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  let stats;
  try {
    stats = lstatSync(absolutePath);
  } catch {
    return null;
  }
  if (!stats.isFile() || stats.isSymbolicLink()) return null;

  let content;
  try {
    content = readFileSync(absolutePath, "utf8");
  } catch {
    return null;
  }

  const haystack = `${relativePath}\n${content}`;
  const patternIds = FORBIDDEN_PATTERNS
    .filter(({ pattern }) => pattern.test(haystack))
    .map(({ id }) => id);
  if (patternIds.length === 0) return null;

  return {
    path: relativePath,
    patternIds,
  };
}

export function scanRepository({ repoRoot, trackedPaths } = {}) {
  if (!repoRoot) throw new Error("repoRoot is required");
  const paths = (trackedPaths ?? trackedPathsFromGit(repoRoot))
    .map(normalizePath)
    .filter((relativePath) => !CONTROL_PATHS.has(relativePath))
    .sort();
  const forbidden = [];
  const allowed = [];

  for (const relativePath of paths) {
    const hit = inspectPath(repoRoot, relativePath);
    if (!hit) continue;
    const allowlistEntry = historicalAllowlistEntry(relativePath);
    const verificationPattern = verificationAllowlistPattern(relativePath);
    if (allowlistEntry || verificationPattern) {
      allowed.push({
        ...hit,
        classification: allowlistEntry ? "historical-allowlist" : "verification-allowlist",
        allowlistPattern: allowlistEntry?.pattern ?? verificationPattern,
        reason: allowlistEntry?.reason ?? "Test, fixture, generated compatibility data, or immutable patch evidence; never shipped as active runtime configuration.",
      });
    } else {
      forbidden.push({ ...hit, classification: "remove-or-replace" });
    }
  }

  return {
    mode: CHECKER_MODE,
    forbidden,
    allowed,
    controlPaths: [...CONTROL_PATHS].sort(),
    allowlist: HISTORICAL_ALLOWLIST,
  };
}

export function formatReport(report) {
  const lines = [
    "No-Google runtime inventory",
    `MODE: ${report.mode} (findings fail the gate)`,
    `Forbidden paths (${report.forbidden.length}):`,
  ];

  if (report.forbidden.length === 0) lines.push("  (none)");
  for (const hit of report.forbidden) {
    lines.push(
      `  - [${hit.classification}] ${hit.path} (patterns: ${hit.patternIds.join(", ")})`,
    );
  }

  lines.push(`Historical allowlist paths (${report.allowed.length}):`);
  if (report.allowed.length === 0) lines.push("  (none)");
  for (const hit of report.allowed) {
    lines.push(
      `  - [${hit.classification}] ${hit.path} (${hit.allowlistPattern}; patterns: ${hit.patternIds.join(", ")})`,
    );
  }

  lines.push(report.forbidden.length === 0 ? "Result: PASS; zero forbidden runtime paths." : "Result: BLOCKED; remove or replace every forbidden runtime path.");
  return lines.join("\n");
}

export function formatJsonReport(report) {
  return JSON.stringify(report, null, 2);
}

export function runCheck({
  repoRoot = process.cwd(),
  trackedPaths,
  log = console.log,
  error = console.error,
} = {}) {
  try {
    const report = scanRepository({ repoRoot, trackedPaths });
    for (const line of formatReport(report).split("\n")) log(line);
    return { exitCode: report.forbidden.length === 0 ? 0 : 1, report };
  } catch (caught) {
    error(`No-Google runtime inventory error: ${caught instanceof Error ? caught.message : String(caught)}`);
    return { exitCode: 1, report: null };
  }
}

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  if (process.argv.includes("--json")) {
    try {
      const report = scanRepository({ repoRoot: process.cwd() });
      console.log(formatJsonReport(report));
      process.exit(report.forbidden.length === 0 ? 0 : 1);
    } catch (caught) {
      console.error(
        `No-Google runtime inventory error: ${caught instanceof Error ? caught.message : String(caught)}`,
      );
      process.exit(1);
    }
  } else {
    const result = runCheck();
    process.exit(result.exitCode);
  }
}
