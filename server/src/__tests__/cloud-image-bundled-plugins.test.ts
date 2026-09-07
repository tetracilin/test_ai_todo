import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BUNDLED_PLUGIN_CATALOG } from "../services/bundled-plugins.js";

/**
 * Drift guard for the cloud image variant (Dockerfile `cloud` target).
 *
 * The cloud image builds the sandbox-provider plugins named in the
 * CLOUD_BUNDLED_PLUGINS build arg so managed instances can auto-install
 * them from the bundled catalog at boot. That contract spans two places
 * that nothing else ties together: the Dockerfile ARG default and
 * BUNDLED_PLUGIN_CATALOG. A rename or removal in either would otherwise
 * surface only when the image build fails — or worse, as a silent
 * "bundle not present" skip at instance boot.
 *
 * This guard previously also asserted the shape of upstream's docker.yml
 * (its build-arg, job split, and concurrency block). That workflow was
 * deleted at the hard fork and no t3-* workflow builds the cloud target,
 * so those assertions were removed rather than repointed. See doc/ORIGIN.md.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const dockerfile = readFileSync(path.join(repoRoot, "Dockerfile"), "utf8");

function parseList(source: string, pattern: RegExp, label: string): string[] {
  const match = source.match(pattern);
  expect(match, `${label} must declare CLOUD_BUNDLED_PLUGINS`).toBeTruthy();
  const names = (match?.[1] ?? "").trim().split(/\s+/).filter(Boolean);
  expect(names.length, `${label} CLOUD_BUNDLED_PLUGINS must not be empty`).toBeGreaterThan(0);
  return names;
}

const dockerfileDefault = parseList(
  dockerfile,
  /^ARG CLOUD_BUNDLED_PLUGINS="([^"]*)"/m,
  "Dockerfile",
);

describe("cloud image bundled plugins", () => {
  it.each(dockerfileDefault)(
    "plugin %s is buildable and resolvable by the auto-installer",
    (name) => {
      const dir = path.join(repoRoot, "packages", "plugins", "sandbox-providers", name);
      expect(existsSync(dir), `${dir} must exist`).toBe(true);
      expect(
        existsSync(path.join(dir, "src", "manifest.ts")),
        `${name} must have src/manifest.ts so the build produces dist/manifest.js`,
      ).toBe(true);
      const packageJson = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as {
        scripts?: Record<string, string>;
      };
      expect(packageJson.scripts?.build, `${name} must have a build script`).toBeTruthy();

      // The auto-installer resolves catalog keys to relative paths; a plugin
      // baked into the image but absent from the catalog (or vice versa)
      // can never be auto-installed.
      const catalogEntry = BUNDLED_PLUGIN_CATALOG.find(
        (entry) => entry.relativePath === `sandbox-providers/${name}`,
      );
      expect(catalogEntry, `${name} must be listed in BUNDLED_PLUGIN_CATALOG`).toBeTruthy();
    },
  );
});
