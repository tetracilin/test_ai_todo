import { describe, expect, it } from "vitest";
import {
  getAppDefinitionForUrl,
  CONNECTABLE_APP_DEFINITIONS,
} from "./app-definitions.js";

describe("tool app gallery URL matching", () => {
  it("matches pasted links against gallery URL patterns", () => {
    expect(getAppDefinitionForUrl("https://mcp.zapier.com/api/mcp")?.slug).toBe("zapier");
    expect(getAppDefinitionForUrl("https://api.githubcopilot.com/mcp/")?.slug).toBe("github");
  });

  it("returns null for invalid or unknown links", () => {
    expect(getAppDefinitionForUrl("not a url")).toBeNull();
    expect(getAppDefinitionForUrl("https://example.com/mcp")).toBeNull();
  });

  it("keeps every gallery entry reachable through at least one pattern", () => {
    for (const app of CONNECTABLE_APP_DEFINITIONS) {
      const example = app.urlPatterns[0]?.replace("*", "example");
      expect(example, `${app.slug} has a pattern`).toBeTruthy();
      expect(getAppDefinitionForUrl(example!)?.slug).toBe(app.slug);
    }
  });
});
