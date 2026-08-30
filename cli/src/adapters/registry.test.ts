import { describe, expect, it } from "vitest";

import { getCLIAdapter } from "./registry.js";

describe("CLI adapter registry", () => {
  it("registers notebooklm_local without falling back to process", () => {
    const adapter = getCLIAdapter("notebooklm_local");
    expect(adapter.type).toBe("notebooklm_local");
    expect(adapter.formatStdoutEvent).toBeTypeOf("function");
  });

  it("keeps process as the fallback for unknown adapter types", () => {
    expect(getCLIAdapter("unknown_adapter").type).toBe("process");
  });
});