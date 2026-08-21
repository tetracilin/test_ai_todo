#!/usr/bin/env node

import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const CHECKER_MODE = "report";

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

const TERM_PATTERN = /google|firebase|gemini/gi;
const CONTROL_REFERENCE_PATTERN = /check(?::|-)no-google-runtime(?:\.test)?(?:\.mjs)?/gi;
const ACTIVE_DOC_EXTENSIONS = new Set([".md", ".mdx", ".txt", ".html"]);

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

function classificationFor(relativePath) {
  if (ACTIVE_DOC_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) return "replace";
  return "remove";
}

function termsIn(value) {
  const normalized = value.replaceAll(CONTROL_REFERENCE_PATTERN, "");
  return [...new Set([...normalized.matchAll(TERM_PATTERN)].map((match) => match[0].toLowerCase()))].sort();
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

  const pathTerms = termsIn(relativePath);
  const contentWithoutControlReferences = content.replaceAll(CONTROL_REFERENCE_PATTERN, "");
  const contentMatches = [...contentWithoutControlReferences.matchAll(TERM_PATTERN)];
  const contentTerms = contentMatches.map((match) => match[0].toLowerCase());
  const terms = [...new Set([...pathTerms, ...contentTerms])].sort();
  if (terms.length === 0) return null;

  return {
    path: relativePath,
    terms,
    matches: pathTerms.length + contentMatches.length,
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
    if (allowlistEntry) {
      allowed.push({
        ...hit,
        classification: "historical-allowlist",
        allowlistPattern: allowlistEntry.pattern,
        reason: allowlistEntry.reason,
      });
    } else {
      forbidden.push({ ...hit, classification: classificationFor(relativePath) });
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
    `MODE: ${report.mode} (non-blocking; findings exit 0 until K12)`,
    `Forbidden paths (${report.forbidden.length}):`,
  ];

  if (report.forbidden.length === 0) lines.push("  (none)");
  for (const hit of report.forbidden) {
    lines.push(
      `  - [${hit.classification}] ${hit.path} (terms: ${hit.terms.join(", ")}; matches: ${hit.matches})`,
    );
  }

  lines.push(`Historical allowlist paths (${report.allowed.length}):`);
  if (report.allowed.length === 0) lines.push("  (none)");
  for (const hit of report.allowed) {
    lines.push(
      `  - [historical-allowlist] ${hit.path} (${hit.allowlistPattern}; terms: ${hit.terms.join(", ")})`,
    );
  }

  lines.push("Result: REPORT ONLY; forbidden findings do not fail CI.");
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
    return { exitCode: 0, report };
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
      console.log(formatJsonReport(scanRepository({ repoRoot: process.cwd() })));
      process.exit(0);
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
