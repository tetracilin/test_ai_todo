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
