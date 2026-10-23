import { describe, expect, it } from "vitest";
import { sanitizeInheritedPaperclipEnv } from "./server-utils.js";

describe("sanitizeInheritedPaperclipEnv", () => {
  it("drops the host-only Paperclip CLI command pointer", () => {
    expect(sanitizeInheritedPaperclipEnv({
      PAPERCLIPAI_CMD: "node /missing/paperclipai/dist/index.js",
      PAPERCLIP_RUNTIME_API_URL: "http://127.0.0.1:3100",
      PATH: "/usr/bin",
    })).toEqual({
      PAPERCLIP_RUNTIME_API_URL: "http://127.0.0.1:3100",
      PATH: "/usr/bin",
    });
  });

  it("keeps the runtime API URL and listen host/port but drops every other PAPERCLIP_ variable", () => {
    expect(sanitizeInheritedPaperclipEnv({
      PAPERCLIP_RUNTIME_API_URL: "http://127.0.0.1:3100",
      PAPERCLIP_LISTEN_HOST: "127.0.0.1",
      PAPERCLIP_LISTEN_PORT: "3100",
      PAPERCLIP_API_KEY: "secret",
      PAPERCLIP_AGENT_ID: "agent-1",
      PAPERCLIP_HOME: "/home/x/.paperclip",
    })).toEqual({
      PAPERCLIP_RUNTIME_API_URL: "http://127.0.0.1:3100",
      PAPERCLIP_LISTEN_HOST: "127.0.0.1",
      PAPERCLIP_LISTEN_PORT: "3100",
    });
  });

  it("preserves unrelated variables, including look-alike prefixes, and does not mutate its input", () => {
    const input = {
      PATH: "/usr/bin",
      PAPERCLIPAI_OTHER: "kept",
      MY_PAPERCLIP_FLAG: "kept",
      PAPERCLIP_API_KEY: "secret",
    };
    const snapshot = { ...input };

    const result = sanitizeInheritedPaperclipEnv(input);

    expect(result).toEqual({ PATH: "/usr/bin", PAPERCLIPAI_OTHER: "kept", MY_PAPERCLIP_FLAG: "kept" });
    expect(input).toEqual(snapshot);
  });
});
