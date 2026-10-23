import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseAdapterRegistryEnv } from "./adapter-registry-bootstrap.js";

const ENTRY = JSON.stringify([
  { adapterType: "opencode_local", runtimeImage: "img", envKeys: ["ANTHROPIC_API_KEY"], allowFqdns: [], probeCommand: ["opencode", "--version"], defaultEnv: { ANTHROPIC_BASE_URL: "http://bifrost:8080" } },
]);

describe("parseAdapterRegistryEnv", () => {
  it("returns null when neither env nor file is set", () => {
    expect(parseAdapterRegistryEnv({})).toBeNull();
  });

  it("parses inline PAPERCLIP_ADAPTERS JSON", () => {
    const r = parseAdapterRegistryEnv({ PAPERCLIP_ADAPTERS: ENTRY });
    expect(r).toHaveLength(1);
    expect(r?.[0].adapterType).toBe("opencode_local");
    expect(r?.[0].enabled).toBe(true);
  });

  it("throws on malformed JSON (fail loud)", () => {
    expect(() => parseAdapterRegistryEnv({ PAPERCLIP_ADAPTERS: "{not json" })).toThrow(
      /PAPERCLIP_ADAPTERS/,
    );
  });

  it("throws on schema-invalid content (fail loud)", () => {
    expect(() =>
      parseAdapterRegistryEnv({ PAPERCLIP_ADAPTERS: JSON.stringify([{ enabled: true }]) }),
    ).toThrow(/PAPERCLIP_ADAPTERS/);
  });

  describe("PAPERCLIP_ADAPTERS_FILE", () => {
    const tempDirs: string[] = [];
    afterEach(() => {
      for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    });

    function writeRegistryFile(content: string): string {
      const dir = mkdtempSync(path.join(os.tmpdir(), "adapter-registry-"));
      tempDirs.push(dir);
      const file = path.join(dir, "adapters.json");
      writeFileSync(file, content, "utf8");
      return file;
    }

    it("parses the registry from the file when no inline JSON is set", () => {
      const file = writeRegistryFile(ENTRY);
      const r = parseAdapterRegistryEnv({ PAPERCLIP_ADAPTERS_FILE: file });
      expect(r).toHaveLength(1);
      expect(r?.[0].adapterType).toBe("opencode_local");
    });

    it("prefers inline JSON over the file when both are set", () => {
      const file = writeRegistryFile(JSON.stringify([]));
      const r = parseAdapterRegistryEnv({ PAPERCLIP_ADAPTERS: ENTRY, PAPERCLIP_ADAPTERS_FILE: file });
      expect(r).toHaveLength(1);
    });

    it("throws a file-specific error when the file cannot be read", () => {
      const missing = path.join(os.tmpdir(), "adapter-registry-does-not-exist", "adapters.json");
      expect(() => parseAdapterRegistryEnv({ PAPERCLIP_ADAPTERS_FILE: missing })).toThrow(
        /PAPERCLIP_ADAPTERS_FILE could not be read/,
      );
    });
  });
});
