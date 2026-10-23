import { describe, expect, it } from "vitest";

import { parseTailscaleDnsName } from "./tailscale-hostname.js";

describe("parseTailscaleDnsName", () => {
  it("normalizes the local node MagicDNS hostname", () => {
    expect(parseTailscaleDnsName({ Self: { DNSName: "Branch-Runner.tail123.ts.net." } }))
      .toBe("branch-runner.tail123.ts.net");
  });

  it("trims whitespace around the name and rejects non-string or null status payloads", () => {
    expect(parseTailscaleDnsName({ Self: { DNSName: "  node.tail1.ts.net. " } })).toBe("node.tail1.ts.net");
    expect(() => parseTailscaleDnsName(null)).toThrow(/Self\.DNSName/);
    expect(() => parseTailscaleDnsName({ Self: { DNSName: 42 } })).toThrow(/Self\.DNSName/);
    expect(() => parseTailscaleDnsName({ Self: { DNSName: "-bad.ts.net" } })).toThrow(/invalid/);
  });

  it("rejects missing, single-label, and injected hostnames", () => {
    expect(() => parseTailscaleDnsName({})).toThrow(/Self\.DNSName/);
    expect(() => parseTailscaleDnsName({ Self: { DNSName: "localhost" } })).toThrow(/invalid/);
    expect(() => parseTailscaleDnsName({ Self: { DNSName: "host/evil.ts.net" } })).toThrow(/invalid/);
  });
});
