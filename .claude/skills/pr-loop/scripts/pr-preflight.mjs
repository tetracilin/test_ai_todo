#!/usr/bin/env node
// pr-preflight: the local gates a branch must pass before a PR to develop is
// opened or updated. All rule logic lives in the exported pure functions; main()
// only collects data with git/pnpm/npx and renders the result.
//
// Usage:
//   node .claude/skills/pr-loop/scripts/pr-preflight.mjs [--base origin/develop]
//     [--body-file <path>] [--title "<pr title>"] [--json] [--allow-lockfile]
//     [--skip-server-tests "<reason>"] [--no-fetch]
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "../../../../.agents/skills/pr-gardening/scripts/lib.mjs";

export const DEFAULT_BASE = "origin/develop";
export const PIPELINE_PATHS = [".github/workflows/", "deploy/compose.yaml", "deploy/scripts/"];
// Matches GitHub OAuth/personal/fine-grained token prefixes (gho, ghp, github_pat
// followed by an underscore), AWS access key ids, PEM private key headers and
// Slack tokens. The GitHub prefixes are assembled at runtime so this file never
// contains a marker itself (the scanner also reads untracked files, including this one).
const GITHUB_TOKEN_PREFIXES = ["gho", "ghp", "github_pat"].map((prefix) => `${prefix}_`);
export const SECRET_PATTERN = new RegExp(
  `(${GITHUB_TOKEN_PREFIXES.join("|")}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|xox[abp]-)`,
);
export const ENV_FILE_PATTERN = /(^|\/)\.env(\.|$)/;
export const INTERNAL_REFERENCE_PATTERN = /PAPA-\d+|PAP-\d+|agent:\/\/|localhost|127\.0\.0\.1|100\.103\.|\.ts\.net/;
// CLAUDE.md: "feature/*, fix/*, chore/* are the only branch prefixes."
export const BRANCH_PREFIX_PATTERN = /^(feature|fix|chore)\//;
export const BRANCH_PREFIX_HINT = "feature|fix|chore/<topic>";
export const MAX_FILE_COUNT = 100;
export const MAX_TITLE_LENGTH = 70;
export const THINKING_PATH_OPENER = "Paperclip is the open source app people use to manage AI agents for work";
export const CHECKLIST_MAY_STAY_UNCHECKED = ["CI gates are green", "Greptile"];
export const REQUIRED_CONTENT_SECTIONS = ["What Changed", "Verification", "Risks", "Model Used"];
export const CHECK_IDS = [
  "branch_prefix",
  "base_current",
  "scope_pipeline_mix",
  "no_secrets",
  "file_count",
  "server_tests",
  "ui_token_gates",
  "typecheck_touched",
  "pr_body",
];
const SPAWN_MAX_BUFFER_BYTES = 64 * 1024 * 1024;
const MAX_UNTRACKED_SCAN_BYTES = 1024 * 1024;
const TAIL_LINES = 15;
const ESC = String.fromCharCode(27);
const NUL = String.fromCharCode(0);
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, "g");

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function check(id, status, hint, details = null) {
  return { id, status, hint, details };
}

export function normalizePath(value) {
  return String(value ?? "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^"(.*)"$/, "$1")
    .replace(/^\.\//, "");
}

export function isPipelinePath(filePath) {
  return PIPELINE_PATHS.some((entry) => (entry.endsWith("/") ? filePath.startsWith(entry) : filePath === entry));
}

export function classifyPaths(paths) {
  const all = [...new Set((paths ?? []).map(normalizePath).filter(Boolean))].sort();
  return {
    all,
    pipeline: all.filter(isPipelinePath),
    app: all.filter((entry) => !isPipelinePath(entry)),
    envFiles: all.filter((entry) => ENV_FILE_PATTERN.test(entry) && path.posix.basename(entry) !== ".env.example"),
    lockfiles: all.filter((entry) => path.posix.basename(entry) === "pnpm-lock.yaml"),
    server: all.filter((entry) => entry.startsWith("server/")),
    uiGated: all.filter((entry) => entry.startsWith("ui/src/components/") || entry.startsWith("ui/src/pages/")),
  };
}

// `git status --porcelain=v1 -z`: "XY path<NUL>", renames/copies add "old<NUL>".
export function parsePorcelainStatus(text) {
  const tokens = String(text ?? "").split(NUL);
  const paths = [];
  const untracked = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.length < 4) continue;
    const xy = token.slice(0, 2);
    const filePath = normalizePath(token.slice(3));
    if (!filePath) continue;
    if (xy.includes("R") || xy.includes("C")) index += 1; // skip the origin path
    if (xy === "!!") continue;
    paths.push(filePath);
    if (xy === "??") untracked.push(filePath);
  }
  return { paths, untracked };
}

export function checkBranchPrefix(branch) {
  const name = String(branch ?? "").trim();
  if (!name || name === "HEAD") {
    return check("branch_prefix", "FAIL", "detached HEAD; create a branch: git checkout -b feature/<topic> origin/develop", { branch: name });
  }
  if (name === "develop" || name === "main") {
    return check("branch_prefix", "FAIL", `never work on ${name}; create ${BRANCH_PREFIX_HINT} from origin/develop`, { branch: name });
  }
  if (!BRANCH_PREFIX_PATTERN.test(name)) {
    return check("branch_prefix", "FAIL", `rename the branch to ${BRANCH_PREFIX_HINT}: git branch -m ${name} feature/<topic>`, { branch: name });
  }
  return check("branch_prefix", "PASS", `branch ${name}`, { branch: name });
}

export function checkBaseCurrent({ base = DEFAULT_BASE, mergeBase, baseTip, fetched = true, fetchError = null }) {
  const details = { base, mergeBase: mergeBase ?? null, baseTip: baseTip ?? null, fetched };
  if (fetchError) {
    return check("base_current", "FAIL", `git fetch of ${base} failed (${fetchError}); fix network/auth and rerun, or pass --no-fetch`, details);
  }
  if (!baseTip) {
    return check("base_current", "FAIL", `${base} is not known locally; run: git fetch origin ${base.replace(/^origin\//, "")}`, details);
  }
  if (!mergeBase || mergeBase !== baseTip) {
    return check("base_current", "FAIL", `run: git rebase ${base}`, details);
  }
  return check("base_current", "PASS", `HEAD contains ${base} tip ${baseTip.slice(0, 8)}${fetched ? "" : " (not fetched)"}`, details);
}

// CLAUDE.md: pipeline files never share a PR with application code. There is
// deliberately no flag that downgrades this to a WARN.
export function checkPipelineMix(classified) {
  const details = { pipeline: classified.pipeline, appCount: classified.app.length };
  if (classified.pipeline.length > 0 && classified.app.length > 0) {
    return check("scope_pipeline_mix", "FAIL", "split pipeline files into their own PR labelled ci", details);
  }
  if (classified.pipeline.length > 0) {
    return check("scope_pipeline_mix", "WARN", "pipeline-only change: label the PR ci, human review", details);
  }
  return check("scope_pipeline_mix", "PASS", "no pipeline files changed", details);
}

export function findSecretsInDiff(diffText) {
  const hits = [];
  let currentFile = "(unknown)";
  for (const rawLine of String(diffText ?? "").split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.startsWith("+++ ")) {
      currentFile = normalizePath(line.slice(4).replace(/^b\//, ""));
      continue;
    }
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    const match = line.slice(1).match(SECRET_PATTERN);
    if (match) hits.push({ file: currentFile, marker: match[1].slice(0, 12) });
  }
  return hits;
}

export function checkSecretsInDiff({ classified, diffText = "", allowLockfile = false }) {
  const problems = [];
  for (const file of classified.envFiles) problems.push(`env file changed: ${file}`);
  // Only the file and the marker prefix are reported, never the matched line.
  for (const hit of findSecretsInDiff(diffText)) problems.push(`secret-like token (${hit.marker}...) added in ${hit.file}`);
  const lockfileChanged = classified.lockfiles.length > 0;
  if (lockfileChanged && !allowLockfile) problems.push("pnpm-lock.yaml changed");
  const details = { problems, lockfileChanged, allowLockfile };
  if (problems.length > 0) {
    const hint = lockfileChanged && !allowLockfile && problems.length === 1
      ? "never commit pnpm-lock.yaml in this repo unless intended; revert it, or pass --allow-lockfile if the change is deliberate"
      : `remove the secret or env file from the diff and rotate it (${problems.join("; ")})`;
    return check("no_secrets", "FAIL", hint, details);
  }
  if (lockfileChanged) {
    return check("no_secrets", "WARN", "pnpm-lock.yaml changed (allowed by --allow-lockfile); say why in the PR body", details);
  }
  return check("no_secrets", "PASS", "no env files, secret-like tokens or lockfile changes", details);
}

export function checkFileCount(paths) {
  const count = paths.length;
  if (count > MAX_FILE_COUNT) {
    return check("file_count", "FAIL", `${count} files changed; Greptile file limit is ${MAX_FILE_COUNT}, split the PR`, { count });
  }
  return check("file_count", "PASS", `${count} files changed`, { count });
}

function stripModuleExtension(name) {
  return name.replace(/\.(?:js|mjs|cjs|ts|mts|cts|tsx|jsx)$/, "");
}

export function moduleNames(filePath) {
  const base = stripModuleExtension(path.posix.basename(filePath));
  if (base === "index") return [base, path.posix.basename(path.posix.dirname(filePath))];
  return [base];
}

export function importedModuleNames(content) {
  const names = new Set();
  const pattern = /["'](\.{1,2}\/[^"']+)["']/g;
  for (const match of String(content ?? "").matchAll(pattern)) {
    for (const name of moduleNames(match[1])) names.add(name);
  }
  return [...names];
}

const GENERIC_WORDS = new Set(["test", "tests", "spec", "index"]);

export function basenameWords(filePath) {
  const base = path.posix.basename(filePath).replace(/\.test\.ts$/, "");
  return stripModuleExtension(base)
    .split(/[^a-z0-9]+/i)
    .map((word) => word.toLowerCase())
    .filter((word) => word.length >= 3 && !GENERIC_WORDS.has(word));
}

// The colocated test of server/src/<dir>/x.ts is server/src/<dir>/x.test.ts.
export function siblingTestPath(modulePath) {
  const normalized = normalizePath(modulePath);
  const dir = path.posix.dirname(normalized);
  const base = stripModuleExtension(path.posix.basename(normalized));
  return `${dir}/${base}.test.ts`;
}

// testFiles: [{ path, content }] for every server/src/**/*.test.ts (the flat
// server/src/__tests__ dir plus the tests colocated next to their modules).
export function selectServerTests({ changedPaths, testFiles }) {
  const server = (changedPaths ?? []).map(normalizePath).filter((entry) => entry.startsWith("server/"));
  const direct = server.filter((entry) => /^server\/src\/.*\.test\.ts$/.test(entry));
  const modules = server.filter((entry) => /^server\/src\/.*\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry));
  const known = new Set((testFiles ?? []).map((file) => normalizePath(file.path)));
  const bySibling = modules.map(siblingTestPath).filter((entry) => known.has(entry));
  const changedNames = new Set(modules.flatMap(moduleNames));
  const byImport = (testFiles ?? [])
    .filter((file) => importedModuleNames(file.content).some((name) => changedNames.has(name)))
    .map((file) => normalizePath(file.path));
  const files = [...new Set([...direct, ...bySibling, ...byImport])].sort();
  if (files.length > 0) {
    const basis = [
      direct.length > 0 ? "direct" : null,
      bySibling.length > 0 ? "sibling" : null,
      byImport.length > 0 ? "import" : null,
    ].filter(Boolean).join("+");
    return { files, basis };
  }
  const words = new Set(server.flatMap(basenameWords));
  const byWord = (testFiles ?? [])
    .filter((file) => basenameWords(file.path).some((word) => words.has(word)))
    .map((file) => normalizePath(file.path))
    .sort();
  if (byWord.length > 0) return { files: byWord, basis: "basename" };
  return { files: [], basis: "none" };
}

export function serverTestsCommands(files) {
  return [
    { cmd: "pnpm", args: ["--filter", "@paperclipai/plugin-sdk", "ensure-build-deps"] },
    { cmd: "npx", args: ["vitest", "run", ...files] },
  ];
}

export function commandLine(command) {
  return [command.cmd, ...command.args].join(" ");
}

// Returns { check } when no run is needed, or { run: commands, files, basis }.
export function serverTestsPlan({ classified, skipReason, selection }) {
  if (classified.server.length === 0) {
    return { check: check("server_tests", "PASS", "no server files changed", { files: [] }) };
  }
  if (skipReason !== undefined && skipReason !== null && skipReason !== false) {
    const reason = typeof skipReason === "string" ? skipReason.trim() : "";
    if (!reason) {
      return { check: check("server_tests", "FAIL", 'give a reason: --skip-server-tests "<why the server suites were not run>"', { files: [] }) };
    }
    return { check: check("server_tests", "WARN", `server tests skipped: ${reason}`, { files: [], reason }) };
  }
  if (!selection || selection.files.length === 0) {
    return { check: check("server_tests", "WARN", "no matching server test found; state that in the PR body", { files: [], basis: selection?.basis ?? "none" }) };
  }
  return { run: serverTestsCommands(selection.files), files: selection.files, basis: selection.basis };
}

export function serverTestsResult({ files, basis, results }) {
  const failed = results.find((entry) => entry.status !== 0);
  const commands = results.map((entry) => commandLine(entry.command));
  const details = {
    files,
    basis,
    commands,
    exitCodes: results.map((entry) => entry.status),
    output: lastLines(results.map((entry) => entry.output).join("\n"), TAIL_LINES),
  };
  if (failed) {
    return check("server_tests", "FAIL", `fix the failing server tests, then rerun: ${commandLine(failed.command)}`, details);
  }
  return check("server_tests", "PASS", `${files.length} server test file(s) green (${basis}): ${commands.join(" && ")}`, details);
}

export function mapWorkspaces(paths, readPackageName) {
  const names = new Set();
  for (const raw of paths ?? []) {
    const filePath = normalizePath(raw);
    if (filePath.startsWith("server/")) names.add("@paperclipai/server");
    else if (filePath.startsWith("ui/")) names.add("@paperclipai/ui");
    else if (filePath.startsWith("cli/")) names.add("paperclipai");
    else {
      const match = filePath.match(/^(packages\/(?:adapters\/|plugins\/)?[^/]+)\//);
      if (!match) continue;
      const name = readPackageName(match[1]);
      if (name) names.add(name);
    }
  }
  return [...names].sort();
}

export function stripAnsi(text) {
  return String(text ?? "").replace(ANSI_PATTERN, "");
}

export function lastLines(text, count = TAIL_LINES) {
  return stripAnsi(text)
    .replaceAll("\r", "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "")
    .slice(-count);
}

// ---- PR body -------------------------------------------------------------

export function parseSections(body) {
  const text = String(body ?? "").replace(/<!--[\s\S]*?-->/g, "").replaceAll("\r", "");
  const sections = new Map();
  const titles = new Map();
  let current = null;
  for (const line of text.split("\n")) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = heading[1].toLowerCase();
      if (!sections.has(current)) {
        sections.set(current, []);
        titles.set(current, heading[1]);
      }
      continue;
    }
    if (current !== null) sections.get(current).push(line);
  }
  return { text, sections, titles };
}

function sectionLines(parsed, name) {
  return parsed.sections.get(name.toLowerCase()) ?? null;
}

// Template placeholders: a bracketed prompt alone on its line ("- [Change 1]",
// "> - [What problem or gap exists]", "[paste the preflight table here]") or one
// of the template's unfinished stubs ("> - This pull request ..."). Optional
// blockquote and bullet markers are allowed in front. "- [x] item" is not a
// placeholder because text follows the brackets.
const PLACEHOLDER_PREFIX = String.raw`^\s*(?:>\s*)?(?:[-*+]\s*)?`;
export const PLACEHOLDER_BRACKET_PATTERN = new RegExp(`${PLACEHOLDER_PREFIX}\\[[^\\]]*\\]\\s*$`);
export const PLACEHOLDER_STUB_PATTERN = new RegExp(`${PLACEHOLDER_PREFIX}(?:This pull request|The benefit is)\\s*(?:\\.\\.\\.|…)\\s*$`);

export function isPlaceholderLine(line) {
  const text = String(line ?? "");
  return PLACEHOLDER_BRACKET_PATTERN.test(text) || PLACEHOLDER_STUB_PATTERN.test(text);
}

export function findPlaceholders(parsed) {
  const found = [];
  for (const [key, lines] of parsed.sections) {
    const title = parsed.titles?.get(key) ?? key;
    for (const line of lines) {
      if (isPlaceholderLine(line)) found.push({ section: title, line: line.trim() });
    }
  }
  return found;
}

const CODE_FENCE_PATTERN = /^\s*(?:```|~~~)/;

export function isContentLine(line) {
  if (line.trim().startsWith(">")) return false; // template boilerplate blockquotes
  if (CODE_FENCE_PATTERN.test(line)) return false; // the fence is not content, what is inside it is
  if (isPlaceholderLine(line)) return false; // unfilled template prompt
  return line.replace(/^\s*(?:[-*+]\s*)?/, "").trim() !== "";
}

export function thinkingPathSteps(lines) {
  return lines
    .filter((line) => !isPlaceholderLine(line))
    .map((line) => line.match(/^\s*>\s*-\s+(.*\S)\s*$/))
    .filter(Boolean)
    .map((match) => match[1]);
}

const BOLD_LABEL_PATTERN = /^\s*\*\*[^*]+\*\*:?\s*$/;

export function linkedIssuesSatisfied(lines) {
  if (lines.some((line) => /(Fixes:?|Closes|Refs) #\d+/.test(line))) return true;
  let labels = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (!BOLD_LABEL_PATTERN.test(lines[index])) continue;
    let next = index + 1;
    while (next < lines.length && lines[next].trim() === "") next += 1;
    if (next >= lines.length) continue;
    const candidate = lines[next];
    if (BOLD_LABEL_PATTERN.test(candidate)) continue;
    if (candidate.replace(/^\s*(?:[-*+]\s*)?/, "").trim() === "") continue;
    if (isPlaceholderLine(candidate)) continue; // "[One or two sentences ...]" is not content
    labels += 1;
  }
  return labels >= 3;
}

export function uncheckedChecklistItems(lines) {
  return lines
    .filter((line) => /^\s*[-*]\s+\[ \]/.test(line))
    .map((line) => line.replace(/^\s*[-*]\s+\[ \]\s*/, "").trim())
    .filter((item) => !CHECKLIST_MAY_STAY_UNCHECKED.some((allowed) => item.includes(allowed)));
}

export function validatePrBody(body) {
  const problems = [];
  const parsed = parseSections(body);

  const thinking = sectionLines(parsed, "Thinking Path");
  if (!thinking) problems.push('missing section "## Thinking Path"');
  else {
    const steps = thinkingPathSteps(thinking);
    if (steps.length < 5) problems.push(`"## Thinking Path" needs at least 5 "> -" lines (found ${steps.length})`);
    if (!steps[0] || !steps[0].startsWith(THINKING_PATH_OPENER)) {
      problems.push(`"## Thinking Path" first line must start with "${THINKING_PATH_OPENER}"`);
    }
  }

  const linked = sectionLines(parsed, "Linked Issues or Issue Description");
  if (!linked) problems.push('missing section "## Linked Issues or Issue Description"');
  else if (!linkedIssuesSatisfied(linked)) {
    problems.push('"## Linked Issues or Issue Description" needs "Fixes: #N"/"Closes #N"/"Refs #N" or at least 3 bold **labels** each followed by real content');
  }

  for (const name of REQUIRED_CONTENT_SECTIONS) {
    const lines = sectionLines(parsed, name);
    if (!lines) problems.push(`missing section "## ${name}"`);
    else if (!lines.some(isContentLine)) problems.push(`"## ${name}" has no content (a bare "-" is a placeholder)`);
  }

  const checklist = sectionLines(parsed, "Checklist");
  if (!checklist) problems.push('missing section "## Checklist"');
  else {
    const unchecked = uncheckedChecklistItems(checklist);
    if (unchecked.length > 0) {
      problems.push(`"## Checklist" has ${unchecked.length} unchecked item(s): ${unchecked.map((item) => item.slice(0, 60)).join(" | ")}`);
    }
  }

  // Unfilled template prompts count as empty above; name each one so the fix is obvious.
  for (const placeholder of findPlaceholders(parsed)) {
    problems.push(`placeholder left in "## ${placeholder.section}": ${placeholder.line.slice(0, 60)}`);
  }

  const internal = parsed.text.match(INTERNAL_REFERENCE_PATTERN);
  if (internal) problems.push(`internal reference "${internal[0]}" found; only public GitHub #NNN references and github.com URLs are allowed`);

  return { ok: problems.length === 0, problems };
}

export function validateTitle(title) {
  const problems = [];
  const text = String(title ?? "").trim();
  if (!text) problems.push("title is empty");
  if (text.length > MAX_TITLE_LENGTH) problems.push(`title is ${text.length} chars; keep it at most ${MAX_TITLE_LENGTH}`);
  if (/\.$/.test(text)) problems.push("title must not end with a period");
  if (/^[a-z]+ed\b/.test(text)) problems.push('title starts with a lowercase past-tense verb; use the imperative mood ("Add", "Fix", "Update")');
  return { ok: problems.length === 0, problems };
}

export function checkPrBody({ body, title }) {
  if (body === undefined || body === null) {
    return check("pr_body", "WARN", "no --body-file given; run again with the PR body before opening the PR", null);
  }
  const bodyResult = validatePrBody(body);
  const titleChecked = title !== undefined && title !== null;
  const titleResult = titleChecked ? validateTitle(title) : { ok: true, problems: [] };
  const problems = [...bodyResult.problems, ...titleResult.problems];
  const details = { bodyProblems: bodyResult.problems, titleProblems: titleResult.problems, titleChecked };
  if (problems.length > 0) {
    return check("pr_body", "FAIL", `fix the PR body/title against .github/PULL_REQUEST_TEMPLATE.md: ${problems.join("; ")}`, details);
  }
  return check("pr_body", "PASS", titleChecked ? "body and title match the PR template" : "body matches the PR template (no --title given)", details);
}

// ---- Rendering -----------------------------------------------------------

export function overallResult(checks) {
  return checks.some((entry) => entry.status === "FAIL") ? "FAIL" : "PASS";
}

export function renderTable(checks) {
  const lines = checks.map((entry) => `${entry.id} | ${entry.status} | ${entry.hint}`);
  lines.push(`preflight: ${overallResult(checks)}`);
  return lines.join("\n");
}

export function renderJson(checks) {
  return JSON.stringify({ checks, result: overallResult(checks) });
}

// ---------------------------------------------------------------------------
// Data collection (git, pnpm, npx) - no rule logic below this line
// ---------------------------------------------------------------------------

export function run(cmd, args, { cwd } = {}) {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    cwd,
    maxBuffer: SPAWN_MAX_BUFFER_BYTES,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.error ? -1 : (result.status ?? -1),
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ? result.error.message : null,
  };
}

function git(args, cwd) {
  return run("git", args, { cwd });
}

function gitLines(args, cwd) {
  const result = git(args, cwd);
  if (result.status !== 0) return [];
  return result.stdout.split(/\r?\n/).map(normalizePath).filter(Boolean);
}

function readTextIfSmall(filePath) {
  try {
    const stats = statSync(filePath);
    if (!stats.isFile() || stats.size > MAX_UNTRACKED_SCAN_BYTES) return null;
    const content = readFileSync(filePath, "utf8");
    if (content.includes(NUL)) return null;
    return content;
  } catch {
    return null;
  }
}

function collectDiffText(repoRoot, diffBase, untracked) {
  const parts = [];
  const committed = git(["diff", `${diffBase}...HEAD`], repoRoot);
  if (committed.status === 0) parts.push(committed.stdout);
  const working = git(["diff", "HEAD"], repoRoot);
  if (working.status === 0) parts.push(working.stdout);
  for (const filePath of untracked) {
    const content = readTextIfSmall(path.join(repoRoot, filePath));
    if (content === null) continue;
    parts.push(`+++ b/${filePath}\n${content.split("\n").map((line) => `+${line}`).join("\n")}`);
  }
  return parts.join("\n");
}

const SKIPPED_TEST_DIRS = new Set(["node_modules", "dist"]);

// Every server/src/**/*.test.ts: the flat __tests__ dir and the tests colocated
// next to their modules (server/src/services/x.test.ts, server/src/routes/...).
export function listTestFiles(root, relativeDir, { readDir = readdirSync, exists = existsSync } = {}) {
  const absolute = path.join(root, ...relativeDir.split("/"));
  if (!exists(absolute)) return [];
  const found = [];
  for (const entry of readDir(absolute, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIPPED_TEST_DIRS.has(entry.name)) continue;
      found.push(...listTestFiles(root, `${relativeDir}/${entry.name}`, { readDir, exists }));
    } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      found.push(`${relativeDir}/${entry.name}`);
    }
  }
  return found.sort();
}

function loadServerTestFiles(repoRoot) {
  return listTestFiles(repoRoot, "server/src").map((relative) => ({
    path: relative,
    content: readFileSync(path.join(repoRoot, ...relative.split("/")), "utf8"),
  }));
}

function packageNameReader(repoRoot) {
  return (dir) => {
    try {
      const parsed = JSON.parse(readFileSync(path.join(repoRoot, dir, "package.json"), "utf8"));
      return typeof parsed.name === "string" ? parsed.name : null;
    } catch {
      return null;
    }
  };
}

function runCommandsSequentially(commands, repoRoot, onStart) {
  const results = [];
  for (const command of commands) {
    onStart?.(command);
    const result = run(command.cmd, command.args, { cwd: repoRoot });
    results.push({
      command,
      status: result.status,
      output: `${result.stdout}\n${result.stderr}${result.error ? `\n${result.error}` : ""}`,
    });
    if (result.status !== 0) break;
  }
  return results;
}

function usage() {
  return [
    "usage: node .claude/skills/pr-loop/scripts/pr-preflight.mjs [--base origin/develop] [--body-file <path>]",
    '       [--title "<pr title>"] [--json] [--allow-lockfile] [--skip-server-tests "<reason>"] [--no-fetch]',
  ].join("\n");
}

export function collectPreflight(options, { log = () => {} } = {}) {
  const base = typeof options.base === "string" ? options.base : DEFAULT_BASE;
  const baseBranch = base.replace(/^origin\//, "");
  const top = git(["rev-parse", "--show-toplevel"]);
  if (top.status !== 0) throw new Error("not inside a git repository");
  const repoRoot = top.stdout.trim();
  const checks = [];

  // branch_prefix
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], repoRoot).stdout.trim();
  checks.push(checkBranchPrefix(branch));

  // base_current
  let fetchError = null;
  const fetched = !options.no_fetch;
  if (fetched) {
    log(`fetching ${base}...`);
    const fetch = git(["fetch", "--quiet", "origin", baseBranch], repoRoot);
    if (fetch.status !== 0) fetchError = lastLines(fetch.stderr || fetch.error || "", 1)[0] ?? `exit ${fetch.status}`;
  }
  // No "^{commit}" suffix: on Windows the args pass through cmd.exe, where ^ is an escape character.
  const baseTipResult = git(["rev-parse", "--verify", "--quiet", base], repoRoot);
  const baseTip = baseTipResult.status === 0 ? baseTipResult.stdout.trim() : null;
  const mergeBaseResult = baseTip ? git(["merge-base", "HEAD", base], repoRoot) : { status: 1, stdout: "" };
  const mergeBase = mergeBaseResult.status === 0 ? mergeBaseResult.stdout.trim() : null;
  checks.push(checkBaseCurrent({ base, mergeBase, baseTip, fetched, fetchError }));

  // changed files: committed since base + staged/unstaged/untracked
  const committedPaths = baseTip ? gitLines(["diff", "--name-only", `${base}...HEAD`], repoRoot) : [];
  const status = parsePorcelainStatus(git(["status", "--porcelain=v1", "-z", "--untracked-files=all"], repoRoot).stdout);
  const classified = classifyPaths([...committedPaths, ...status.paths]);
  const existing = classified.all.filter((entry) => existsSync(path.join(repoRoot, entry)));

  // scope_pipeline_mix
  checks.push(checkPipelineMix(classified));

  // no_secrets
  const diffText = collectDiffText(repoRoot, baseTip ? base : "HEAD", status.untracked);
  checks.push(checkSecretsInDiff({ classified, diffText, allowLockfile: Boolean(options.allow_lockfile) }));

  // file_count
  checks.push(checkFileCount(classified.all));

  // server_tests
  const skipReason = options.skip_server_tests === true ? "" : options.skip_server_tests;
  const selection = classified.server.length > 0 && skipReason === undefined
    ? selectServerTests({ changedPaths: existing, testFiles: loadServerTestFiles(repoRoot) })
    : null;
  const plan = serverTestsPlan({ classified, skipReason, selection });
  if (plan.check) checks.push(plan.check);
  else {
    const results = runCommandsSequentially(plan.run, repoRoot, (command) => log(`running: ${commandLine(command)}`));
    checks.push(serverTestsResult({ files: plan.files, basis: plan.basis, results }));
  }

  // ui_token_gates
  if (classified.uiGated.length === 0) {
    checks.push(check("ui_token_gates", "PASS", "no ui component/page files changed", { files: [] }));
  } else {
    const command = { cmd: "pnpm", args: ["check:token-gates"] };
    const [result] = runCommandsSequentially([command], repoRoot, (entry) => log(`running: ${commandLine(entry)}`));
    const details = { files: classified.uiGated, command: commandLine(command), exitCode: result.status, output: lastLines(result.output, TAIL_LINES) };
    checks.push(
      result.status === 0
        ? check("ui_token_gates", "PASS", `${commandLine(command)} passed`, details)
        : check("ui_token_gates", "FAIL", `fix the token violations reported by ${commandLine(command)} (see docs/designs/DESIGN-UI.md)`, details),
    );
  }

  // typecheck_touched
  const workspaces = mapWorkspaces(classified.all, packageNameReader(repoRoot));
  if (workspaces.length === 0) {
    checks.push(check("typecheck_touched", "PASS", "no workspace touched", { workspaces: [] }));
  } else {
    const commands = workspaces.map((name) => ({ cmd: "pnpm", args: ["--filter", name, "typecheck"] }));
    const results = runCommandsSequentially(commands, repoRoot, (command) => log(`running: ${commandLine(command)}`));
    const failed = results.find((entry) => entry.status !== 0);
    const details = {
      workspaces,
      commands: commands.map(commandLine),
      exitCodes: results.map((entry) => entry.status),
      output: lastLines(results.map((entry) => entry.output).join("\n"), TAIL_LINES),
    };
    checks.push(
      failed
        ? check("typecheck_touched", "FAIL", `fix the type errors, then rerun: ${commandLine(failed.command)}`, details)
        : check("typecheck_touched", "PASS", `typecheck green for ${workspaces.join(", ")}`, details),
    );
  }

  // pr_body
  if (options.body_file === true) {
    checks.push(check("pr_body", "FAIL", "--body-file needs a path to the PR body markdown file", null));
  } else {
    const body = typeof options.body_file === "string" ? readFileSync(path.resolve(process.cwd(), options.body_file), "utf8") : null;
    const title = typeof options.title === "string" ? options.title : options.title === true ? "" : undefined;
    checks.push(checkPrBody({ body, title }));
  }

  return { checks, result: overallResult(checks), repoRoot, branch, base };
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2), {});
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const json = Boolean(options.json);
  const log = json ? () => {} : (message) => process.stderr.write(`${message}\n`);
  const assessment = collectPreflight(options, { log });
  process.stdout.write(`${json ? renderJson(assessment.checks) : renderTable(assessment.checks)}\n`);
  process.exitCode = assessment.result === "PASS" ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
