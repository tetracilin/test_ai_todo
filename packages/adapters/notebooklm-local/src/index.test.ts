import { describe, expect, it } from "vitest";
import { agentConfigurationDoc } from "./index.js";

describe("NotebookLM agent configuration guidance", () => {
  it("documents trial-only runtime paths and human-only authentication", () => {
    expect(agentConfigurationDoc).toContain("isolated trial only");
    expect(agentConfigurationDoc).toContain("/usr/local/bin/nlm");
    expect(agentConfigurationDoc).toContain("/root/paperclip-data/notebooklm");
    expect(agentConfigurationDoc).toContain("/paperclip/notebooklm");
    expect(agentConfigurationDoc).toContain("out-of-band only");
    expect(agentConfigurationDoc).toContain("never starts browser or automatic Google login");
  });

  it("forbids credential disclosure and fake session semantics", () => {
    expect(agentConfigurationDoc).toContain("never read,\n  display, paste, export, or log its contents");
    expect(agentConfigurationDoc).toContain("no ACP transport");
    expect(agentConfigurationDoc).toContain("conversational session resume");
    expect(agentConfigurationDoc).toContain("session codec");
  });
});