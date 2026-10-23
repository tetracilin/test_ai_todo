import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// The scaffold output MUST live inside the repo: outside it, scaffoldPluginProject runs real
// `pnpm build`/`pnpm pack` subprocesses instead of using a workspace:* dependency.
const tempDirs: string[] = [];
// Resolve paths relative to this file so the test does not depend on process.cwd().
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const SDK_PATH = path.join(REPO_ROOT, "packages", "plugins", "sdk");

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(REPO_ROOT, ".tmp-create-paperclip-plugin-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("create-paperclip-plugin entrypoints", () => {
  it("keeps src/index.ts import-safe when process.argv points at another bundled CLI", async () => {
    const originalArgv = process.argv;
    const outputRoot = makeTempDir();

    try {
      process.argv = [process.execPath, path.join(REPO_ROOT, "cli", "dist", "index.js"), "demo-plugin", "--output", outputRoot];
      const library = await import("./index.js");

      expect(library.scaffoldPluginProject).toBeTypeOf("function");
      expect(fs.existsSync(path.join(outputRoot, "demo-plugin"))).toBe(false);
    } finally {
      process.argv = originalArgv;
    }
  });

  it("runs scaffolding from src/bin.ts", async () => {
    const { runCli } = await import("./bin.js");
    const outputRoot = makeTempDir();
    const stdout: string[] = [];
    const outputDir = path.join(outputRoot, "demo-plugin");

    const result = runCli(
      [
        process.execPath,
        "create-paperclip-plugin",
        "demo-plugin",
        "--output",
        outputRoot,
        "--sdk-path",
        SDK_PATH,
      ],
      {
        stdout: (message) => stdout.push(message),
        stderr: (message) => {
          throw new Error(message);
        },
        exit: (code) => {
          throw new Error(`unexpected exit ${code}`);
        },
      },
    );

    expect(result).toBe(outputDir);
    expect(stdout).toEqual([`Created plugin scaffold at ${outputDir}`]);
    expect(JSON.parse(fs.readFileSync(path.join(outputDir, "package.json"), "utf8"))).toMatchObject({
      name: "demo-plugin",
      paperclipPlugin: {
        manifest: "./dist/manifest.js",
        worker: "./dist/worker.js",
        ui: "./dist/ui/",
      },
    });
  });
});
