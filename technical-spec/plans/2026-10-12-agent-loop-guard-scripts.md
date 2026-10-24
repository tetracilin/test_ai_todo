# Agent Loop Guard and State Scripts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the three pure Node scripts that decide whether an agent patch may be pushed and what state an agent issue is in: `agent-patch.mjs`, `agent-guard.mjs`, `agent-state.mjs`, each with `node --test` tests.

**Architecture:** `agent-patch.mjs` parses a unified git diff into per-file records. `agent-guard.mjs` applies the spec's guard rules to those records and returns a verdict (plus a thin git-backed CLI). `agent-state.mjs` holds the label transitions, daily PR cap and CI-round count as pure functions (plus a stdin/stdout CLI). No script touches the network, GitHub or the agent.

**Tech Stack:** Node 22/24 ES modules (`.mjs`), `node:test`, `node:assert/strict`. No dependencies. Same conventions as `scripts/check-no-git-push.mjs`.

**Spec:** `technical-spec/specs/2026-10-12-agent-issue-loop-design.md` (sections 4.1, 5, 7, 9 step 1).

## Global Constraints

- Plain `.mjs` files under `scripts/`; tests under `scripts/__tests__/agent-*.test.mjs`. No new dependencies.
- Limits are exactly: `maxFiles: 15`, `maxChangedLines: 400`, both inclusive (15 and 400 pass; 16 and 401 fail).
- Daily cap is 3 agent PRs per UTC day; CI-fix rounds are capped at 3, counted from the commit trailer `T3-Agent-Round: <n>`.
- Label names are exactly: `agent-ready`, `agent-working`, `agent-pr`, `agent-blocked`, `ready-to-merge`. Issues labelled `decision` or `ci` are never eligible.
- Protected paths: `.github/workflows/`, `deploy/`, `CICD/`, any file whose name starts with `.env`, any `secrets` path segment, `pnpm-lock.yaml`, `.github/PULL_REQUEST_TEMPLATE.md`, and the agent scripts and their tests (`scripts/agent-*.mjs`, `scripts/__tests__/agent-*.test.mjs`). Dependency sections of any `package.json` and `packages/db/src/migrations/` are also guarded.
- The guard fails closed: anything it cannot verify is a violation.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- This plan changes application code only. It does **not** touch `.github/workflows/`; wiring these tests into t3-ci is a separate `ci` PR (Task 7).

## Review Focus

Inputs the spec implies but does not spell out, most likely to bite first. Each has a test in the task named.

1. A patch whose hunk content looks like a file header (a removed line starting `-- ` shows as `--- ...`): must count as content, never start a new file. (Task 1)
2. CRLF line endings and `\ No newline at end of file` markers must not change counts or hide a file. (Task 1)
3. A rename into or out of a protected directory, and a mode-only change (`chmod +x` on a workflow, which has no hunks): must be rejected. (Task 2)
4. A package.json the guard cannot read, a nested workspace package.json, and `pnpm.overrides` (not a "dependencies" key): must fail closed or be treated as dependency sections. (Task 3)
5. Daily-cap day boundary with a non-UTC offset on the PR timestamp, and a `T3-Agent-Round:` string inside a sentence (not a trailer): must not miscount. (Task 6)

---

### Task 1: Patch parser

**Files:**
- Create: `scripts/agent-patch.mjs`
- Test: `scripts/__tests__/agent-patch.test.mjs`

**Interfaces:**
- Produces: `parsePatch(text: string): FileRecord[]` where `FileRecord = { path: string|null, oldPath: string|null, newPath: string|null, status: "modified"|"added"|"deleted"|"renamed", mode: string|null, binary: boolean, added: number, removed: number, addedLines: string[], removedLines: string[] }`. `path` is `newPath ?? oldPath`. Line arrays hold content without the leading `+`/`-`.

- [ ] **Step 1: Write the failing test**

Create `scripts/__tests__/agent-patch.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import { parsePatch } from "../agent-patch.mjs";

const modify = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 111..222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,3 +1,3 @@",
  " keep",
  "-old",
  "+new",
  " tail",
  "",
].join("\n");

test("parses a modified file with line counts and content", () => {
  const [file] = parsePatch(modify);
  assert.equal(file.path, "src/a.ts");
  assert.equal(file.status, "modified");
  assert.equal(file.added, 1);
  assert.equal(file.removed, 1);
  assert.deepEqual(file.addedLines, ["new"]);
  assert.deepEqual(file.removedLines, ["old"]);
});

test("parses added and deleted files", () => {
  const patch = [
    "diff --git a/new.txt b/new.txt",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/new.txt",
    "@@ -0,0 +1,2 @@",
    "+one",
    "+two",
    "diff --git a/gone.txt b/gone.txt",
    "deleted file mode 100644",
    "--- a/gone.txt",
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-bye",
    "",
  ].join("\n");
  const [added, deleted] = parsePatch(patch);
  assert.equal(added.status, "added");
  assert.equal(added.path, "new.txt");
  assert.equal(added.added, 2);
  assert.equal(deleted.status, "deleted");
  assert.equal(deleted.path, "gone.txt");
  assert.equal(deleted.removed, 1);
});

test("records both sides of a rename", () => {
  const patch = [
    "diff --git a/old/name.ts b/new/name.ts",
    "similarity index 100%",
    "rename from old/name.ts",
    "rename to new/name.ts",
    "",
  ].join("\n");
  const [file] = parsePatch(patch);
  assert.equal(file.status, "renamed");
  assert.equal(file.oldPath, "old/name.ts");
  assert.equal(file.newPath, "new/name.ts");
  assert.equal(file.path, "new/name.ts");
});

test("a mode-only change still yields a file record with no hunks", () => {
  const patch = [
    "diff --git a/.github/workflows/t3-ci.yml b/.github/workflows/t3-ci.yml",
    "old mode 100644",
    "new mode 100755",
    "",
  ].join("\n");
  const [file] = parsePatch(patch);
  assert.equal(file.path, ".github/workflows/t3-ci.yml");
  assert.equal(file.mode, "100755");
  assert.equal(file.added + file.removed, 0);
});

test("hunk content that looks like a file header is counted as content", () => {
  const patch = [
    "diff --git a/notes.md b/notes.md",
    "--- a/notes.md",
    "+++ b/notes.md",
    "@@ -1,2 +1,2 @@",
    "--- a/evil/path",
    "+++ b/evil/path",
    " tail",
    "",
  ].join("\n");
  const files = parsePatch(patch);
  assert.equal(files.length, 1);
  assert.equal(files[0].path, "notes.md");
  assert.deepEqual(files[0].removedLines, ["-- a/evil/path"]);
  assert.deepEqual(files[0].addedLines, ["++ b/evil/path"]);
});

test("CRLF patches and 'No newline' markers do not change the counts", () => {
  const patch = [
    "diff --git a/f.txt b/f.txt",
    "--- a/f.txt",
    "+++ b/f.txt",
    "@@ -1 +1 @@",
    "-a",
    "\\ No newline at end of file",
    "+b",
    "\\ No newline at end of file",
    "",
  ].join("\r\n");
  const [file] = parsePatch(patch);
  assert.equal(file.added, 1);
  assert.equal(file.removed, 1);
});

test("paths with spaces are parsed from quoted and unquoted headers", () => {
  const patch = [
    'diff --git "a/dir/with space.ts" "b/dir/with space.ts"',
    '--- "a/dir/with space.ts"',
    '+++ "b/dir/with space.ts"',
    "@@ -1 +1 @@",
    "-x",
    "+y",
    "diff --git a/plain dir/f.ts b/plain dir/f.ts",
    "--- a/plain dir/f.ts",
    "+++ b/plain dir/f.ts",
    "@@ -1 +1 @@",
    "-x",
    "+y",
    "",
  ].join("\n");
  const [quoted, plain] = parsePatch(patch);
  assert.equal(quoted.path, "dir/with space.ts");
  assert.equal(plain.path, "plain dir/f.ts");
});

test("binary changes are flagged", () => {
  const patch = [
    "diff --git a/img.png b/img.png",
    "index 1..2 100644",
    "Binary files a/img.png and b/img.png differ",
    "",
  ].join("\n");
  assert.equal(parsePatch(patch)[0].binary, true);
});

test("an empty patch yields no files", () => {
  assert.deepEqual(parsePatch(""), []);
  assert.deepEqual(parsePatch("\n\n"), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/__tests__/agent-patch.test.mjs`
Expected: FAIL with `Cannot find module '.../scripts/agent-patch.mjs'`.

- [ ] **Step 3: Write the implementation**

Create `scripts/agent-patch.mjs`:

```js
// Parses a unified git diff into one record per file for scripts/agent-guard.mjs.
//
// Hunk bodies are walked using the line counts in each "@@" header, so a content
// line such as "--- a/x" (a removed line whose text starts with "-- ") is never
// mistaken for a file header.

const DEV_NULL = "/dev/null";

function unquote(value) {
  const trimmed = value.replace(/\t.*$/, "").trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\(["\\])/g, "$1");
  }
  return trimmed;
}

function stripSide(value) {
  const unquoted = unquote(value);
  if (unquoted === DEV_NULL) return null;
  return unquoted.replace(/^[ab]\//, "");
}

function newRecord() {
  return {
    path: null,
    oldPath: null,
    newPath: null,
    status: "modified",
    mode: null,
    binary: false,
    added: 0,
    removed: 0,
    addedLines: [],
    removedLines: [],
  };
}

function parseDiffHeader(line, record) {
  const quoted = /^diff --git ("(?:[^"\\]|\\.)*"|\S+) ("(?:[^"\\]|\\.)*"|\S+)$/.exec(line);
  if (quoted) {
    record.oldPath = stripSide(quoted[1]);
    record.newPath = stripSide(quoted[2]);
    return;
  }
  const spaced = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
  if (spaced) {
    record.oldPath = spaced[1];
    record.newPath = spaced[2];
  }
}

export function parsePatch(text) {
  const files = [];
  const lines = String(text).replace(/\r\n/g, "\n").split("\n");
  let current = null;
  let oldLeft = 0;
  let newLeft = 0;

  for (const line of lines) {
    if (current && (oldLeft > 0 || newLeft > 0)) {
      const marker = line[0];
      if (marker === "\\") continue;
      if (marker === "+") {
        current.added += 1;
        current.addedLines.push(line.slice(1));
        newLeft -= 1;
      } else if (marker === "-") {
        current.removed += 1;
        current.removedLines.push(line.slice(1));
        oldLeft -= 1;
      } else {
        oldLeft -= 1;
        newLeft -= 1;
      }
      continue;
    }

    if (line.startsWith("diff --git ")) {
      current = newRecord();
      parseDiffHeader(line, current);
      files.push(current);
      continue;
    }
    if (!current) continue;

    const hunk = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1]);
      newLeft = hunk[2] === undefined ? 1 : Number(hunk[2]);
      continue;
    }
    if (line.startsWith("new file mode ")) {
      current.status = "added";
      current.mode = line.slice("new file mode ".length).trim();
    } else if (line.startsWith("deleted file mode ")) {
      current.status = "deleted";
      current.mode = line.slice("deleted file mode ".length).trim();
    } else if (line.startsWith("new mode ")) {
      current.mode = line.slice("new mode ".length).trim();
    } else if (line.startsWith("rename from ")) {
      current.status = "renamed";
      current.oldPath = unquote(line.slice("rename from ".length));
    } else if (line.startsWith("rename to ")) {
      current.status = "renamed";
      current.newPath = unquote(line.slice("rename to ".length));
    } else if (line.startsWith("--- ")) {
      current.oldPath = stripSide(line.slice(4));
    } else if (line.startsWith("+++ ")) {
      current.newPath = stripSide(line.slice(4));
    } else if (line.startsWith("GIT binary patch") || line.startsWith("Binary files ")) {
      current.binary = true;
    }
  }

  for (const record of files) {
    if (record.status === "added") record.oldPath = null;
    if (record.status === "deleted") record.newPath = null;
    record.path = record.newPath ?? record.oldPath;
  }
  return files;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/__tests__/agent-patch.test.mjs`
Expected: `# pass 9`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add scripts/agent-patch.mjs scripts/__tests__/agent-patch.test.mjs
git commit -m "feat(scripts): parse unified diffs for the agent guard

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Guard structural rules

**Files:**
- Create: `scripts/agent-guard.mjs`
- Test: `scripts/__tests__/agent-guard.test.mjs`

**Interfaces:**
- Consumes: `parsePatch` from `./agent-patch.mjs` (Task 1).
- Produces: `LIMITS: { maxFiles: 15, maxChangedLines: 400 }` (frozen); `checkPatch({ patch, readBefore, readAfter, limits }): Verdict` where `Verdict = { ok: boolean, violations: { rule: string, path: string|null, detail: string }[], stats: { files: number, changedLines: number } }`. Rule names used in this task: `empty-patch`, `path-escape`, `protected-path`, `migration`, `symlink`, `binary`, `size`. `readBefore`/`readAfter` are accepted now and used from Task 3.

- [ ] **Step 1: Write the failing test**

Create `scripts/__tests__/agent-guard.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import { LIMITS, checkPatch } from "../agent-guard.mjs";

// Builds a one-hunk "modified" patch for a path.
function modifyPatch(file, removed = ["old"], added = ["new"]) {
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,${removed.length} +1,${added.length} @@`,
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
    "",
  ].join("\n");
}

function rules(verdict) {
  return verdict.violations.map((violation) => violation.rule);
}

test("a small source change passes", () => {
  const verdict = checkPatch({ patch: modifyPatch("server/src/routes/health.ts") });
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.stats, { files: 1, changedLines: 2 });
});

test("an empty patch is rejected", () => {
  assert.deepEqual(rules(checkPatch({ patch: "" })), ["empty-patch"]);
  assert.deepEqual(rules(checkPatch({ patch: "\n" })), ["empty-patch"]);
});

for (const protectedFile of [
  ".github/workflows/t3-ci.yml",
  "deploy/compose.yaml",
  "deploy/scripts/healthcheck.sh",
  "CICD/PLAN_CICD.md",
  ".env",
  ".env.example",
  "apps/api/.env.local",
  "server/secrets/master.key",
  "pnpm-lock.yaml",
  ".github/PULL_REQUEST_TEMPLATE.md",
  "scripts/agent-guard.mjs",
  "scripts/agent-state.mjs",
  "scripts/agent-patch.mjs",
  "scripts/__tests__/agent-guard.test.mjs",
]) {
  test(`protected path is rejected: ${protectedFile}`, () => {
    const verdict = checkPatch({ patch: modifyPatch(protectedFile) });
    assert.ok(rules(verdict).includes("protected-path"), JSON.stringify(verdict));
  });
}

test("unrelated paths that merely resemble protected ones pass", () => {
  for (const ok of [
    "server/src/deploy-notes.ts",
    "docs/CICD-overview.md",
    "scripts/check-no-git-push.mjs",
    "ui/src/environment.ts",
  ]) {
    assert.equal(checkPatch({ patch: modifyPatch(ok) }).ok, true, ok);
  }
});

test("renaming a normal file into a protected path is rejected", () => {
  const patch = [
    "diff --git a/docs/x.yml b/.github/workflows/x.yml",
    "similarity index 100%",
    "rename from docs/x.yml",
    "rename to .github/workflows/x.yml",
    "",
  ].join("\n");
  assert.ok(rules(checkPatch({ patch })).includes("protected-path"));
});

test("renaming a protected file out of its directory is rejected", () => {
  const patch = [
    "diff --git a/.github/workflows/t3-ci.yml b/docs/t3-ci.yml",
    "similarity index 100%",
    "rename from .github/workflows/t3-ci.yml",
    "rename to docs/t3-ci.yml",
    "",
  ].join("\n");
  assert.ok(rules(checkPatch({ patch })).includes("protected-path"));
});

test("a mode-only change to a workflow is rejected", () => {
  const patch = [
    "diff --git a/.github/workflows/t3-ci.yml b/.github/workflows/t3-ci.yml",
    "old mode 100644",
    "new mode 100755",
    "",
  ].join("\n");
  assert.ok(rules(checkPatch({ patch })).includes("protected-path"));
});

test("paths that leave the repository are rejected and never read", () => {
  let reads = 0;
  const read = () => {
    reads += 1;
    return "{}";
  };
  for (const bad of ["../outside.txt", "/etc/passwd", "C:/Windows/x", "a\\b.txt", "a/../../b.txt"]) {
    const verdict = checkPatch({ patch: modifyPatch(bad), readBefore: read, readAfter: read });
    assert.deepEqual(rules(verdict), ["path-escape"], bad);
  }
  assert.equal(reads, 0);
});

test("database migrations are rejected", () => {
  const verdict = checkPatch({ patch: modifyPatch("packages/db/src/migrations/0099_x.sql") });
  assert.ok(rules(verdict).includes("migration"));
});

test("symlinks are rejected", () => {
  const patch = [
    "diff --git a/link b/link",
    "new file mode 120000",
    "--- /dev/null",
    "+++ b/link",
    "@@ -0,0 +1 @@",
    "+../../etc/passwd",
    "",
  ].join("\n");
  assert.ok(rules(checkPatch({ patch })).includes("symlink"));
});

test("binary changes are rejected", () => {
  const patch = [
    "diff --git a/logo.png b/logo.png",
    "Binary files a/logo.png and b/logo.png differ",
    "",
  ].join("\n");
  assert.ok(rules(checkPatch({ patch })).includes("binary"));
});

function manyFiles(count) {
  return Array.from({ length: count }, (_, i) => modifyPatch(`src/f${i}.ts`)).join("");
}

test("the file limit is inclusive: 15 pass, 16 fail", () => {
  assert.equal(LIMITS.maxFiles, 15);
  assert.equal(checkPatch({ patch: manyFiles(15) }).ok, true);
  const verdict = checkPatch({ patch: manyFiles(16) });
  assert.deepEqual(rules(verdict), ["size"]);
});

test("the changed-line limit is inclusive: 400 pass, 401 fail", () => {
  assert.equal(LIMITS.maxChangedLines, 400);
  const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i}`);
  assert.equal(checkPatch({ patch: modifyPatch("src/a.ts", lines(200), lines(200)) }).ok, true);
  const over = checkPatch({ patch: modifyPatch("src/a.ts", lines(200), lines(201)) });
  assert.deepEqual(rules(over), ["size"]);
});

test("several violations are all reported", () => {
  const patch = modifyPatch(".github/workflows/x.yml") + modifyPatch("packages/db/src/migrations/1.sql");
  assert.deepEqual(rules(checkPatch({ patch })).sort(), ["migration", "protected-path"]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/__tests__/agent-guard.test.mjs`
Expected: FAIL with `Cannot find module '.../scripts/agent-guard.mjs'`.

- [ ] **Step 3: Write the implementation**

Create `scripts/agent-guard.mjs`:

```js
#!/usr/bin/env node
/**
 * agent-guard.mjs
 *
 * Decides whether a patch written by an agent may be pushed. Pure rules over a
 * unified git diff; the CLI at the bottom is a thin wrapper for workflows.
 * Design: technical-spec/specs/2026-10-12-agent-issue-loop-design.md section 5.
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/__tests__/agent-guard.test.mjs`
Expected: `# pass 27`, `# fail 0`.

- [ ] **Step 5: Prove the tests can fail (mutation check)**

Run each, expect the stated result, then restore with `git checkout -- scripts/agent-guard.mjs` is NOT possible (file is new); instead restore by re-running the sed in reverse:

```bash
sed -i 's/maxFiles: 15/maxFiles: 16/' scripts/agent-guard.mjs
node --test scripts/__tests__/agent-guard.test.mjs    # Expected: # fail 1 (the file-limit test)
sed -i 's/maxFiles: 16/maxFiles: 15/' scripts/agent-guard.mjs
sed -i 's/if (touched.some(escapesRepo))/if (false)/' scripts/agent-guard.mjs
node --test scripts/__tests__/agent-guard.test.mjs    # Expected: # fail >= 1 (the path-escape test)
sed -i 's/if (false)/if (touched.some(escapesRepo))/' scripts/agent-guard.mjs
node --test scripts/__tests__/agent-guard.test.mjs    # Expected: # pass 27, # fail 0
```

- [ ] **Step 6: Commit**

```bash
git add scripts/agent-guard.mjs scripts/__tests__/agent-guard.test.mjs
git commit -m "feat(scripts): add agent guard structural rules

Protected paths, path escape, migrations, symlinks, binary changes and the
15-file / 400-line limits.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Guard dependency and test-weakening rules

**Files:**
- Modify: `scripts/agent-guard.mjs`
- Modify: `scripts/__tests__/agent-guard.test.mjs`

**Interfaces:**
- Consumes: `checkPatch` and `rules()` helper from Task 2. `readBefore(path): string|null` returns the file at the base commit; `readAfter(path): string|null` returns it with the patch applied.
- Produces: new rule names `dependency-change` and `test-weakening`. Nothing else changes in the public interface.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/__tests__/agent-guard.test.mjs`:

```js
const testRemoved = ['it("one", () => {});', 'it("two", () => {});'];

test("removing test cases is rejected", () => {
  const verdict = checkPatch({
    patch: modifyPatch("server/src/__tests__/a.test.ts", testRemoved, ['it("one", () => {});']),
  });
  assert.ok(rules(verdict).includes("test-weakening"));
});

test("rewriting a test without losing cases passes", () => {
  const verdict = checkPatch({
    patch: modifyPatch("server/src/__tests__/a.test.ts", testRemoved, [
      'it("one renamed", () => {});',
      'it("two", () => {});',
    ]),
  });
  assert.equal(verdict.ok, true, JSON.stringify(verdict));
});

test("adding skip, todo, only or retry markers is rejected", () => {
  for (const marker of [
    'it.skip("x", () => {});',
    'it.skipIf(cond)("x", () => {});',
    'it.todo("x");',
    'it.only("x", () => {});',
    'describe.skip("x", () => {});',
    'xit("x", () => {});',
    "vi.retryTimes(3);",
    "{ retry: 2 }",
  ]) {
    const verdict = checkPatch({
      patch: modifyPatch("ui/src/a.test.tsx", ['it("x", () => {});'], [marker]),
    });
    assert.ok(rules(verdict).includes("test-weakening"), marker);
  }
});

test("a test name that contains the word retry is not a retry marker", () => {
  const verdict = checkPatch({
    patch: modifyPatch("ui/src/a.test.tsx", ['it("x", () => {});'], ['it("retries a failed write", () => {});']),
  });
  assert.equal(verdict.ok, true, JSON.stringify(verdict));
});

test("deleting a whole test file is rejected", () => {
  const patch = [
    "diff --git a/ui/src/a.test.tsx b/ui/src/a.test.tsx",
    "deleted file mode 100644",
    "--- a/ui/src/a.test.tsx",
    "+++ /dev/null",
    "@@ -1,2 +0,0 @@",
    '-it("a", () => {});',
    '-it("b", () => {});',
    "",
  ].join("\n");
  assert.ok(rules(checkPatch({ patch })).includes("test-weakening"));
});

const pkg = (deps) => JSON.stringify({ name: "x", version: "1.0.0", dependencies: deps }, null, 2);

test("package.json changes outside dependency sections pass (nested workspace path)", () => {
  const verdict = checkPatch({
    patch: modifyPatch("packages/shared/package.json"),
    readBefore: () => JSON.stringify({ name: "x", version: "1.0.0", dependencies: { a: "1" } }),
    readAfter: () => JSON.stringify({ name: "x", version: "1.0.1", dependencies: { a: "1" } }),
  });
  assert.equal(verdict.ok, true, JSON.stringify(verdict));
});

test("package.json dependency changes are rejected; key reordering is not a change", () => {
  const changed = checkPatch({
    patch: modifyPatch("package.json"),
    readBefore: () => pkg({ a: "1" }),
    readAfter: () => pkg({ a: "1", b: "2" }),
  });
  assert.ok(rules(changed).includes("dependency-change"));

  const reordered = checkPatch({
    patch: modifyPatch("package.json"),
    readBefore: () => pkg({ a: "1", b: "2" }),
    readAfter: () => pkg({ b: "2", a: "1" }),
  });
  assert.equal(reordered.ok, true, JSON.stringify(reordered));
});

test("pnpm overrides count as dependency sections", () => {
  const verdict = checkPatch({
    patch: modifyPatch("package.json"),
    readBefore: () => JSON.stringify({ name: "x" }),
    readAfter: () => JSON.stringify({ name: "x", pnpm: { overrides: { a: "1" } } }),
  });
  assert.ok(rules(verdict).includes("dependency-change"));
});

test("a package.json the guard cannot verify fails closed", () => {
  assert.ok(rules(checkPatch({ patch: modifyPatch("package.json") })).includes("dependency-change"));
  const invalid = checkPatch({
    patch: modifyPatch("package.json"),
    readBefore: () => "{}",
    readAfter: () => "{ not json",
  });
  assert.ok(rules(invalid).includes("dependency-change"));
});

test("a new package.json that declares dependencies is rejected", () => {
  const patch = [
    "diff --git a/packages/new/package.json b/packages/new/package.json",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/packages/new/package.json",
    "@@ -0,0 +1 @@",
    "+{}",
    "",
  ].join("\n");
  const verdict = checkPatch({
    patch,
    readBefore: () => null,
    readAfter: () => pkg({ a: "1" }),
  });
  assert.ok(rules(verdict).includes("dependency-change"));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/__tests__/agent-guard.test.mjs`
Expected: FAIL. The new tests report missing `test-weakening` / `dependency-change` violations; the Task 2 tests still pass.

- [ ] **Step 3: Write the implementation**

In `scripts/agent-guard.mjs`, insert after the line `const SYMLINK_MODE = "120000";`:

```js
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
```

Insert after the `escapesRepo` function:

```js
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
```

Replace the line `// Task 3 adds the package.json and test-weakening checks here.` with:

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/__tests__/agent-guard.test.mjs`
Expected: `# pass 37`, `# fail 0`.

- [ ] **Step 5: Prove the new tests can fail (mutation check)**

```bash
sed -i 's/addedCases < removedCases/addedCases < removedCases - 99/' scripts/agent-guard.mjs
node --test scripts/__tests__/agent-guard.test.mjs    # Expected: # fail >= 1 (removing test cases)
sed -i 's/addedCases < removedCases - 99/addedCases < removedCases/' scripts/agent-guard.mjs
node --test scripts/__tests__/agent-guard.test.mjs    # Expected: # pass 37, # fail 0
```

- [ ] **Step 6: Commit**

```bash
git add scripts/agent-guard.mjs scripts/__tests__/agent-guard.test.mjs
git commit -m "feat(scripts): guard dependency changes and weakened tests

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Guard CLI and git-backed reader

**Files:**
- Modify: `scripts/agent-guard.mjs`
- Modify: `scripts/__tests__/agent-guard.test.mjs`

**Interfaces:**
- Consumes: `checkPatch` (Tasks 2-3).
- Produces: `runCheck({ patchText: string, repoRoot: string }): Verdict` (reads `HEAD:<path>` for "before" and the working tree for "after"); CLI `node scripts/agent-guard.mjs <patch-file>` printing the verdict as JSON, exit 0 (ok), 1 (violations), 2 (usage). Contract: run **after** `git apply`, from the repo root, HEAD at the base commit.

- [ ] **Step 1: Write the failing tests**

In `scripts/__tests__/agent-guard.test.mjs`, replace the import block at the top with:

```js
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { LIMITS, checkPatch, runCheck } from "../agent-guard.mjs";
```

Append to the end of the file:

```js
// End to end with a real repository: init, commit, change files, run the guard.
const guardScript = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "agent-guard.mjs");

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function makeRepo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "agent-guard-"));
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "t");
  git(dir, "config", "core.autocrlf", "false");
  mkdirSync(path.join(dir, "src"));
  writeFileSync(path.join(dir, "src", "a.ts"), "old\n");
  writeFileSync(path.join(dir, "package.json"), pkg({ a: "1" }) + "\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "base");
  return dir;
}

test("runCheck reads real before/after files from a repository", () => {
  const dir = makeRepo();
  writeFileSync(path.join(dir, "src", "a.ts"), "new\n");
  writeFileSync(path.join(dir, "package.json"), pkg({ a: "1", b: "2" }) + "\n");
  const patchText = git(dir, "diff");
  const verdict = runCheck({ patchText, repoRoot: dir });
  assert.deepEqual(rules(verdict), ["dependency-change"]);
});

test("the CLI exits 0 for a clean patch and 1 for a violation", () => {
  const dir = makeRepo();
  writeFileSync(path.join(dir, "src", "a.ts"), "new\n");
  const clean = path.join(dir, "clean.patch");
  writeFileSync(clean, git(dir, "diff"));
  git(dir, "checkout", "-q", "--", "src/a.ts");
  const ok = execFileSync(process.execPath, [guardScript, clean], { cwd: dir, encoding: "utf8" });
  assert.equal(JSON.parse(ok).ok, true);

  mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true });
  writeFileSync(path.join(dir, ".github", "workflows", "x.yml"), "a: 1\n");
  git(dir, "add", "-N", ".github");
  const bad = path.join(dir, "bad.patch");
  writeFileSync(bad, git(dir, "diff"));
  assert.throws(
    () => execFileSync(process.execPath, [guardScript, bad], { cwd: dir, encoding: "utf8", stdio: "pipe" }),
    (error) => error.status === 1 && JSON.parse(error.stdout).violations[0].rule === "protected-path",
  );
});

test("the CLI exits 2 with usage when no patch file is given", () => {
  assert.throws(
    () => execFileSync(process.execPath, [guardScript], { encoding: "utf8", stdio: "pipe" }),
    (error) => error.status === 2 && /usage/.test(error.stderr),
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/__tests__/agent-guard.test.mjs`
Expected: FAIL. `runCheck` is not exported (a `SyntaxError`/import error for the whole file).

- [ ] **Step 3: Write the implementation**

In `scripts/agent-guard.mjs`, replace the two import lines

```js
import path from "node:path";

import { parsePatch } from "./agent-patch.mjs";
```

with:

```js
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parsePatch } from "./agent-patch.mjs";
```

Append to the end of `scripts/agent-guard.mjs`:

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/__tests__/agent-guard.test.mjs`
Expected: `# pass 40`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add scripts/agent-guard.mjs scripts/__tests__/agent-guard.test.mjs
git commit -m "feat(scripts): add the agent guard CLI and git-backed file reader

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: State eligibility and label transitions

**Files:**
- Create: `scripts/agent-state.mjs`
- Test: `scripts/__tests__/agent-state.test.mjs`

**Interfaces:**
- Produces: `LABELS` (frozen: `ready`, `working`, `pr`, `blocked`, `readyToMerge`), `EXCLUDED_LABELS`, `DAILY_PR_CAP = 3`, `MAX_CI_ROUNDS = 3`, `isEligible(labels: string[]): { eligible: boolean, reason: string|null }`, `applyEvent(labels: string[], event: "start"|"pr-opened"|"block"): string[]` (returns a new array; throws `Error` on an illegal or unknown event). `dailyCap` and `ciRounds` arrive in Task 6.

- [ ] **Step 1: Write the failing tests**

Create `scripts/__tests__/agent-state.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import { DAILY_PR_CAP, LABELS, MAX_CI_ROUNDS, applyEvent, isEligible } from "../agent-state.mjs";

test("an issue labelled agent-ready is eligible", () => {
  assert.deepEqual(isEligible(["bug", "agent-ready"]), { eligible: true, reason: null });
});

test("an issue without agent-ready is not eligible", () => {
  assert.deepEqual(isEligible(["bug"]), { eligible: false, reason: "missing agent-ready" });
  assert.equal(isEligible([]).eligible, false);
});

test("decision and ci issues are excluded even when labelled agent-ready", () => {
  assert.equal(isEligible(["agent-ready", "decision"]).reason, "excluded label: decision");
  assert.equal(isEligible(["agent-ready", "ci"]).reason, "excluded label: ci");
});

test("an issue already in flight is not eligible again", () => {
  for (const state of ["agent-working", "agent-pr", "agent-blocked"]) {
    const verdict = isEligible(["agent-ready", state]);
    assert.equal(verdict.eligible, false, state);
    assert.equal(verdict.reason, `already ${state}`);
  }
});

test("label matching is exact, not by substring", () => {
  assert.equal(isEligible(["agent-ready-not", "agent-ready"]).eligible, true);
  assert.equal(isEligible(["agent-readyish"]).eligible, false);
  assert.equal(isEligible(["agent-ready", "decisions"]).eligible, true);
});

test("start swaps agent-ready for agent-working and keeps other labels", () => {
  assert.deepEqual(applyEvent(["bug", "agent-ready"], "start"), ["bug", "agent-working"]);
});

test("start refuses an ineligible issue", () => {
  assert.throws(() => applyEvent(["bug"], "start"), /cannot start: missing agent-ready/);
  assert.throws(() => applyEvent(["agent-ready", "decision"], "start"), /excluded label: decision/);
});

test("pr-opened moves agent-working to agent-pr and refuses otherwise", () => {
  assert.deepEqual(applyEvent(["agent-working", "bug"], "pr-opened"), ["bug", "agent-pr"]);
  assert.throws(() => applyEvent(["agent-ready"], "pr-opened"), /missing agent-working/);
});

test("block clears every in-flight label and is idempotent", () => {
  const blocked = applyEvent(["bug", "agent-working", "agent-pr", "agent-ready"], "block");
  assert.deepEqual(blocked, ["bug", "agent-blocked"]);
  assert.deepEqual(applyEvent(blocked, "block"), ["bug", "agent-blocked"]);
});

test("an unknown event throws and the input array is never mutated", () => {
  const labels = ["agent-ready"];
  assert.throws(() => applyEvent(labels, "merge"), /unknown event: merge/);
  applyEvent(labels, "start");
  assert.deepEqual(labels, ["agent-ready"]);
});

test("label names and limits match the spec", () => {
  assert.deepEqual(LABELS, {
    ready: "agent-ready",
    working: "agent-working",
    pr: "agent-pr",
    blocked: "agent-blocked",
    readyToMerge: "ready-to-merge",
  });
  assert.equal(DAILY_PR_CAP, 3);
  assert.equal(MAX_CI_ROUNDS, 3);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/__tests__/agent-state.test.mjs`
Expected: FAIL with `Cannot find module '.../scripts/agent-state.mjs'`.

- [ ] **Step 3: Write the implementation**

Create `scripts/agent-state.mjs`:

```js
#!/usr/bin/env node
/**
 * agent-state.mjs
 *
 * Pure state rules for the agent issue-to-PR loop: which issues are eligible,
 * label transitions, the daily PR cap and the CI-fix round count.
 * Design: technical-spec/specs/2026-10-12-agent-issue-loop-design.md sections 4 and 5.
 */

export const LABELS = Object.freeze({
  ready: "agent-ready",
  working: "agent-working",
  pr: "agent-pr",
  blocked: "agent-blocked",
  readyToMerge: "ready-to-merge",
});

export const EXCLUDED_LABELS = Object.freeze(["decision", "ci"]);
export const DAILY_PR_CAP = 3;
export const MAX_CI_ROUNDS = 3;

const IN_FLIGHT = [LABELS.working, LABELS.pr, LABELS.blocked];

export function isEligible(labels) {
  const set = new Set(labels);
  if (!set.has(LABELS.ready)) return { eligible: false, reason: `missing ${LABELS.ready}` };
  for (const excluded of EXCLUDED_LABELS) {
    if (set.has(excluded)) return { eligible: false, reason: `excluded label: ${excluded}` };
  }
  for (const state of IN_FLIGHT) {
    if (set.has(state)) return { eligible: false, reason: `already ${state}` };
  }
  return { eligible: true, reason: null };
}

function replace(labels, remove, add) {
  const drop = new Set(remove);
  const kept = labels.filter((label) => !drop.has(label));
  for (const label of add) {
    if (!kept.includes(label)) kept.push(label);
  }
  return kept;
}

// Returns the issue's new label list. Throws when the event is not legal from
// the current labels, so a workflow cannot skip a state.
export function applyEvent(labels, event) {
  switch (event) {
    case "start": {
      const { eligible, reason } = isEligible(labels);
      if (!eligible) throw new Error(`cannot start: ${reason}`);
      return replace(labels, [LABELS.ready], [LABELS.working]);
    }
    case "pr-opened":
      if (!labels.includes(LABELS.working)) throw new Error(`cannot open a PR: missing ${LABELS.working}`);
      return replace(labels, [LABELS.working], [LABELS.pr]);
    case "block":
      return replace(labels, [LABELS.ready, LABELS.working, LABELS.pr], [LABELS.blocked]);
    default:
      throw new Error(`unknown event: ${event}`);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/__tests__/agent-state.test.mjs`
Expected: `# pass 11`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add scripts/agent-state.mjs scripts/__tests__/agent-state.test.mjs
git commit -m "feat(scripts): add agent issue eligibility and label transitions

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Daily cap, CI rounds and the state CLI

**Files:**
- Modify: `scripts/agent-state.mjs`
- Modify: `scripts/__tests__/agent-state.test.mjs`

**Interfaces:**
- Consumes: `LABELS`, `DAILY_PR_CAP`, `MAX_CI_ROUNDS` (Task 5).
- Produces: `dailyCap({ prs: { createdAt: string, labels: string[] }[], now: string, cap?: number }): { count, cap, reached }` (throws on an invalid date); `ciRounds({ messages: string[], max?: number }): { used, max, exhausted, next }`; CLI `node scripts/agent-state.mjs <eligible|daily-cap|rounds>` reading JSON on stdin, writing JSON on stdout, exit 2 on bad input.

- [ ] **Step 1: Write the failing tests**

In `scripts/__tests__/agent-state.test.mjs`, replace the import block at the top with:

```js
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DAILY_PR_CAP,
  LABELS,
  MAX_CI_ROUNDS,
  applyEvent,
  ciRounds,
  dailyCap,
  isEligible,
} from "../agent-state.mjs";
```

Append to the end of the file:

```js
const pr = (createdAt, labels = ["agent-pr"]) => ({ createdAt, labels });
const NOW = "2026-10-12T15:00:00Z";

test("the daily cap counts agent PRs created since 00:00 UTC", () => {
  const prs = [pr("2026-10-12T00:00:00Z"), pr("2026-10-12T09:00:00Z"), pr("2026-10-11T23:59:59Z")];
  assert.deepEqual(dailyCap({ prs, now: NOW }), { count: 2, cap: 3, reached: false });
});

test("the cap is reached at exactly the limit, not before", () => {
  const two = [pr("2026-10-12T01:00:00Z"), pr("2026-10-12T02:00:00Z")];
  assert.equal(dailyCap({ prs: two, now: NOW }).reached, false);
  const three = [...two, pr("2026-10-12T03:00:00Z")];
  assert.equal(dailyCap({ prs: three, now: NOW }).reached, true);
});

test("PRs without the agent-pr label do not count", () => {
  const prs = [pr("2026-10-12T01:00:00Z", ["bug"]), pr("2026-10-12T02:00:00Z", [])];
  assert.equal(dailyCap({ prs, now: NOW }).count, 0);
});

test("the day boundary is UTC, whatever offset the timestamps use", () => {
  const prs = [pr("2026-10-12T05:30:00+07:00")];
  assert.equal(dailyCap({ prs, now: "2026-10-12T02:00:00Z" }).count, 0);
  assert.equal(dailyCap({ prs: [pr("2026-10-12T07:30:00+07:00")], now: "2026-10-12T02:00:00Z" }).count, 1);
});

test("a custom cap is honoured and bad dates throw", () => {
  assert.equal(dailyCap({ prs: [pr("2026-10-12T01:00:00Z")], now: NOW, cap: 1 }).reached, true);
  assert.throws(() => dailyCap({ prs: [], now: "not a date" }), /invalid date/);
  assert.throws(() => dailyCap({ prs: [pr("garbage")], now: NOW }), /invalid createdAt/);
});

test("no rounds used when no commit carries the trailer", () => {
  assert.deepEqual(ciRounds({ messages: ["fix: thing", "docs: other"] }), {
    used: 0,
    max: 3,
    exhausted: false,
    next: 1,
  });
});

test("the highest round trailer wins and exhaustion starts at the maximum", () => {
  const messages = ["fix ci\n\nT3-Agent-Round: 1", "fix ci again\n\nT3-Agent-Round: 2"];
  assert.deepEqual(ciRounds({ messages }), { used: 2, max: 3, exhausted: false, next: 3 });
  const third = [...messages, "last try\n\nT3-Agent-Round: 3"];
  assert.equal(ciRounds({ messages: third }).exhausted, true);
});

test("a round trailer must be a whole line and is ignored inside prose", () => {
  assert.equal(ciRounds({ messages: ["mentions T3-Agent-Round: 3 in a sentence"] }).used, 0);
  assert.equal(ciRounds({ messages: ["body\n\nT3-Agent-Round:   2  "] }).used, 2);
  assert.equal(ciRounds({ messages: ["body\n\nT3-Agent-Round: two"] }).used, 0);
});

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "agent-state.mjs");

function cli(command, input) {
  return execFileSync(process.execPath, [script, command], {
    input: JSON.stringify(input),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

test("the CLI answers eligible, daily-cap and rounds from JSON on stdin", () => {
  assert.deepEqual(JSON.parse(cli("eligible", { labels: ["agent-ready"] })), { eligible: true, reason: null });
  assert.equal(JSON.parse(cli("daily-cap", { prs: [], now: NOW })).reached, false);
  assert.equal(JSON.parse(cli("rounds", { messages: ["x\n\nT3-Agent-Round: 2"] })).used, 2);
});

test("the CLI exits 2 on an unknown command or bad input", () => {
  assert.throws(
    () => cli("nope", {}),
    (error) => error.status === 2 && /usage/.test(error.stderr),
  );
  assert.throws(
    () => cli("daily-cap", { prs: [], now: "bad" }),
    (error) => error.status === 2 && /invalid date/.test(error.stderr),
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/__tests__/agent-state.test.mjs`
Expected: FAIL. `dailyCap`/`ciRounds` are not exported (import error for the whole file).

- [ ] **Step 3: Write the implementation**

In `scripts/agent-state.mjs`, add the imports directly under the doc comment (before `export const LABELS`):

```js
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
```

Extend the doc comment's end (inside the `/** ... */`) with the CLI contract:

```js
 *
 * CLI (JSON on stdin, JSON on stdout):
 *   node scripts/agent-state.mjs eligible   {"labels": ["agent-ready"]}
 *   node scripts/agent-state.mjs daily-cap  {"prs": [{"createdAt": "...", "labels": ["agent-pr"]}], "now": "..."}
 *   node scripts/agent-state.mjs rounds     {"messages": ["fix\n\nT3-Agent-Round: 1"]}
 * Exit 0 on success, 2 on bad input.
```

Append to the end of `scripts/agent-state.mjs`:

```js
function startOfUtcDay(now) {
  const date = new Date(now);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid date: ${now}`);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function dailyCap({ prs, now, cap = DAILY_PR_CAP }) {
  const dayStart = startOfUtcDay(now);
  const count = prs.filter((pr) => {
    if (!pr.labels.includes(LABELS.pr)) return false;
    const created = new Date(pr.createdAt).getTime();
    if (Number.isNaN(created)) throw new Error(`invalid createdAt: ${pr.createdAt}`);
    return created >= dayStart;
  }).length;
  return { count, cap, reached: count >= cap };
}

const ROUND_TRAILER = /^T3-Agent-Round:[ \t]*(\d+)[ \t]*$/gm;

export function ciRounds({ messages, max = MAX_CI_ROUNDS }) {
  let used = 0;
  for (const message of messages) {
    for (const match of message.matchAll(ROUND_TRAILER)) {
      used = Math.max(used, Number(match[1]));
    }
  }
  return { used, max, exhausted: used >= max, next: used + 1 };
}

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  const command = process.argv[2];
  try {
    const input = JSON.parse(readFileSync(0, "utf8") || "{}");
    let result;
    if (command === "eligible") result = isEligible(input.labels ?? []);
    else if (command === "daily-cap") result = dailyCap({ prs: input.prs ?? [], now: input.now, cap: input.cap });
    else if (command === "rounds") result = ciRounds({ messages: input.messages ?? [], max: input.max });
    else throw new Error("usage: node scripts/agent-state.mjs <eligible|daily-cap|rounds> < input.json");
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/__tests__/agent-state.test.mjs`
Expected: `# pass 21`, `# fail 0`.

- [ ] **Step 5: Prove the boundary tests can fail (mutation check)**

```bash
sed -i 's/reached: count >= cap/reached: count > cap/' scripts/agent-state.mjs
node --test scripts/__tests__/agent-state.test.mjs    # Expected: # fail 2
sed -i 's/reached: count > cap/reached: count >= cap/' scripts/agent-state.mjs
sed -i 's/exhausted: used >= max/exhausted: used > max/' scripts/agent-state.mjs
node --test scripts/__tests__/agent-state.test.mjs    # Expected: # fail 1
sed -i 's/exhausted: used > max/exhausted: used >= max/' scripts/agent-state.mjs
node --test scripts/__tests__/agent-state.test.mjs    # Expected: # pass 21, # fail 0
```

- [ ] **Step 6: Commit**

```bash
git add scripts/agent-state.mjs scripts/__tests__/agent-state.test.mjs
git commit -m "feat(scripts): add the agent daily cap, CI round count and state CLI

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Verify, open the PR, queue the CI wiring

**Files:**
- No new files in this PR. A follow-up `ci` PR (separate) edits `.github/workflows/t3-ci.yml`.

- [ ] **Step 1: Run all three test files together**

Run:
```bash
node --test scripts/__tests__/agent-patch.test.mjs scripts/__tests__/agent-guard.test.mjs scripts/__tests__/agent-state.test.mjs
```
Expected: `# pass 70`, `# fail 0` (9 + 40 + 21). Node 22 does not accept a directory argument to `--test`; always list the files.

- [ ] **Step 2: Confirm nothing outside the plan changed**

Run: `git diff --stat origin/develop`
Expected: exactly six files, all under `scripts/` (`agent-patch.mjs`, `agent-guard.mjs`, `agent-state.mjs` and their three tests). No `.github/`, `deploy/` or `CICD/` paths.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feature/agent-loop-guard-scripts
gh pr create --base develop --head feature/agent-loop-guard-scripts \
  --title "Add agent loop guard and state scripts" \
  --body-file <path-to-filled-.github/PULL_REQUEST_TEMPLATE.md>
```
The body must fill the repo PR template (Thinking Path, Linked Issues with `Refs: technical-spec/specs/2026-10-12-agent-issue-loop-design.md` section 9 step 1, What Changed, Verification with the exact test output from Step 1, Risks, Model Used). State plainly that the new tests are **not yet run by t3-ci** until the follow-up `ci` PR merges.

- [ ] **Step 4: Queue the follow-up `ci` PR**

t3-ci runs each script test through its own explicit `node --test` step (see `.github/workflows/t3-ci.yml` lines 60-80), so these tests will not gate any PR until a step is added. That change touches a workflow file, so it is its own `ci`-labelled, human-reviewed PR. It adds one step to the `unit` job:

```yaml
      - name: Test agent loop guard and state scripts
        run: node --test ./scripts/__tests__/agent-patch.test.mjs ./scripts/__tests__/agent-guard.test.mjs ./scripts/__tests__/agent-state.test.mjs
```

Do not include it in this PR.

---

## Out of scope for this plan

The three workflows (`t3-agent-review`, `t3-agent-develop`, `t3-agent-ci-loop`), the hand-off comment, the nightly "agent PRs merged" section, the 14-day stale-issue flag, branch-hygiene settings, and every owner prerequisite (Claude credential, GitHub App, labels, `T3_AGENT_AUTOMATION`). These are delivery steps 0 and 2-6 in the spec and each gets its own plan.
