import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CHECKER_MODE,
  HISTORICAL_ALLOWLIST,
  formatJsonReport,
  runCheck,
  scanRepository,
} from "./check-no-google-runtime.mjs";

function withFixture(files, callback) {
  const root = mkdtempSync(path.join(os.tmpdir(), "no-google-runtime-"));
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const absolutePath = path.join(root, relativePath);
      mkdirSync(path.dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, content);
    }
    return callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("checker contract stays in report mode", () => {
  assert.equal(CHECKER_MODE, "report");
});

test("scanner classifies source, manifests, env names, active docs, and compiled assets", () => {
  withFixture(
    {
      "package.json": '{"dependencies":{"firebase":"latest"}}',
      "src/agent.ts": 'const model = "gemini";\n',
      "docs/active.md": "Configure GOOGLE_API_KEY.\n",
      "dist/assets/app.js": 'fetch("https://firebase.example");\n',
      "releases/v1.md": "Removed old Google integration.\n",
    },
    (root) => {
      const result = scanRepository({
        repoRoot: root,
        trackedPaths: [
          "package.json",
          "src/agent.ts",
          "docs/active.md",
          "dist/assets/app.js",
          "releases/v1.md",
        ],
      });

      assert.deepEqual(
        result.forbidden.map((hit) => [hit.path, hit.classification]),
        [
          ["dist/assets/app.js", "remove"],
          ["docs/active.md", "replace"],
          ["package.json", "remove"],
          ["src/agent.ts", "remove"],
        ],
      );
      assert.deepEqual(
        result.allowed.map((hit) => [hit.path, hit.classification]),
        [["releases/v1.md", "historical-allowlist"]],
      );
    },
  );
});

test("scanner catches forbidden terms in path names even when file is empty", () => {
  withFixture({ "docker/agent-runtime/Dockerfile.gemini": "" }, (root) => {
    const result = scanRepository({
      repoRoot: root,
      trackedPaths: ["docker/agent-runtime/Dockerfile.gemini"],
    });
    assert.equal(result.forbidden.length, 1);
    assert.equal(result.forbidden[0].path, "docker/agent-runtime/Dockerfile.gemini");
    assert.deepEqual(result.forbidden[0].terms, ["gemini"]);
  });
});

test("historical allowlist is narrow and documented", () => {
  assert.deepEqual(
    HISTORICAL_ALLOWLIST.map((entry) => entry.pattern),
    ["doc/plans/**", "releases/**", "skills-releases/**", "**/CHANGELOG.md"],
  );
});

test("report mode prints forbidden paths but returns success", () => {
  withFixture({ "src/firebase.ts": "export const enabled = true;\n" }, (root) => {
    const logs = [];
    const errors = [];
    const result = runCheck({
      repoRoot: root,
      trackedPaths: ["src/firebase.ts"],
      log: (line) => logs.push(line),
      error: (line) => errors.push(line),
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.report.forbidden.length, 1);
    assert.equal(errors.length, 0);
    assert.ok(logs.some((line) => line.includes("MODE: report")));
    assert.ok(logs.some((line) => line.includes("src/firebase.ts")));
  });
});

test("JSON report preserves machine-readable mode and path inventory", () => {
  const encoded = formatJsonReport({
    mode: "report",
    forbidden: [{ path: "src/firebase.ts" }],
    allowed: [],
  });
  const decoded = JSON.parse(encoded);
  assert.equal(decoded.mode, "report");
  assert.deepEqual(decoded.forbidden.map((hit) => hit.path), ["src/firebase.ts"]);
});

test("current repository no longer reports removed backend runtime paths", () => {
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const logs = [];
  const result = runCheck({ repoRoot, log: (line) => logs.push(line), error: () => {} });
  const forbiddenPaths = new Set(result.report.forbidden.map((hit) => hit.path));

  assert.equal(result.exitCode, 0);
  assert.ok(!forbiddenPaths.has("packages/adapters/gemini-local/package.json"));
  assert.ok(!forbiddenPaths.has("packages/google-sheets-mcp-server/package.json"));
  assert.ok(!forbiddenPaths.has("docker/agent-runtime/Dockerfile.gemini"));
  assert.ok(result.report.allowed.some((hit) => hit.path.startsWith("releases/")));
});
