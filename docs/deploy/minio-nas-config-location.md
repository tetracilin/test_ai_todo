# MinIO NAS config folder — location and visibility (diagnosis)

## Issue

Reported: the MinIO configuration folder is "not visible" on the NAS deployment
(`nas-storage-t19`). This page records the root cause and the evidence, per
kanban task `t_f7de7946`.

## TL;DR

There is no separate, user-visible "config" folder on the NAS. MinIO keeps its
entire runtime configuration **inside the data volume** at

```
<data-dir>/.minio.sys/config/
```

where `<data-dir>` is the single MinIO data volume (in-container path `/data`,
42 TiB NAS drive). `.minio.sys` is a **hidden dot-directory**, so it does not
show up when browsing the NAS share in File Station / SMB unless hidden files
are enabled. It is also intentionally not listable through the S3 API. Nothing
is missing — the config folder is there, just hidden and co-located with the
object data.

## Deployment shape (verified via MinIO admin API)

| Fact | Value | Source |
|------|-------|--------|
| Endpoint | `http://100.124.244.21:9000` (Tailscale `nas-storage-t19`) | `mc` alias `nas-minio` |
| Server version | `2025-09-07T16:13:09Z` | `mc admin info` |
| Uptime | ~1 month, healthy | `mc admin info` |
| Layout | 1 pool, 1 drive, EC 0 (single-node) | `mc admin info` |
| Data path (in-container) | `/data` | `mc admin info --json` |
| Capacity | 42 TiB total, 22.6% used, 1.5 GiB objects | `mc admin info` |
| Buckets | `marcom`, `mattermost`, `paperclip`, `paperclip-artifacts` | `mc ls` |
| IAM users | `paperclip-minio` (readwrite), `paperclip-artifacts` (scoped) | `mc admin user list` |
| IAM policies | incl. `paperclip-artifacts-rw` (scoped to `paperclip-artifacts` bucket) | `mc admin policy list` |
| Server config | served from `.minio.sys/config/config.json` (all defaults + browser CSP + ILM) | `mc admin config export` |

The `paperclip-artifacts` bucket/versioning/user/policy/ILM were provisioned on
2026-08-28 (see `docs/deploy/minio-nas-artifact-storage.md`); they are all still
present and healthy, which is consistent with config living on the data volume.

## Why the folder is "not visible"

1. **Location.** MinIO's config is not a top-level folder and not a separate
   mount. It is `…/.minio.sys/config/` *inside* the data volume — the same
   folder that contains the bucket folders (`marcom/`, `paperclip/`, …).
2. **Hidden name.** The leading dot makes it a hidden directory. Synology File
   Station hides dot-folders unless "Show hidden files" is enabled; SMB clients
   likewise need "show hidden files" turned on.
3. **API hiding.** MinIO refuses to expose `.minio.sys` through the S3 API
   (listing it returns "bucket name contains invalid characters"), so it can
   never be seen from S3 tooling either.

## What to do on the NAS side (human)

- **Browse check:** in File Station enable *Settings → General → Show hidden
  files* (or configure the SMB client to show hidden files), then open the
  MinIO data folder — the bucket folders and `.minio.sys` will both be there.
- **Shell check (authoritative):** `ls -la <minio-data-dir>` on the NAS must
  show `.minio.sys/` alongside the bucket folders; `ls -la <minio-data-dir>/.minio.sys/config/`
  shows `config.json` (and `iam/`, `buckets/`).

## Blockers for further automated work

- **No SSH access** to the NAS host from the Hermes host (publickey/password
  denied for `tetracilin`, `root`, `admin`; no NAS SSH key installed). The
  host-side mount path (e.g. `/volume1/…`), the NAS Compose/Container Manager
  manifest, `MINIO_*` env vars, and UID/GID were therefore **not** inspectable.
- **No approved restart window.** "Config persists after container restart"
  can only be validated by restarting the NAS MinIO, which serves
  `marcom`, `mattermost`, `paperclip`, `paperclip-artifacts`. A restart needs a
  human-approved maintenance window; none was granted.
- **No config/mount change was applied** — none is needed for the reported
  issue (nothing is missing), and no safe change can be made without SSH.

## Evidence log

- `mc admin info nas-minio` → 1/1 drives OK, version, uptime, capacity.
- `mc admin info nas-minio --json` → drive path `/data`.
- `mc admin config export nas-minio` → full server config present (secrets redacted).
- `mc admin user list / policy list` → provisioned IAM state present.
- `mc ls nas-minio/` → 4 buckets; `mc ls nas-minio/.minio.sys/` → rejected by API.
- SSH probes to `100.124.244.21` (`tetracilin`/`root`/`admin`, BatchMode) →
  `Permission denied (publickey,password)`.
