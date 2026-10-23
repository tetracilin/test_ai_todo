import { describe, expect, it } from "vitest";
import {
  getCloudStackContext,
  isCloudManagedInstance,
  type CloudInstanceEnv,
} from "../services/cloud-instance.js";

describe("isCloudManagedInstance", () => {
  // Explicit expected values (not a re-derivation of the implementation): the
  // canonical predicate is the union of the two prior restrictive signals, a
  // non-blank tenant token OR any presence of PAPERCLIP_MANAGED_CONFIG (even "").
  it.each<[string, CloudInstanceEnv, boolean]>([
    ["no signals", {}, false],
    ["tenant token only", { PAPERCLIP_CLOUD_TENANT_SERVER_TOKEN: "tenant-token" }, true],
    ["managed config present but empty", { PAPERCLIP_MANAGED_CONFIG: "" }, true],
    [
      "both signals",
      {
        PAPERCLIP_CLOUD_TENANT_SERVER_TOKEN: "tenant-token",
        PAPERCLIP_MANAGED_CONFIG: "managed-document",
      },
      true,
    ],
  ])("unifies both prior signals without weakening either restrictive floor: %s", (_label, env, expected) => {
    expect(isCloudManagedInstance(env)).toBe(expected);
  });

  it("does not treat a blank tenant token alone as a managed signal", () => {
    expect(isCloudManagedInstance({ PAPERCLIP_CLOUD_TENANT_SERVER_TOKEN: "   " })).toBe(false);
  });
});

describe("getCloudStackContext", () => {
  it("returns null outside Paperclip Cloud even when stray stack metadata exists", () => {
    expect(getCloudStackContext({ PAPERCLIP_STACK_SLUG: "stray-stack" })).toBeNull();
  });

  it("returns normalized provisioner metadata for cloud instances", () => {
    expect(getCloudStackContext({
      PAPERCLIP_CLOUD_TENANT_SERVER_TOKEN: "tenant-token",
      PAPERCLIP_CLOUD_STACK_ID: " stack-1 ",
      PAPERCLIP_STACK_SLUG: " acme ",
      PAPERCLIP_CLOUD_ACCOUNT_GROUP_ID: " account-group-1 ",
      PAPERCLIP_PRIMARY_HOST: " acme.paperclip.app ",
      PAPERCLIP_CLOUD_API_ORIGIN: " https://app.paperclip.app ",
    })).toEqual({
      stackId: "stack-1",
      stackSlug: "acme",
      accountGroupId: "account-group-1",
      primaryHost: "acme.paperclip.app",
      cloudOrigin: "https://app.paperclip.app",
    });
  });

  it("represents missing managed metadata explicitly without failing health checks", () => {
    expect(getCloudStackContext({ PAPERCLIP_MANAGED_CONFIG: "managed-document" })).toEqual({
      stackId: null,
      stackSlug: null,
      accountGroupId: null,
      primaryHost: null,
      cloudOrigin: null,
    });
  });
});
