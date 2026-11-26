import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const uiRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

interface Manifest {
  id?: string;
  name?: string;
  short_name?: string;
  start_url?: string;
  scope?: string;
  display?: string;
  icons?: Array<{ src: string; sizes: string; type: string; purpose?: string }>;
}

function readManifest(): Manifest {
  return JSON.parse(readFileSync(resolve(uiRoot, "public/manifest.webmanifest"), "utf8")) as Manifest;
}

describe("PWA install mode", () => {
  // Owner decision 2026-11-26 (PF-02): the site installs as an app. A browser
  // only offers "Install app" for the standalone, minimal-ui or fullscreen modes.
  it("installs as a standalone app, not as a browser tab", () => {
    expect(readManifest().display).toBe("standalone");
  });

  it("has what a browser needs to offer installation: name, start page and icons", () => {
    const manifest = readManifest();
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");

    const sizes = (manifest.icons ?? []).map((icon) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect((manifest.icons ?? []).some((icon) => icon.purpose === "maskable")).toBe(true);
  });

  it("ships every icon the manifest names", () => {
    for (const icon of readManifest().icons ?? []) {
      expect(existsSync(resolve(uiRoot, "public", icon.src.replace(/^\//, ""))), icon.src).toBe(true);
    }
  });

  it("serves the manifest at /manifest.webmanifest and no longer ships the old name", () => {
    expect(existsSync(resolve(uiRoot, "public/manifest.webmanifest"))).toBe(true);
    expect(existsSync(resolve(uiRoot, "public/site.webmanifest"))).toBe(false);
  });

  it("fetches the manifest with credentials so authenticating proxies can serve it", () => {
    const html = readFileSync(resolve(uiRoot, "index.html"), "utf8");

    // Browsers fetch <link rel="manifest"> in "omit credentials" mode unless
    // the link opts in. Behind an authenticating reverse proxy (e.g. a
    // managed-hosting front door), the cookie-less request is rejected on
    // every page load.
    expect(html).toContain('rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials"');
  });

  it("registers a service worker file that exists", () => {
    expect(existsSync(resolve(uiRoot, "public/sw.js"))).toBe(true);
  });
});
