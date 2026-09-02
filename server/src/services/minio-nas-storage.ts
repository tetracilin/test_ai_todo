import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { loadConfig, type Config } from "../config.js";
import { forbidden, notFound, serviceUnavailable, unprocessable } from "../errors.js";
import { resolveS3Credentials } from "../storage/s3-provider.js";

export interface MinioNasStorage {
  describe(): {
    configured: boolean;
    consoleUrl: string | null;
    bucket: string | null;
    endpoint: string | null;
    rootFolder: string;
  };
  listFolders(prefix: string | undefined): Promise<{ prefix: string; folders: Array<{ path: string; name: string }> }>;
  validateFolder(folder: string): Promise<string>;
}

type MinioNasStorageConfig = Pick<
  Config,
  | "storageS3Bucket"
  | "storageS3Region"
  | "storageS3Endpoint"
  | "storageS3ForcePathStyle"
  | "storageS3AccessKeySecretRef"
  | "storageS3SecretKeySecretRef"
  | "storageS3ConsoleUrl"
  | "storageS3NasRootPrefix"
>;

function asNasError(err: unknown): never {
  const name = typeof err === "object" && err !== null && "name" in err
    ? String((err as { name?: unknown }).name)
    : "";
  if (name === "AccessDenied" || name === "Forbidden" || name === "Unauthorized") {
    throw forbidden("MinIO NAS folder is not authorized", { code: "NAS_FOLDER_FORBIDDEN" });
  }
  throw serviceUnavailable("MinIO NAS is unavailable", { code: "MINIO_UNAVAILABLE" });
}

export function normalizeNasFolder(value: string): string {
  if (typeof value !== "string") {
    throw unprocessable("NAS folder must be a string", { code: "INVALID_NAS_FOLDER" });
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.includes("\\") || /[\u0000-\u001f]/.test(trimmed)) {
    throw unprocessable("NAS folder must be an absolute POSIX path", { code: "INVALID_NAS_FOLDER" });
  }
  const segments = trimmed.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw unprocessable("NAS folder must name a folder without dot segments", { code: "INVALID_NAS_FOLDER" });
  }
  if (segments.length === 0) return "/";
  return `/${segments.join("/")}`;
}

function normalizeRootPrefix(value: string | undefined): string {
  const trimmed = value?.trim().replace(/^\/+|\/+$/g, "") ?? "";
  if (!trimmed) return "";
  const path = normalizeNasFolder(`/${trimmed}`);
  return path.slice(1);
}

function toObjectPrefix(folder: string): string {
  return folder === "/" ? "" : `${folder.slice(1)}/`;
}

function isWithinRoot(folder: string, rootPrefix: string): boolean {
  if (!rootPrefix) return true;
  return folder === `/${rootPrefix}` || folder.startsWith(`/${rootPrefix}/`);
}

function ensureAllowedFolder(folder: string, rootPrefix: string): string {
  const normalized = normalizeNasFolder(folder);
  if (!isWithinRoot(normalized, rootPrefix)) {
    throw forbidden("NAS folder is outside configured MinIO NAS root", { code: "NAS_FOLDER_FORBIDDEN" });
  }
  return normalized;
}

export function createMinioNasStorage(config: MinioNasStorageConfig = loadConfig()): MinioNasStorage {
  const endpoint = config.storageS3Endpoint?.trim() || undefined;
  const bucket = config.storageS3Bucket.trim() || undefined;
  const rootPrefix = normalizeRootPrefix(config.storageS3NasRootPrefix);
  const configured = Boolean(endpoint && bucket);
  const rootFolder = rootPrefix ? `/${rootPrefix}` : "/";
  const client = configured
    ? new S3Client({
        region: config.storageS3Region,
        endpoint,
        forcePathStyle: config.storageS3ForcePathStyle,
        credentials: resolveS3Credentials({
          accessKeySecretRef: config.storageS3AccessKeySecretRef,
          secretKeySecretRef: config.storageS3SecretKeySecretRef,
        }),
      })
    : null;

  function requireClient(): { client: S3Client; bucket: string } {
    if (!client || !bucket) {
      throw serviceUnavailable("MinIO NAS is not configured", { code: "MINIO_UNAVAILABLE" });
    }
    return { client, bucket };
  }

  return {
    describe() {
      return {
        configured,
        consoleUrl: config.storageS3ConsoleUrl?.trim() || null,
        bucket: bucket ?? null,
        endpoint: endpoint ?? null,
        rootFolder,
      };
    },

    async listFolders(prefix) {
      const { client: s3, bucket: configuredBucket } = requireClient();
      const folder = ensureAllowedFolder(prefix ?? rootFolder, rootPrefix);
      try {
        const output = await s3.send(new ListObjectsV2Command({
          Bucket: configuredBucket,
          Prefix: toObjectPrefix(folder),
          Delimiter: "/",
          MaxKeys: 1000,
        }));
        const folders = (output.CommonPrefixes ?? [])
          .map((entry) => entry.Prefix)
          .filter((entry): entry is string => Boolean(entry))
          .map((entry) => normalizeNasFolder(`/${entry.replace(/\/+$/, "")}`))
          .filter((path) => isWithinRoot(path, rootPrefix))
          .map((path) => ({ path, name: path.split("/").at(-1)! }));
        return { prefix: folder, folders };
      } catch (err) {
        return asNasError(err);
      }
    },

    async validateFolder(folder) {
      const { client: s3, bucket: configuredBucket } = requireClient();
      const normalized = ensureAllowedFolder(folder, rootPrefix);
      try {
        const output = await s3.send(new ListObjectsV2Command({
          Bucket: configuredBucket,
          Prefix: toObjectPrefix(normalized),
          MaxKeys: 1,
        }));
        if ((output.KeyCount ?? 0) === 0 && (output.Contents?.length ?? 0) === 0 && (output.CommonPrefixes?.length ?? 0) === 0) {
          throw notFound("MinIO NAS folder was not found", { code: "NAS_FOLDER_NOT_FOUND" });
        }
        return normalized;
      } catch (err) {
        if (err instanceof Error && "status" in err) throw err;
        return asNasError(err);
      }
    },
  };
}
