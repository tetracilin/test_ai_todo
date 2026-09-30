import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import {
  CHECK_IDS,
  MAX_FILE_COUNT,
  THINKING_PATH_OPENER,
  checkBaseCurrent,
  checkBranchPrefix,
  checkFileCount,
  checkPipelineMix,
  checkPrBody,
  checkSecretsInDiff,
  classifyPaths,
  commandLine,
  isContentLine,
  isPlaceholderLine,
  lastLines,
  listTestFiles,
  mapWorkspaces,
  overallResult,
  parsePorcelainStatus,
  renderJson,
  renderTable,
  selectServerTests,
  serverTestsPlan,
  serverTestsResult,
  siblingTestPath,
  stripAnsi,
  validatePrBody,
  validateTitle,
} from "./pr-preflight.mjs";

const NUL = String.fromCharCode(0);
const TEMPLATE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "references", "pr-body-template.md");
const ESC = String.fromCharCode(27);
// Fake fs.Dirent entries for listTestFiles fixtures.
const dir = (name) => ({ name, isDirectory: () => true, isFile: () => false });
const file = (name) => ({ name, isDirectory: () => false, isFile: () => true });

// Fake secret fixtures are assembled from pieces so this file never contains a
// literal marker: the preflight scans untracked files, including this test.
const fake = (...parts) => parts.join("");
const FAKE_GHP_TOKEN = fake("ghp", "_abcdefghijklmnopqrstuvwxyz0123456789");
const FAKE_AKIA = fake("AKIA", "ABCDEFGHIJKLMNOP");
const FAKE_MARKERS = [
  fake("gho", "_x"),
  fake("github_pat", "_x"),
  FAKE_AKIA,
  fake("-----BEGIN RSA PRIVATE", " KEY-----"),
  fake("xoxb", "-1"),
];

function thinkingPath(count = 6, opener = THINKING_PATH_OPENER) {
  const lines = [`> - ${opener}`];
  for (let index = 1; index < count; index += 1) lines.push(`> - step ${index}`);
  return lines.join("\n");
}

function body({
  thinking = thinkingPath(),
  linked = "Fixes: #42",
  whatChanged = "- Added the preflight script",
  verification = "- node --test scripts/pr-preflight.test.mjs",
  risks = "- Low risk",
  model = "- Claude Fable 5.1 (claude-fable-5-1)",
  checklist = [
    "- [x] I have included a thinking path that traces from project context to this change",
    "- [x] I have specified the model used (with version and capability details)",
    "- [x] I have run tests locally and they pass",
    "- [ ] All Paperclip CI gates are green",
    "- [ ] Greptile is 5/5 with no open P2s, recommendations, or follow-ups",
  ].join("\n"),
} = {}) {
  return [
    "<!-- template comment with PAPA-999 inside must be ignored -->",
    "## Thinking Path",
    "",
    thinking,
    "",
    "## Linked Issues or Issue Description",
    "",
    linked,
    "",
    "## What Changed",
    "",
    whatChanged,
    "",
    "## Verification",
    "",
    verification,
    "",
    "## Risks",
    "",
    risks,
    "",
    "> For core feature work, check the fork roadmap [`roadmap.md`](roadmap.md) first and discuss it before opening the PR.",
    "",
    "## Model Used",
    "",
    model,
    "",
    "## Checklist",
    "",
    checklist,
    "",
  ].join("\n");
}

describe("classifyPaths", () => {
  test("splits pipeline, env, lockfile, server and ui-gated paths and normalizes slashes", () => {
    const classified = classifyPaths([
      ".github\\workflows\\t3-ci.yml",
      "deploy/compose.yaml",
      "deploy/scripts/healthcheck.sh",
      "deploy/README.md",
      "server/.env",
      ".env.example",
      "pnpm-lock.yaml",
      "server/src/services/agents.ts",
      "ui/src/components/Button.tsx",
      "ui/src/api/agents.ts",
      "./docs/x.md",
      "server/src/services/agents.ts",
    ]);
    assert.deepEqual(classified.pipeline, [".github/workflows/t3-ci.yml", "deploy/compose.yaml", "deploy/scripts/healthcheck.sh"]);
    assert.ok(classified.app.includes("deploy/README.md"));
    assert.ok(classified.app.includes("docs/x.md"));
    assert.deepEqual(classified.envFiles, ["server/.env"]);
    assert.deepEqual(classified.lockfiles, ["pnpm-lock.yaml"]);
    assert.deepEqual(classified.server, ["server/.env", "server/src/services/agents.ts"]);
    assert.deepEqual(classified.uiGated, ["ui/src/components/Button.tsx"]);
    assert.equal(classified.all.filter((entry) => entry === "server/src/services/agents.ts").length, 1);
  });
});

describe("parsePorcelainStatus", () => {
  test("reads modified, staged, untracked and renamed entries", () => {
    const text = [` M a.ts`, `A  b.ts`, `?? new.ts`, `R  new-name.ts`, `old-name.ts`, `!! ignored.ts`].join(NUL) + NUL;
    const status = parsePorcelainStatus(text);
    assert.deepEqual(status.paths, ["a.ts", "b.ts", "new.ts", "new-name.ts"]);
    assert.deepEqual(status.untracked, ["new.ts"]);
  });
});

describe("branch_prefix", () => {
  test("accepts the three prefixes CLAUDE.md allows", () => {
    for (const branch of ["feature/x", "fix/y", "chore/z"]) {
      assert.equal(checkBranchPrefix(branch).status, "PASS", branch);
    }
  });
  test("rejects develop, main, detached HEAD, docs/ and other prefixes", () => {
    for (const branch of ["develop", "main", "HEAD", "", "t3-paperclip-aitodo/x", "feat/x", "docs/w"]) {
      const result = checkBranchPrefix(branch);
      assert.equal(result.id, "branch_prefix");
      assert.equal(result.status, "FAIL", branch);
      assert.ok(result.hint.length > 0);
    }
  });
});

describe("base_current", () => {
  test("passes when the merge-base is the base tip", () => {
    const result = checkBaseCurrent({ mergeBase: "abc123def456", baseTip: "abc123def456" });
    assert.equal(result.status, "PASS");
  });
  test("fails with a rebase hint when the branch is behind", () => {
    const result = checkBaseCurrent({ mergeBase: "111111", baseTip: "222222" });
    assert.equal(result.status, "FAIL");
    assert.equal(result.hint, "run: git rebase origin/develop");
  });
  test("fails when fetch failed or the base is unknown", () => {
    assert.equal(checkBaseCurrent({ mergeBase: "1", baseTip: "1", fetchError: "no network" }).status, "FAIL");
    assert.equal(checkBaseCurrent({ mergeBase: null, baseTip: null }).status, "FAIL");
  });
});

describe("scope_pipeline_mix", () => {
  test("fails when pipeline and app files are mixed", () => {
    const result = checkPipelineMix(classifyPaths([".github/workflows/t3-ci.yml", "server/src/index.ts"]));
    assert.equal(result.status, "FAIL");
    assert.match(result.hint, /split pipeline files into their own PR labelled ci/);
  });
  test("has no option that downgrades a mixed PR to WARN", () => {
    const result = checkPipelineMix(classifyPaths(["deploy/scripts/x.sh", "server/src/index.ts"]), { allowCiFiles: true });
    assert.equal(result.status, "FAIL");
  });
  test("warns on a pipeline-only change", () => {
    const result = checkPipelineMix(classifyPaths(["deploy/compose.yaml"]));
    assert.equal(result.status, "WARN");
    assert.equal(result.hint, "pipeline-only change: label the PR ci, human review");
  });
  test("passes with no pipeline files", () => {
    assert.equal(checkPipelineMix(classifyPaths(["server/src/index.ts", "deploy/README.md"])).status, "PASS");
  });
});

describe("no_secrets", () => {
  test("fails on an added GitHub token and does not echo the token", () => {
    const token = FAKE_GHP_TOKEN;
    const diffText = ["+++ b/server/src/config.ts", `+const t = "${token}";`, "-const old = 1;"].join("\n");
    const result = checkSecretsInDiff({ classified: classifyPaths(["server/src/config.ts"]), diffText });
    assert.equal(result.status, "FAIL");
    assert.match(result.hint, /server\/src\/config\.ts/);
    assert.ok(!result.hint.includes(token));
    assert.ok(!JSON.stringify(result.details).includes(token));
  });
  test("ignores removed lines and diff headers", () => {
    const diffText = ["+++ b/x.ts", `-${FAKE_AKIA}`].join("\n");
    assert.equal(checkSecretsInDiff({ classified: classifyPaths(["x.ts"]), diffText }).status, "PASS");
  });
  test("catches the other secret markers", () => {
    for (const marker of FAKE_MARKERS) {
      const diffText = `+++ b/x.ts\n+${marker}`;
      assert.equal(checkSecretsInDiff({ classified: classifyPaths(["x.ts"]), diffText }).status, "FAIL", marker);
    }
  });
  test("fails on .env files but allows .env.example", () => {
    assert.equal(checkSecretsInDiff({ classified: classifyPaths([".env"]) }).status, "FAIL");
    assert.equal(checkSecretsInDiff({ classified: classifyPaths(["server/.env.local"]) }).status, "FAIL");
    assert.equal(checkSecretsInDiff({ classified: classifyPaths([".env.example"]) }).status, "PASS");
  });
  test("fails on pnpm-lock.yaml unless --allow-lockfile", () => {
    const classified = classifyPaths(["pnpm-lock.yaml", "server/src/index.ts"]);
    const denied = checkSecretsInDiff({ classified });
    assert.equal(denied.status, "FAIL");
    assert.match(denied.hint, /never commit pnpm-lock\.yaml/);
    const allowed = checkSecretsInDiff({ classified, allowLockfile: true });
    assert.equal(allowed.status, "WARN");
  });
  test("passes on a clean diff", () => {
    const result = checkSecretsInDiff({ classified: classifyPaths(["server/src/index.ts"]), diffText: "+++ b/server/src/index.ts\n+const ok = 1;" });
    assert.equal(result.status, "PASS");
  });
});

describe("file_count", () => {
  test("passes at the limit and fails above it", () => {
    const atLimit = Array.from({ length: MAX_FILE_COUNT }, (_, index) => `f${index}.ts`);
    assert.equal(checkFileCount(atLimit).status, "PASS");
    const over = checkFileCount([...atLimit, "extra.ts"]);
    assert.equal(over.status, "FAIL");
    assert.match(over.hint, /101 files changed/);
    assert.match(over.hint, /split the PR/);
  });
});

describe("server test selection", () => {
  const testFiles = [
    { path: "server/src/__tests__/access-service.test.ts", content: 'import { accessService } from "../services/access.js";\n' },
    { path: "server/src/__tests__/budgets.test.ts", content: 'vi.mock("../services/budgets/index.js");\n' },
    { path: "server/src/__tests__/heartbeat-runner.test.ts", content: 'import x from "../services/heartbeat.js";\n' },
    // Colocated tests outside __tests__ (the repo has dozens of these).
    { path: "server/src/services/board-auth.test.ts", content: 'import { boardAuth } from "./board-auth.js";\n' },
    { path: "server/src/routes/adapters.test.ts", content: 'import { registry } from "../adapters/registry.js";\n' },
  ];

  test("picks the colocated sibling test of a changed module", () => {
    const selection = selectServerTests({ changedPaths: ["server/src/services/board-auth.ts"], testFiles });
    assert.deepEqual(selection.files, ["server/src/services/board-auth.test.ts"]);
    assert.match(selection.basis, /sibling/);
  });
  test("picks a colocated test in another directory that imports the changed module", () => {
    const selection = selectServerTests({ changedPaths: ["server/src/adapters/registry.ts"], testFiles });
    assert.deepEqual(selection.files, ["server/src/routes/adapters.test.ts"]);
    assert.equal(selection.basis, "import");
  });
  test("siblingTestPath maps a module to its colocated test", () => {
    assert.equal(siblingTestPath("server\\src\\services\\board-auth.ts"), "server/src/services/board-auth.test.ts");
    assert.equal(siblingTestPath("server/src/routes/x.tsx"), "server/src/routes/x.test.ts");
  });
  test("listTestFiles walks server/src recursively and skips node_modules and dist", () => {
    const tree = {
      "server/src": [dir("__tests__"), dir("services"), dir("node_modules"), dir("dist"), file("instrumentation.test.ts"), file("index.ts")],
      "server/src/__tests__": [file("a.test.ts"), file("helper.ts")],
      "server/src/services": [dir("nested"), file("board-auth.test.ts"), file("board-auth.ts")],
      "server/src/services/nested": [file("deep.test.ts")],
      "server/src/node_modules": [file("evil.test.ts")],
      "server/src/dist": [file("built.test.ts")],
    };
    const key = (absolute) => path.relative("ROOT", absolute).replaceAll("\\", "/");
    const readDir = (absolute) => tree[key(absolute)] ?? [];
    const exists = (absolute) => key(absolute) in tree;
    assert.deepEqual(listTestFiles("ROOT", "server/src", { readDir, exists }), [
      "server/src/__tests__/a.test.ts",
      "server/src/instrumentation.test.ts",
      "server/src/services/board-auth.test.ts",
      "server/src/services/nested/deep.test.ts",
    ]);
  });

  test("picks tests that import a changed module (basename, extension-agnostic)", () => {
    const selection = selectServerTests({ changedPaths: ["server/src/services/access.ts"], testFiles });
    assert.deepEqual(selection.files, ["server/src/__tests__/access-service.test.ts"]);
    assert.equal(selection.basis, "import");
  });
  test("matches index modules by their directory name", () => {
    const selection = selectServerTests({ changedPaths: ["server/src/services/budgets/index.ts"], testFiles });
    assert.deepEqual(selection.files, ["server/src/__tests__/budgets.test.ts"]);
  });
  test("includes changed test files directly", () => {
    const selection = selectServerTests({ changedPaths: ["server/src/__tests__/heartbeat-runner.test.ts"], testFiles });
    assert.deepEqual(selection.files, ["server/src/__tests__/heartbeat-runner.test.ts"]);
    assert.equal(selection.basis, "direct");
  });
  test("falls back to shared basename words", () => {
    const selection = selectServerTests({ changedPaths: ["server/src/routes/heartbeat-routes.ts"], testFiles });
    assert.deepEqual(selection.files, ["server/src/__tests__/heartbeat-runner.test.ts"]);
    assert.equal(selection.basis, "basename");
  });
  test("returns nothing when no test relates to the change", () => {
    const selection = selectServerTests({ changedPaths: ["server/src/services/workspaces.ts"], testFiles });
    assert.deepEqual(selection.files, []);
    assert.equal(selection.basis, "none");
  });
});

describe("server_tests plan and result", () => {
  test("passes when no server files changed", () => {
    const plan = serverTestsPlan({ classified: classifyPaths(["ui/src/x.ts"]), selection: null });
    assert.equal(plan.check.status, "PASS");
    assert.equal(plan.check.hint, "no server files changed");
  });
  test("warns with the reason when skipped, fails on an empty reason", () => {
    const classified = classifyPaths(["server/src/x.ts"]);
    assert.equal(serverTestsPlan({ classified, skipReason: "embedded PG unavailable" }).check.hint, "server tests skipped: embedded PG unavailable");
    assert.equal(serverTestsPlan({ classified, skipReason: "embedded PG unavailable" }).check.status, "WARN");
    assert.equal(serverTestsPlan({ classified, skipReason: "" }).check.status, "FAIL");
  });
  test("warns when no matching test exists", () => {
    const plan = serverTestsPlan({ classified: classifyPaths(["server/src/x.ts"]), selection: { files: [], basis: "none" } });
    assert.equal(plan.check.status, "WARN");
    assert.equal(plan.check.hint, "no matching server test found; state that in the PR body");
  });
  test("plans the ensure-build-deps and vitest commands", () => {
    const plan = serverTestsPlan({ classified: classifyPaths(["server/src/x.ts"]), selection: { files: ["server/src/__tests__/x.test.ts"], basis: "import" } });
    assert.deepEqual(plan.run.map(commandLine), [
      "pnpm --filter @paperclipai/plugin-sdk ensure-build-deps",
      "npx vitest run server/src/__tests__/x.test.ts",
    ]);
  });
  test("renders PASS with the exact command and FAIL with the tail of the output", () => {
    const [deps, vitest] = serverTestsPlan({ classified: classifyPaths(["server/src/x.ts"]), selection: { files: ["server/src/__tests__/x.test.ts"], basis: "import" } }).run;
    const pass = serverTestsResult({ files: ["server/src/__tests__/x.test.ts"], basis: "import", results: [
      { command: deps, status: 0, output: "ok" },
      { command: vitest, status: 0, output: "Test Files  1 passed" },
    ] });
    assert.equal(pass.status, "PASS");
    assert.match(pass.hint, /npx vitest run server\/src\/__tests__\/x\.test\.ts/);
    const longOutput = Array.from({ length: 40 }, (_, index) => `line ${index}`).join("\n");
    const fail = serverTestsResult({ files: ["server/src/__tests__/x.test.ts"], basis: "import", results: [
      { command: deps, status: 0, output: "ok" },
      { command: vitest, status: 1, output: longOutput },
    ] });
    assert.equal(fail.status, "FAIL");
    assert.equal(fail.details.output.length, 15);
    assert.equal(fail.details.output.at(-1), "line 39");
  });
});

describe("mapWorkspaces", () => {
  const packages = {
    "packages/db": "@paperclipai/db",
    "packages/adapters/claude-local": "@paperclipai/adapter-claude-local",
    "packages/plugins/sdk": "@paperclipai/plugin-sdk",
  };
  const reader = (dir) => packages[dir] ?? null;

  test("maps server, ui, cli and package directories to workspace names", () => {
    const names = mapWorkspaces([
      "server/src/index.ts",
      "ui/src/App.tsx",
      "cli/src/index.ts",
      "packages/db/src/schema/x.ts",
      "packages/adapters/claude-local/src/index.ts",
      "packages/plugins/sdk/src/index.ts",
      "packages/adapters/AUTHORING.md",
      "docs/x.md",
      "package.json",
    ], reader);
    assert.deepEqual(names, [
      "@paperclipai/adapter-claude-local",
      "@paperclipai/db",
      "@paperclipai/plugin-sdk",
      "@paperclipai/server",
      "@paperclipai/ui",
      "paperclipai",
    ]);
  });
  test("returns an empty set for root-only changes", () => {
    assert.deepEqual(mapWorkspaces([".claude/skills/pr-loop/SKILL.md", "README.md"], reader), []);
  });
});

describe("validatePrBody", () => {
  test("accepts a complete body", () => {
    const result = validatePrBody(body());
    assert.deepEqual(result.problems, []);
    assert.equal(result.ok, true);
  });
  test("accepts the bold-label issue description path", () => {
    const linked = ["**Summary**", "The preflight is missing.", "", "**Expected behavior**", "- A script exists", "", "**Actual behavior**", "Nothing runs"].join("\n");
    assert.equal(validatePrBody(body({ linked })).ok, true);
  });
  test("rejects fewer than five thinking path steps", () => {
    const result = validatePrBody(body({ thinking: thinkingPath(4) }));
    assert.ok(result.problems.some((problem) => /at least 5/.test(problem)));
  });
  test("rejects a thinking path that does not open with the project sentence", () => {
    const result = validatePrBody(body({ thinking: thinkingPath(6, "This PR adds a script") }));
    assert.ok(result.problems.some((problem) => /first line must start with/.test(problem)));
  });
  test("rejects a missing issue link and too few labels", () => {
    assert.ok(validatePrBody(body({ linked: "-" })).problems.some((problem) => /Linked Issues/.test(problem)));
    const twoLabels = ["**Summary**", "text", "**Expected**", "text"].join("\n");
    assert.ok(validatePrBody(body({ linked: twoLabels })).problems.some((problem) => /Linked Issues/.test(problem)));
    const emptyLabels = ["**Summary**", "-", "**Expected**", "-", "**Actual**", "-"].join("\n");
    assert.ok(validatePrBody(body({ linked: emptyLabels })).problems.some((problem) => /Linked Issues/.test(problem)));
  });
  test("accepts Closes and Refs forms", () => {
    assert.equal(validatePrBody(body({ linked: "Closes #7" })).ok, true);
    assert.equal(validatePrBody(body({ linked: "Refs #7 and Fixes #8" })).ok, true);
  });
  test("rejects the unfilled template: bracketed prompts and stubs are not content", () => {
    const template = readFileSync(TEMPLATE_PATH, "utf8");
    const result = validatePrBody(template);
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((problem) => /at least 5/.test(problem)), "thinking path prompts do not count as steps");
    assert.ok(result.problems.some((problem) => /Linked Issues/.test(problem)), "bracketed label content does not count");
    for (const name of ["What Changed", "Verification", "Risks"]) {
      assert.ok(result.problems.some((problem) => problem.includes(`"## ${name}" has no content`)), name);
    }
    assert.ok(result.problems.some((problem) => problem.includes('placeholder left in "## What Changed": - [Change 1]')));
    assert.ok(result.problems.some((problem) => problem.includes('placeholder left in "## Verification": [paste the preflight table here]')));
    assert.ok(result.problems.some((problem) => problem.includes('placeholder left in "## Thinking Path": > - This pull request ...')));
  });
  test("rejects a single leftover placeholder in an otherwise complete body", () => {
    const result = validatePrBody(body({ risks: ["- Low risk", "- [Risk and how it is contained]"].join("\n") }));
    assert.equal(result.ok, false);
    assert.deepEqual(result.problems, ['placeholder left in "## Risks": - [Risk and how it is contained]']);
  });
  test("placeholder detection ignores checklist items and prose with brackets", () => {
    for (const line of ["- [Change 1]", "> - [What problem or gap exists]", "[paste the preflight table here]", "> - This pull request ...", "- The benefit is ...", "* [x]"]) {
      assert.equal(isPlaceholderLine(line), true, line);
      assert.equal(isContentLine(line), false, line);
    }
    for (const line of ["- [x] I have run tests locally and they pass", "- Renamed [old] to new", "- Change 1", "This pull request adds a script", "- The benefit is fewer red nightlies"]) {
      assert.equal(isPlaceholderLine(line), false, line);
    }
  });
  test("an empty code fence is not content, a filled one is", () => {
    const empty = validatePrBody(body({ verification: "```\n```" }));
    assert.ok(empty.problems.some((problem) => problem.includes('"## Verification" has no content')));
    const filled = validatePrBody(body({ verification: "```\npreflight: PASS\n```" }));
    assert.equal(filled.ok, true);
  });
  test("rejects placeholder-only sections", () => {
    for (const [key, name] of [["whatChanged", "What Changed"], ["verification", "Verification"], ["risks", "Risks"], ["model", "Model Used"]]) {
      const result = validatePrBody(body({ [key]: "-" }));
      assert.ok(result.problems.some((problem) => problem.includes(`"## ${name}" has no content`)), name);
    }
  });
  test("rejects missing sections", () => {
    const text = body().replace("## Model Used", "## Something Else");
    assert.ok(validatePrBody(text).problems.some((problem) => problem.includes('missing section "## Model Used"')));
  });
  test("rejects unchecked checklist items except CI gates and Greptile", () => {
    const checklist = ["- [ ] I have run tests locally and they pass", "- [ ] All Paperclip CI gates are green", "- [ ] Greptile is 5/5"].join("\n");
    const result = validatePrBody(body({ checklist }));
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0], /1 unchecked item/);
    assert.match(result.problems[0], /run tests locally/);
  });
  test("rejects internal references", () => {
    for (const reference of ["PAPA-12", "PAP-224", "agent://x", "http://localhost:3100", "127.0.0.1", "100.103.41.112", "host.tail9831b.ts.net"]) {
      const result = validatePrBody(body({ whatChanged: `- see ${reference}` }));
      assert.ok(result.problems.some((problem) => /internal reference/.test(problem)), reference);
    }
  });
});

describe("validateTitle", () => {
  test("accepts an imperative title", () => {
    assert.equal(validateTitle("Add the pr-loop preflight script").ok, true);
  });
  test("rejects titles over 70 characters", () => {
    const result = validateTitle("x".repeat(71));
    assert.equal(result.ok, false);
    assert.match(result.problems[0], /71 chars/);
    assert.equal(validateTitle("x".repeat(70)).ok, true);
  });
  test("rejects a trailing period and lowercase past tense", () => {
    assert.equal(validateTitle("Add a script.").ok, false);
    for (const title of ["added a script", "fixed the bug", "updated docs"]) {
      assert.equal(validateTitle(title).ok, false, title);
    }
    assert.equal(validateTitle("").ok, false);
  });
});

describe("checkPrBody", () => {
  test("warns when no body is given", () => {
    const result = checkPrBody({ body: null });
    assert.equal(result.status, "WARN");
    assert.equal(result.hint, "no --body-file given; run again with the PR body before opening the PR");
  });
  test("passes a good body and title, fails a bad title", () => {
    assert.equal(checkPrBody({ body: body(), title: "Add the pr-loop preflight script" }).status, "PASS");
    assert.equal(checkPrBody({ body: body() }).status, "PASS");
    const result = checkPrBody({ body: body(), title: "added stuff." });
    assert.equal(result.status, "FAIL");
    assert.equal(result.details.titleProblems.length, 2);
  });
});

describe("rendering", () => {
  const checks = CHECK_IDS.map((id) => ({ id, status: "PASS", hint: `${id} ok`, details: null }));

  test("renders one line per check and a final preflight line", () => {
    const text = renderTable(checks);
    const lines = text.split("\n");
    assert.equal(lines.length, CHECK_IDS.length + 1);
    assert.equal(lines[0], "branch_prefix | PASS | branch_prefix ok");
    assert.equal(lines.at(-1), "preflight: PASS");
  });
  test("overall result is FAIL when any check fails, WARN does not fail", () => {
    const withWarn = checks.map((entry, index) => (index === 3 ? { ...entry, status: "WARN" } : entry));
    assert.equal(overallResult(withWarn), "PASS");
    const withFail = checks.map((entry, index) => (index === 5 ? { ...entry, status: "FAIL" } : entry));
    assert.equal(overallResult(withFail), "FAIL");
    assert.ok(renderTable(withFail).endsWith("preflight: FAIL"));
  });
  test("json output carries checks and result", () => {
    const parsed = JSON.parse(renderJson(checks));
    assert.equal(parsed.result, "PASS");
    assert.deepEqual(Object.keys(parsed.checks[0]), ["id", "status", "hint", "details"]);
  });
  test("lastLines strips ANSI and keeps the tail", () => {
    assert.equal(stripAnsi(`${ESC}[31mred${ESC}[0m`), "red");
    assert.deepEqual(lastLines(`a\r\n\r\n${ESC}[32mb${ESC}[0m\nc\n`, 2), ["b", "c"]);
  });
});
