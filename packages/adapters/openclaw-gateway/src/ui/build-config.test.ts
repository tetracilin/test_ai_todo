import { describe, expect, it } from "vitest";
import type { CreateConfigValues } from "@paperclipai/adapter-utils";
import { buildOpenClawGatewayConfig } from "./build-config.js";

function baseValues(): CreateConfigValues {
  return {
    adapterType: "openclaw_gateway",
    cwd: "",
    promptTemplate: "",
    model: "",
    thinkingEffort: "",
    chrome: false,
    dangerouslySkipPermissions: false,
    search: false,
    fastMode: false,
    dangerouslyBypassSandbox: false,
    command: "",
    args: "",
    extraArgs: "",
    envVars: "",
    envBindings: {},
    url: "wss://gateway.example/ws",
    bootstrapPrompt: "",
    maxTurnsPerRun: 0,
    heartbeatEnabled: false,
    intervalSec: 0,
  };
}

describe("buildOpenClawGatewayConfig", () => {
  it("applies the documented timeout defaults when unset (timeoutSec=120, waitTimeoutMs=120000)", () => {
    const config = buildOpenClawGatewayConfig(baseValues());
    expect(config.timeoutSec).toBe(120);
    expect(config.waitTimeoutMs).toBe(120000);
  });

  it("preserves explicit timeout values when provided", () => {
    const config = buildOpenClawGatewayConfig({
      ...baseValues(),
      timeoutSec: 45,
      waitTimeoutMs: 9000,
    });
    expect(config.timeoutSec).toBe(45);
    expect(config.waitTimeoutMs).toBe(9000);
  });

  it("applies the documented identity defaults when unset", () => {
    const config = buildOpenClawGatewayConfig(baseValues());
    expect(config.sessionKeyStrategy).toBe("issue");
    expect(config.role).toBe("operator");
    expect(config.scopes).toEqual(["operator.admin"]);
  });

  it("parses comma-separated scopes, trimming blanks, and falls back to default when none remain", () => {
    expect(buildOpenClawGatewayConfig({ ...baseValues(), scopes: " a , b,, " }).scopes).toEqual(["a", "b"]);
    expect(buildOpenClawGatewayConfig({ ...baseValues(), scopes: " , " }).scopes).toEqual(["operator.admin"]);
  });

  it("injects authToken into headers on top of parsed headersJson", () => {
    const config = buildOpenClawGatewayConfig({
      ...baseValues(),
      authToken: "tok",
      headersJson: '{"x-a":"1"}',
    });
    expect(config.authToken).toBe("tok");
    expect(config.headers).toEqual({ "x-a": "1", "x-openclaw-token": "tok" });
  });

  it("ignores malformed or non-object JSON fields", () => {
    const config = buildOpenClawGatewayConfig({
      ...baseValues(),
      headersJson: "[1]",
      payloadTemplateJson: "{bad",
    });
    expect(config).not.toHaveProperty("headers");
    expect(config).not.toHaveProperty("payloadTemplate");
  });
});
