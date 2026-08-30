import type { Config } from "../config.js";
import type { StorageProvider } from "./types.js";
import { createLocalDiskStorageProvider } from "./local-disk-provider.js";
import { createS3StorageProvider } from "./s3-provider.js";

export function createStorageProviderFromConfig(config: Config): StorageProvider {
  if (config.storageProvider === "local_disk") {
    return createLocalDiskStorageProvider(config.storageLocalDiskBaseDir);
  }

  return createS3StorageProvider({
    bucket: config.storageS3Bucket,
    region: config.storageS3Region,
    endpoint: config.storageS3Endpoint,
    prefix: config.storageS3Prefix,
    forcePathStyle: config.storageS3ForcePathStyle,
    accessKeySecretRef: config.storageS3AccessKeySecretRef,
    secretKeySecretRef: config.storageS3SecretKeySecretRef,
  });
}

/**
 * Build the optional external-storage provider (e.g. the NAS MinIO instance)
 * for the artifact "open file" flow. Returns null when no external source is
 * configured, so callers can treat it as absent rather than erroring.
 */
export function createExternalStorageProviderFromConfig(config: Config): StorageProvider | null {
  const external = config.storageExternal;
  if (!external) return null;
  return createS3StorageProvider({
    bucket: external.bucket,
    region: external.region,
    endpoint: external.endpoint,
    prefix: external.prefix,
    forcePathStyle: external.forcePathStyle,
    accessKeySecretRef: external.accessKeySecretRef,
    secretKeySecretRef: external.secretKeySecretRef,
  });
}
