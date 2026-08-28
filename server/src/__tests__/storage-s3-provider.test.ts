import { afterEach, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { createS3StorageProvider } from "../storage/s3-provider.js";

describe("s3 storage provider credential secret references", () => {
  const tempRoots: string[] = [];
  const originalSecretsDir = process.env.PAPERCLIP_SECRETS_DIR;

  afterEach(async () => {
    if (originalSecretsDir === undefined) {
      delete process.env.PAPERCLIP_SECRETS_DIR;
    } else {
      process.env.PAPERCLIP_SECRETS_DIR = originalSecretsDir;
    }
    await Promise.all(tempRoots.map((root) => fs.rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  it("resolves credentials by secret name from PAPERCLIP_SECRETS_DIR", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-s3-secrets-"));
    tempRoots.push(dir);
    await fs.writeFile(path.join(dir, "ak"), "ACCESSKEY", "utf8");
    await fs.writeFile(path.join(dir, "sk"), "SECRETKEY", "utf8");
    process.env.PAPERCLIP_SECRETS_DIR = dir;

    // S3Client is constructed lazily (no network on construction); a provider
    // with valid named secret refs must build without throwing.
    const provider = createS3StorageProvider({
      bucket: "paperclip-artifacts",
      region: "us-east-1",
      endpoint: "http://127.0.0.1:9000",
      forcePathStyle: true,
      accessKeySecretRef: "ak",
      secretKeySecretRef: "sk",
    });
    expect(provider.id).toBe("s3");
  });

  it("rejects when only one of the two secret refs is provided", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-s3-secrets-"));
    tempRoots.push(dir);
    await fs.writeFile(path.join(dir, "ak"), "ACCESSKEY", "utf8");
    process.env.PAPERCLIP_SECRETS_DIR = dir;

    expect(() =>
      createS3StorageProvider({
        bucket: "paperclip-artifacts",
        region: "us-east-1",
        accessKeySecretRef: "ak",
      }),
    ).toThrow(/must be set together/);
  });

  it("rejects an unresolvable secret reference", async () => {
    process.env.PAPERCLIP_SECRETS_DIR = path.join(os.tmpdir(), "nonexistent-paperclip-secrets");

    expect(() =>
      createS3StorageProvider({
        bucket: "paperclip-artifacts",
        region: "us-east-1",
        accessKeySecretRef: "missing-ak",
        secretKeySecretRef: "missing-sk",
      }),
    ).toThrow(/not found/);
  });
});
