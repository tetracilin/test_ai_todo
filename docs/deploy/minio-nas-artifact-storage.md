---
title: MinIO NAS artifact storage
summary: External storage option for the artifact open-file flow backed by the NAS MinIO instance
---

# MinIO NAS artifact storage

This page documents the first **external-storage option** for the artifact
"open file" flow: a configurable MinIO (S3-compatible) instance running on the
office NAS. It lets a user attach an artifact to a task by selecting a file
from the NAS object store in addition to the internal storage provider.

- **NAS hostname:** `nas-storage-t19.tail9831b.ts.net` (Tailscale tailnet)
- **Endpoint:** `http://nas-storage-t19.tail9831b.ts.net:9000`
- **Bucket:** `paperclip-artifacts`
- **Region:** `us-east-1` (single-node MinIO, region is cosmetic)

## Provisioned resources

The following were provisioned on the NAS MinIO for the artifact flow:

| Resource | Value | Notes |
|----------|-------|-------|
| Bucket | `paperclip-artifacts` | Dedicated to the artifact external-storage flow |
| Versioning | enabled | Keeps prior object versions for the app-level version feature |
| IAM user | `paperclip-artifacts` | Least-privilege identity for the app credential |
| IAM policy | `paperclip-artifacts-rw` | Scoped to `arn:aws:s3:::paperclip-artifacts` and `…/*` only |
| Lifecycle (ILM) | non-current versions expire after 90 days, keep 1 newer; delete markers cleaned | Retention for old versions |

The scoped credential has **no** access to the other NAS buckets
(`paperclip`, `marcom`, `mattermost`); a negative test against those buckets
returns `Access Denied`.

### Reproduce the provisioning

```sh
# Create bucket + versioning
mc mb nas-minio/paperclip-artifacts
mc version enable nas-minio/paperclip-artifacts

# Least-privilege policy (no secrets in the policy document)
mc admin policy create nas-minio paperclip-artifacts-rw policy.json
mc admin user add nas-minio paperclip-artifacts '<generated-secret-key>'
mc admin policy attach nas-minio paperclip-artifacts-rw --user paperclip-artifacts

# Retention lifecycle: expire old versions after 90 days, keep the newest prior version
mc ilm rule add --noncurrent-expire-days "90" --noncurrent-expire-newer "1" \
  --expire-delete-marker nas-minio/paperclip-artifacts
```

The generated access key / secret key are deployed as **named secrets** (see
below); they are never committed to code or config.

## Configuration hooks

The S3 storage config accepts an endpoint, region, and credentials **by named
secret reference only**. No literal credential value is ever placed in config,
code, cards, or metadata.

The `storage.s3` block below configures the **primary** object store, i.e. it
moves every stored object onto S3/MinIO. For the artifact picker's external
source, use `storage.external` instead — see
[Pointing the open-file external storage at the NAS MinIO](#pointing-the-open-file-external-storage-at-the-nas-minio).

```jsonc
// ~/.paperclip/instances/default/config.json
{
  "storage": {
    "provider": "s3",
    "s3": {
      "bucket": "paperclip-artifacts",
      "region": "us-east-1",
      "endpoint": "http://nas-storage-t19.tail9831b.ts.net:9000",
      "prefix": "external/",
      "forcePathStyle": true,
      "accessKeySecretRef": "paperclip_artifacts_access_key",
      "secretKeySecretRef": "paperclip_artifacts_secret_key"
    }
  }
}
```

| Key | Env override | Meaning |
|-----|--------------|---------|
| `s3.endpoint` | `PAPERCLIP_STORAGE_S3_ENDPOINT` | Object store endpoint URL |
| `s3.region` | `PAPERCLIP_STORAGE_S3_REGION` | Region (cosmetic for single-node MinIO) |
| `s3.accessKeySecretRef` | `PAPERCLIP_STORAGE_S3_ACCESS_KEY_SECRET_REF` | **Name** of the secret holding the access key |
| `s3.secretKeySecretRef` | `PAPERCLIP_STORAGE_S3_SECRET_KEY_SECRET_REF` | **Name** of the secret holding the secret key |

`accessKeySecretRef` and `secretKeySecretRef` must be set together. A ref is
resolved at runtime by reading the named secret file, searched in order:

1. An absolute path (mounted Docker secret file), or
2. `$PAPERCLIP_SECRETS_DIR/<name>`, or
3. `/run/secrets/<name>`, or
4. `/paperclip/instances/default/secrets/<name>`

When the refs are omitted, the provider falls back to the AWS SDK default
credential chain (environment, shared credentials file, IAM) exactly as before.

## Pointing the open-file external storage at the NAS MinIO

The artifact "open file" flow selects between **internal** storage and one
**external** storage. The external source is configured under
`storage.external` — **not** by setting `storage.provider` to `s3`.

`storage.external` is **additive**: it adds a second source that the artifact
picker can browse and leaves the primary store (here `local_disk`) untouched.
Switching `storage.provider` instead would move *everything* — uploads,
attachments, every existing object path — onto the NAS, which is not what this
feature is for.

This is what `deploy/paperclip-config.json` ships (mounted read-only at
`/etc/paperclip/config.json` by `deploy/compose.yaml`):

```jsonc
{
  "storage": {
    "provider": "local_disk",
    "external": {
      "endpoint": "http://nas-storage-t19.tail9831b.ts.net:9000",
      "region": "us-east-1",
      "bucket": "paperclip-artifacts",
      "prefix": "",
      "forcePathStyle": true,
      "accessKeySecretRef": "paperclip_artifacts_access_key",
      "secretKeySecretRef": "paperclip_artifacts_secret_key"
    }
  }
}
```

| Key | Env override | Meaning |
|-----|--------------|---------|
| `external.endpoint` | `PAPERCLIP_STORAGE_EXTERNAL_ENDPOINT` | MinIO endpoint URL (**required**) |
| `external.bucket` | `PAPERCLIP_STORAGE_EXTERNAL_BUCKET` | Bucket name (**required**) |
| `external.region` | `PAPERCLIP_STORAGE_EXTERNAL_REGION` | Region; cosmetic for single-node MinIO (default `us-east-1`) |
| `external.prefix` | `PAPERCLIP_STORAGE_EXTERNAL_PREFIX` | Key prefix inside the bucket (default `""`) |
| `external.forcePathStyle` | `PAPERCLIP_STORAGE_EXTERNAL_FORCE_PATH_STYLE` | Path-style addressing; MinIO needs `true` (default `true`) |
| `external.accessKeySecretRef` | `PAPERCLIP_STORAGE_EXTERNAL_ACCESS_KEY_SECRET_REF` | **Name** of the secret holding the access key |
| `external.secretKeySecretRef` | `PAPERCLIP_STORAGE_EXTERNAL_SECRET_KEY_SECRET_REF` | **Name** of the secret holding the secret key |

Three rules the config layer enforces, quietly or loudly:

- **`endpoint` and `bucket` are both required.** The external source is only
  constructed when both are present (`server/src/config.ts`); set just one and
  `storage.external` stays `undefined` with no error — the picker's
  "External NAS MinIO" button simply stays disabled.
- **Both secret refs or neither.** `createS3StorageProvider` throws
  `accessKeySecretRef and secretKeySecretRef must be set together` when only one
  is set. Omitting both is legal and falls back to the AWS SDK default
  credential chain.
- **Refs are names, never values.** A credential value must never appear in
  config, env, code, or a card.

Env overrides win over the file, but note that `deploy/compose.yaml` does not
currently forward any `PAPERCLIP_STORAGE_EXTERNAL_*` variable into the
container, so putting them in `deploy/.env` alone has no effect. The file-based
config above is the path that works today; adding the env passthrough is a
pipeline change (its own `ci`-labelled PR).

`prefix` is empty because the bucket is dedicated to this flow. The server
scopes every external listing to `<companyId>/` on top of the prefix, so
objects are read from `paperclip-artifacts/<companyId>/…`. Set a prefix only if
this bucket is later shared with something else — a non-empty prefix hides
anything sitting at the bucket root.

`deploy/compose.yaml` already mounts both credentials as Docker secrets, and
`deploy/scripts/container-entrypoint.sh` copies them into
`PAPERCLIP_SECRETS_DIR` (`/run/paperclip-storage-secrets`) with app-user
ownership before privileges drop — Docker mounts `/run/secrets` root-owned, so
the app could not otherwise read them:

```yaml
services:
  paperclip:
    environment:
      PAPERCLIP_SECRETS_DIR: /run/paperclip-storage-secrets
    secrets:
      - paperclip_artifacts_access_key
      - paperclip_artifacts_secret_key

secrets:
  paperclip_artifacts_access_key:
    file: ${PAPERCLIP_ARTIFACTS_ACCESS_KEY_FILE:-./secrets/paperclip_artifacts_access_key}
  paperclip_artifacts_secret_key:
    file: ${PAPERCLIP_ARTIFACTS_SECRET_KEY_FILE:-./secrets/paperclip_artifacts_secret_key}
```

The secret files are git-ignored and hold the generated MinIO credential
values. They must exist and be non-empty in each environment's `SECRETS_DIR`
before a deploy — the workflows hard-fail otherwise.

## Smoke test

Upload, list, and download an object to confirm the bucket is reachable with
the scoped credential:

```sh
# Using the app's own S3 provider (credentials by secret ref)
PAPERCLIP_SECRETS_DIR=/run/secrets tsx scripts/smoke-s3-storage.ts

# Equivalent manual check with the MinIO client
mc cp ./local.txt nas-minio/paperclip-artifacts/smoke/hello.txt
mc ls --recursive nas-minio/paperclip-artifacts/
mc cp nas-minio/paperclip-artifacts/smoke/hello.txt ./roundtrip.txt
```

A passing smoke test uploads an object, lists it, and downloads it back
byte-for-byte identical.
