#!/usr/bin/env node
/**
 * check-ssot-guards.mjs
 *
 * CI guard for the fork-owned SSoT trio (`roadmap.md`, `backlog.md`,
 * `design.md`) established by docs/designs/t3-company-os-ssot.md (CEO-review
 * decision 2A, scoped per OV-7). Two checks, nothing else:
 *
 *   Check 1 — STRICT TREE-PATH CHECK: no tracked path may differ only by
 *     case from one of the SSoT trio paths. The canonical failure mode is a
 *     selective upstream cherry-pick re-adding upstream's root `DESIGN.md`
 *     or `ROADMAP.md`: in git's tree each is a *different path* from the
 *     fork's lowercase `design.md` / `roadmap.md`, but the pair collides on
 *     one file at checkout on Windows/macOS. The check reads `git ls-files`
 *     (the index/tree), NOT the filesystem — a case-insensitive filesystem
 *     cannot see the collision it is about to suffer. Zero exceptions.
 *     Relocated content lives at a different path (`docs/designs/DESIGN-UI.md`)
 *     and does not trip this check; upstream's roadmap is not kept at all.
 *
 *   Check 2 — CURATED REFERENCE CHECK: a small, fixed list of load-bearing
 *     files — CLAUDE.md, AGENTS.md, README.md, package.json (its `scripts`
 *     block only), scripts/check-token-gates.mjs — must not reference the
 *     relocated OLD root paths (a bare `DESIGN.md` / `ROADMAP.md`). This is
 *     deliberately NOT a repo-wide grep and carries no allowlist file:
 *     the list is curated here, in code, so it cannot rot.
 *
 *     Matching is uppercase- and boundary-aware to stay low-false-positive:
 *       - a longer file name such as `SOME-ROADMAP.md` does not match
 *         (`ROADMAP.md` is preceded by `-`);
 *       - `docs/designs/DESIGN-UI.md` does not match (it never contains the
 *         substring `DESIGN.md` at all);
 *       - the fork's lowercase `design.md` / `roadmap.md` do not match
 *         (case-sensitive: only the upstream UPPERCASE names are stale);
 *       - lines that are UPSTREAM-SYNC-style prose about deleting re-added
 *         upstream files (mentioning `UPSTREAM-SYNC` or `re-added`) are
 *         exempt — they name the old paths on purpose.
 *
 * Exit code: 0 when both checks are clean (prints a short summary).
 * Exit code: 1 when either check has violations (lists each with file/path).
 *
 * Usage: node scripts/check-ssot-guards.mjs
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

// The fork-owned SSoT trio, exact canonical (lowercase) root paths.
const SSOT_PATHS = ["roadmap.md", "backlog.md", "design.md"];

// Check 2's curated list. Curated means curated: extend it only when a new
// file becomes load-bearing for the trio's discoverability, never by adding
// a repo-wide walk.
const CURATED_FILES = [
  "CLAUDE.md",
  "AGENTS.md",
  "README.md",
  "scripts/check-token-gates.mjs",
];

// ── Check 1: strict tree-path check ─────────────────────────────────────
function listTrackedPaths() {
  // -z: NUL-delimited, immune to quoting/unicode path mangling.
  const out = execFileSync("git", ["ls-files", "-z"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split("\0").filter(Boolean);
}

function findTreePathViolations(trackedPaths) {
  const violations = [];
  const ssotLower = new Set(SSOT_PATHS.map((p) => p.toLowerCase()));
  for (const path of trackedPaths) {
    const lower = path.toLowerCase();
    if (ssotLower.has(lower) && !SSOT_PATHS.includes(path)) {
      violations.push({
        path,
        detail: `case-collides with fork-owned SSoT path "${lower}" — delete the re-added upstream file (its content belongs under doc/, see doc/ORIGIN.md)`,
      });
    }
  }
  return violations;
}

// ── Check 2: curated reference check ────────────────────────────────────
// Uppercase-only, so the fork's lowercase trio never matches. The lookbehind
// rejects a word/hyphen character immediately before the name, so
// longer file names (e.g. `SOME-ROADMAP.md`) never match either.
const STALE_REF_RE = /(?<![A-Za-z0-9_-])(?:DESIGN|ROADMAP)\.md\b/g;

// Prose that names the old paths on purpose (sync-checklist instructions
// about deleting re-added upstream files) is exempt, line-scoped.
function lineIsExempt(line) {
  return /UPSTREAM-SYNC/.test(line) || /re-added/i.test(line);
}

function findStaleRefsInText(text, describeLine) {
  const violations = [];
  // Strip CRs so line splitting and reporting behave identically on
  // CRLF checkouts (Windows, core.autocrlf).
  const lines = text.replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (lineIsExempt(line)) continue;
    for (const m of line.matchAll(STALE_REF_RE)) {
      violations.push({ where: describeLine(i + 1), snippet: m[0], line });
    }
  }
  return violations;
}

function findCuratedReferenceViolations() {
  const violations = [];

  for (const relPath of CURATED_FILES) {
    const text = readFileSync(resolve(REPO_ROOT, relPath), "utf8");
    for (const v of findStaleRefsInText(text, (n) => `${relPath}:${n}`)) {
      violations.push(v);
    }
  }

  // package.json: only its `scripts` block is load-bearing here (a script
  // invoking a relocated path). Other fields (description, deps) are not
  // reference surfaces for the trio.
  const pkg = JSON.parse(
    readFileSync(resolve(REPO_ROOT, "package.json"), "utf8"),
  );
  for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
    for (const m of String(command).matchAll(STALE_REF_RE)) {
      violations.push({
        where: `package.json (scripts."${name}")`,
        snippet: m[0],
        line: String(command),
      });
    }
  }

  return violations;
}

// ── Main ────────────────────────────────────────────────────────────────
function main() {
  const trackedPaths = listTrackedPaths();
  const treeViolations = findTreePathViolations(trackedPaths);
  const refViolations = findCuratedReferenceViolations();

  console.log("check-ssot-guards summary");
  console.log(`  Tracked paths scanned:         ${trackedPaths.length}`);
  console.log(`  Curated files checked:         ${CURATED_FILES.length + 1} (incl. package.json scripts)`);
  console.log("");
  console.log(`  Check 1 (tree-path collisions): ${treeViolations.length === 0 ? "CLEAN" : `${treeViolations.length} violation(s)`}`);
  console.log(`  Check 2 (stale root references): ${refViolations.length === 0 ? "CLEAN" : `${refViolations.length} violation(s)`}`);

  if (treeViolations.length > 0 || refViolations.length > 0) {
    console.log("\nViolations:\n");
    if (treeViolations.length > 0) {
      console.log("── check 1: case-colliding tracked paths ──");
      for (const v of treeViolations) {
        console.log(`  ${v.path}  ${v.detail}`);
      }
      console.log("");
    }
    if (refViolations.length > 0) {
      console.log("── check 2: stale references to relocated root paths ──");
      for (const v of refViolations) {
        console.log(`  ${v.where}  "${v.snippet}"  in: ${v.line.trim()}`);
      }
      console.log("");
    }
    process.exitCode = 1;
    return;
  }

  console.log("\nSSoT guards clean.");
  process.exitCode = 0;
}

main();
