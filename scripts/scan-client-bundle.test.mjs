import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { BUNDLE_SCAN_PATTERNS, runBundleScan, scanText } from "./scan-client-bundle.mjs";

function withDist(files, callback) {
  const root = mkdtempSync(path.join(os.tmpdir(), "client-bundle-scan-"));
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

test("bundle pattern contract covers required K12 classes", () => {
  assert.deepEqual(
    BUNDLE_SCAN_PATTERNS.map(({ id }) => id),
    [
      "legacy_adapter_id",
      "legacy_cli_package",
      "legacy_client_sdk",
      "legacy_ai_env",
      "legacy_model_endpoint",
      "legacy_data_endpoint",
      "legacy_app_slug",
      "legacy_app_env",
      "web_api_key_shape",
      "oauth_client_shape",
    ],
  );
});

test("clean bundle returns success", () => {
  withDist({ "index.html": "<main>Paperclip</main>", "assets/app.js": "fetch('/api/agents')" }, (root) => {
    const result = runBundleScan(root);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.findings, []);
  });
});

test("hostile bundle blocks on legacy provider endpoint and env", () => {
  withDist(
    {
      "assets/app.js": "const key = 'GEMINI_API_KEY'; fetch('https://generativelanguage.googleapis.com/v1/models')",
    },
    (root) => {
      const result = runBundleScan(root);
      assert.equal(result.exitCode, 1);
      assert.deepEqual(
        result.findings.map(({ patternId }) => patternId).sort(),
        ["legacy_ai_env", "legacy_model_endpoint"],
      );
    },
  );
});

test("missing build output is an infrastructure error", () => {
  const result = runBundleScan(path.join(os.tmpdir(), `missing-${Date.now()}`));
  assert.equal(result.exitCode, 2);
  assert.match(result.error, /cannot read dist directory/);
});

test("secret-shaped client material is rejected", () => {
  assert.deepEqual(scanText("const key='AIza12345678901234567890123456789012345'"), [
    { patternId: "web_api_key_shape", count: 1 },
  ]);
});
