#!/usr/bin/env node
/**
 * agent-guard.mjs
 *
 * Decides whether a patch written by an agent may be pushed. Pure rules over a
 * unified git diff; the CLI at the bottom is a thin wrapper for workflows.
 * Design: docs/superpowers/specs/2026-10-12-agent-issue-loop-design.md section 5.
 *
 * CLI contract: run AFTER `git apply`, from the repo root, with HEAD at the base
 * commit. `readBefore` is `git show HEAD:<path>`, `readAfter` is the working tree.
 *   node scripts/agent-guard.mjs <patch-file>
 * Prints a JSON verdict. Exit 0 = ok, 1 = violations, 2 = usage error.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parsePatch } from "./agent-patch.mjs";

export const LIMITS = Object.freeze({ maxFiles: 15, maxChangedLines: 400 });

const PROTECTED_PREFIXES = [".github/workflows/", "deploy/", "CICD/"];
const PROTECTED_EXACT = new Set(["pnpm-lock.yaml", ".github/PULL_REQUEST_TEMPLATE.md"]);
const AGENT_SCRIPT = /^scripts\/agent-[^/]+\.mjs$/;
const AGENT_SCRIPT_TEST = /^scripts\/__tests__\/agent-[^/]+\.test\.mjs$/;
const MIGRATIONS_PREFIX = "packages/db/src/migrations/";
const SYMLINK_MODE = "120000";

const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
  "bundledDependencies",
  "bundleDependencies",
  "overrides",
  "resolutions",
  "pnpm",
];

const TEST_CASE = /^\s*(?:it|test)(?:\.\w+(?:\([^)]*\))?)*\s*\(/;
const TEST_FILE = /(?:^|\/)__tests__\/|\.(?:test|spec)\.[cm]?[jt]sx?$/;
const SKIP_MARKER =
  /\b(?:it|test|describe)\.(?:skip|skipIf|runIf|todo|only)\b|\b(?:xit|xtest|xdescribe)\s*\(|\bvi\.retryTimes\b|\bretry\s*:\s*[1-9]|\.retry\(\s*[1-9]/;

function protectedReason(p) {
  if (PROTECTED_PREFIXES.some((prefix) => p.startsWith(prefix))) return "pipeline or deploy file";
  if (PROTECTED_EXACT.has(p)) return "protected file";
  if (path.posix.basename(p).startsWith(".env")) return "environment file";
  if (p.split("/").includes("secrets")) return "secrets path";
  if (AGENT_SCRIPT.test(p) || AGENT_SCRIPT_TEST.test(p)) return "agent loop script";
  return null;
}

function escapesRepo(p) {
  return p.startsWith("/") || /^[A-Za-z]:/.test(p) || p.includes("\\") || p.split("/").includes("..");
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function dependencySections(text) {
  const parsed = JSON.parse(text);
  const out = {};
  for (const name of DEPENDENCY_SECTIONS) {
    if (parsed[name] !== undefined) out[name] = parsed[name];
  }
  return stableStringify(out);
}

function checkPackageJson(file, readBefore, readAfter) {
  if (!readBefore || !readAfter) {
    return "cannot verify dependency sections (no file reader supplied)";
  }
  const before = file.status === "added" ? "{}" : readBefore(file.oldPath ?? file.path);
  const after = file.status === "deleted" ? null : readAfter(file.newPath ?? file.path);
  if (before === null || before === undefined) return "cannot read the base package.json";
  if (after === null || after === undefined) return "package.json deleted or unreadable";
  try {
    return dependencySections(before) === dependencySections(after)
      ? null
      : "dependency sections changed";
  } catch {
    return "package.json is not valid JSON";
  }
}

export function checkPatch({ patch, readBefore, readAfter, limits = LIMITS } = {}) {
  const files = parsePatch(patch ?? "");
  const violations = [];
  const add = (rule, filePath, detail) => violations.push({ rule, path: filePath ?? null, detail });

  if (files.length === 0) {
    add("empty-patch", null, "the patch changes no files");
  }

  let changedLines = 0;
  for (const file of files) {
    changedLines += file.added + file.removed;
    const touched = [file.oldPath, file.newPath].filter((p, i, all) => p && all.indexOf(p) === i);

    if (touched.some(escapesRepo)) {
      add("path-escape", file.path, "path is absolute or leaves the repository");
      continue;
    }
    for (const p of touched) {
      const reason = protectedReason(p);
      if (reason) add("protected-path", p, reason);
      if (p.startsWith(MIGRATIONS_PREFIX)) {
        add("migration", p, "database migrations need human review");
      }
    }
    if (file.mode === SYMLINK_MODE) add("symlink", file.path, "symbolic links are not allowed");
    if (file.binary) add("binary", file.path, "binary changes cannot be reviewed");
    if (touched.some((p) => path.posix.basename(p) === "package.json")) {
      const problem = checkPackageJson(file, readBefore, readAfter);
      if (problem) add("dependency-change", file.path, problem);
    }

    if (touched.some((p) => TEST_FILE.test(p))) {
      const removedCases = file.removedLines.filter((line) => TEST_CASE.test(line)).length;
      const addedCases = file.addedLines.filter((line) => TEST_CASE.test(line)).length;
      if (addedCases < removedCases) {
        add("test-weakening", file.path, `${removedCases - addedCases} fewer test cases`);
      }
      if (file.addedLines.some((line) => SKIP_MARKER.test(line))) {
        add("test-weakening", file.path, "adds a skip, todo, only or retry marker");
      }
    }
  }

  if (files.length > limits.maxFiles) {
    add("size", null, `${files.length} files changed, limit is ${limits.maxFiles}`);
  }
  if (changedLines > limits.maxChangedLines) {
    add("size", null, `${changedLines} lines changed, limit is ${limits.maxChangedLines}`);
  }

  return {
    ok: violations.length === 0,
    violations,
    stats: { files: files.length, changedLines },
  };
}

function gitShowHead(repoRoot, relativePath) {
  try {
    return execFileSync("git", ["show", `HEAD:${relativePath}`], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

export function runCheck({ patchText, repoRoot }) {
  return checkPatch({
    patch: patchText,
    readBefore: (relativePath) => gitShowHead(repoRoot, relativePath),
    readAfter: (relativePath) => {
      try {
        return readFileSync(path.join(repoRoot, relativePath), "utf8");
      } catch {
        return null;
      }
    },
  });
}

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  const patchFile = process.argv[2];
  if (!patchFile) {
    console.error("usage: node scripts/agent-guard.mjs <patch-file>");
    process.exit(2);
  }
  const verdict = runCheck({ patchText: readFileSync(patchFile, "utf8"), repoRoot: process.cwd() });
  console.log(JSON.stringify(verdict, null, 2));
  process.exit(verdict.ok ? 0 : 1);
}
