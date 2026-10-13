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

import path from "node:path";

import { parsePatch } from "./agent-patch.mjs";

export const LIMITS = Object.freeze({ maxFiles: 15, maxChangedLines: 400 });

const PROTECTED_PREFIXES = [".github/workflows/", "deploy/", "CICD/"];
const PROTECTED_EXACT = new Set(["pnpm-lock.yaml", ".github/PULL_REQUEST_TEMPLATE.md"]);
const AGENT_SCRIPT = /^scripts\/agent-[^/]+\.mjs$/;
const AGENT_SCRIPT_TEST = /^scripts\/__tests__\/agent-[^/]+\.test\.mjs$/;
const MIGRATIONS_PREFIX = "packages/db/src/migrations/";
const SYMLINK_MODE = "120000";

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
    // Task 3 adds the package.json and test-weakening checks here.
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
