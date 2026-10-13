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
