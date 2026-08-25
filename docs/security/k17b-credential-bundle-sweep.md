---
title: "K17b — Independent Credential and Bundle Security Sweep"
created: 2026-08-25T21:40:00Z
updated: 2026-08-25T21:55:00Z
author: t3-security (Hermes, ox-alpha)
status: review
tags: [t3, security, k17b, secrets, staging, paperclip]
---

# K17b — Independent Credential and Bundle Security Sweep

Card: `t_b6fedd7b` · Tenant `t3-test-ai-todo` · Parent K16 (`t_661d88a3`) · Terminator: `kanban_request_review(reviewer=t3-architect)`

Scope: independent sweep of the staging release (image `paperclip:k15-7927f06fa`, config digest
`sha256:275f2aaad4ccc3d2c4bfebfbe13bcadaaf7a18ef6a7fa74df2ab4095bad96125`, serving commit
`7927f06fa2ff091ce518e3ea29c51efa8bf971c0` at `http://127.0.0.1:33120`) for credential leakage,
forbidden Google/Firebase/Gemini runtime artifacts, image layers, bundles, env names, logs and
network calls. The release branch was not modified; this card's worktree contains no code changes.

## Verdict

**PASS WITH FINDINGS — no blocking secret exposure in the staging artifact itself; one P1
credential-hygiene finding outside it that must be actioned before production cutover (K18).**

| ID | Severity | Finding |
|----|----------|---------|
| F1 | **P1** | Legacy Firebase web API key still live on public surfaces outside the fork lineage (see below). Revoke/rotate in Google Cloud Console before K18. |
| F2 | P2 | Legacy key at rest inside the restored staging volume — **8 occurrences across 5 files**: 3 ACP agent-session JSONs (`companies/<id>/acp-engine/agents/*/sessions/`, 2 occurrences each) plus a restored project workspace `projects/2588c455…/cfdcf895…/test_ai_todo/` carrying it in `services/firebase.ts` and `dist/assets/index-C8FL1zCC.js` (see F4). Contained (private bind, authenticated mode) but present at rest. |
| F3 | P3 | Stale tracked bundle `dist/assets/index-rWdMXOuK.js` exists only on `main` (commit 518aedcb3), which is **not** in the staging/release lineage — but `main` is a public GitHub repo with a live GH Pages deploy. |
| F4 | P2 | The restored workspace subtree `projects/2588c455…/cfdcf895…/test_ai_todo/` holds 2 of F2's 5 key-bearing files (`services/firebase.ts`, `dist/assets/index-C8FL1zCC.js`). Its 12 `@firebase` type-stub files contain only AIza-shaped **docs-placeholder** strings (distinct fingerprint, not the legacy key). Must be on the K18 purge checklist or the purge leaves live copies behind. |

> Round-2 correction note (review of e72618adc): F2 originally claimed "6 occurrences across
> 6 files". A full-volume re-inventory in-container establishes the true population as
> **8 occurrences across 5 files** (sessions 6/3 + workspace 2/2) and surfaced the missed
> F4 surface; both are reflected above and in Residual Risk.

## Scan tools and exact commands

- gitleaks 8.28.0 (downloaded binary):
  - `/tmp/gitleaks dir <worktree t_b6fedd7b> --report-format sarif --report-path k17b-worktree-gitleaks.sarif --redact -v --exit-code 0`
    → 2 findings (both = legacy Firebase key shape, see F1/F3).
  - `/tmp/gitleaks dir <K16 worktree>/deploy-staging --redact -v --exit-code 0` → **no leaks found** (committed deploy artifacts clean; `.gitignore` lines 10/12 keep `secrets/` + `.env` out).
- Custom layer scanner (`scan_layers.py`): untarred all 13 layers of `docker save paperclip:k15-7927f06fa` (OCI layout under `/tmp/k17b/k15-image-layers/`) and pattern-scanned every file ≤60 MB for AIza keys, the Firebase project id `storied-epigram-*`, PEM private-key blocks, and generic `api_key=…` shapes → no real credentials; hits were test fixtures (ssh2/dotenv docs), library wasm blobs, and Paperclip's own scanner test fixture.
- Container-filesystem greps inside running container `t3-staging-paperclip-1`: UI bundle `/app/ui/dist/assets/index-D21QC-o-.js` contains zero `AIza`/firebase/Gemini strings (single AIza-shaped match is Paperclip's own secret-detection regex list); server dist clean.
- Database: psql queries over restored snapshot (174 tables). Secrets live in `company_secrets` / `company_secret_versions`; all 14 non-revoked versions are `local_encrypted_v1` ciphertext objects (ciphertext+iv+tag+scheme), **no plaintext** material anywhere in `pg_dump` output (grep count 0).
- Backup: `zcat /paperclip/instances/default/data/backups/paperclip-20260825-200859.sql.gz | grep -cE 'AIza[0-9A-Za-z_-]{20}'` → **0**.
- Logs: `docker logs t3-staging-paperclip-1` and `t3-staging-db-1` grep counts for AIza/storied-epigram/firebase/gemini/generativelanguage → **0**.
- Env: image Config.Env + compose environment contain no Google/Firebase/Gemini variable names (only HOST/PORT/PAPERCLIP_*/POSTGRES_*/BETTER_AUTH_SECRET_FILE/HERMES_API_BASE_URL; secrets delivered via Docker secrets files).
- Network: `/proc/net/tcp(+tcp6)` remote endpoints = postgres service (172.16.12.2:5432, internal network only), self health (127.0.0.1:3100), Hermes relay (172.20.0.1:8642), and an intra-gateway peer (172.20.0.3:8137). **No egress to googleapis.com / firebaseio.com / generativelanguage.googleapis.com or any external host.**
- Full-volume re-inventory (round 2, in-container): `docker exec t3-staging-paperclip-1 sh -c "grep -rhoE 'AIza[A-Za-z0-9_-]{34}' /paperclip | sort | uniq -c"` → single unique value, len 39, fingerprint `85ab163f4727450f` — **8 occurrences across 5 files** (3 session JSONs ×2, workspace `services/firebase.ts` ×1, workspace `dist/assets/index-C8FL1zCC.js` ×1). Cross-checked against `git show origin/main:services/firebase.ts | grep -oE 'AIza[A-Za-z0-9_-]+'` → same len/fingerprint. All fingerprints computed in-container/host-side; no key value left the host.

## Findings detail

### F1 (P1) — legacy Firebase web API key live on public surfaces

Key fingerprint: SHA-256 prefix `85ab163f4727450f`, length 39 chars (value withheld per evidence policy).

Present in:
1. `services/firebase.ts` on **`origin/main`** of the public repo `github.com/tetracilin/test_ai_todo` (removed from the K3/K15 release lineage by K12's 92e312c8b, but `main` was never remediated).
2. The **live GitHub Pages bundle** served at `https://tetracilin.github.io/test_ai_todo/assets/index-hRzbZ9DA.js` (fetched during this scan, gitleaks rule `gcp-api-key`, same fingerprint) — i.e. the key is publicly retrievable right now.

Note: Firebase web API keys are identity-project identifiers, not bearer secrets, but they enable
auth-API abuse against project `storied-epigram-470710-t2` if restrictions are absent. K1 revoked
leaked credentials; this surface was evidently out of that scope because removal happened only on
the fork lineage. **Action: revoke/restrict this key in GCP Console (HTTP-referrer restriction or
deletion) and scrub `origin/main` + disable/replace the GH Pages deployment. Human decision required
for the public repo itself.**

### F2 (P2) — key replicated into restored staging agent-session logs

The staging volume was seeded by restoring a snapshot of live data; historical ACP agent session
JSONs contain tool output quoting the old firebase config (**6 occurrences across 3 files, 2 per
file** under `companies/2588c455…/acp-engine/agents/{b4b94950…,dc1862d1…}/sessions/`). Together
with the F4 workspace copies this makes **8 occurrences across 5 files** volume-wide. Not exposed
(bind 127.0.0.1, authenticated mode, private exposure) but present at rest and in every future
backup taken from this volume. Action: purge those session rows/files in staging before K18 backup
rehearsal, or accept documented risk.

### F4 (P2) — same key inside a restored project workspace in the staging volume

A restored user workspace lives at `projects/2588c455…/cfdcf895…/test_ai_todo/` inside the
staging volume and carries the **same legacy key** (in-container SHA-256 fingerprint match,
prefix `85ab163f4727450f`, len 39) in exactly 2 files:

1. `services/firebase.ts` — full legacy config source file;
2. `dist/assets/index-C8FL1zCC.js` — built client bundle embedding the key (1 occurrence each;
   verified in-container against `origin/main`, same fingerprint).

Additionally, 12 `node_modules/@firebase/**` type-stub files in this workspace (`app.d.ts`,
`public-types.d.ts`, `global_index.d.ts` across `@firebase/app`, `@firebase/firestore`,
`@firebase/analytics`, `@firebase/remote-config`) contain AIza-shaped strings — but these are the
well-known Firebase **docs placeholder** (`AIzaSyDOCAbC123dEf456GhI`, len 24, distinct
fingerprint), NOT the legacy key. They are hygiene noise only and do not change severity.

Same containment profile as F2 (private bind volume, not network-exposed), but a credential
inventory must enumerate it: if the K18 purge follows only F2's session-JSON list, these two
copies survive into production rehearsal backups. Action: add this workspace subtree to the K18
purge checklist (or delete the whole restored `test_ai_todo/` directory), and re-run the volume
scan after purging to confirm zero remaining matches of fingerprint `85ab163f4727450f`.

Note on false positives: Paperclip's own `_default` workspace under the same volume root contains
AIza-shaped fixture strings (len 24–30, distinct fingerprints) in gemini-local test fixtures
(`acp.test.{ts,js}`), wasm blobs (`@pierre/diffs`, shiki), diff-plugin maps, and the same
Firebase docs placeholder in `@firebase` stubs. None match the legacy key fingerprint; listed so
future scans do not misclassify them.

### F3 (P3) — stale tracked bundle on main

`dist/assets/index-rWdMXOuK.js` is git-tracked on `main` (added in 518aedcb3 "feat: T-34 feature
deployment with CI/CD pipeline") and embeds the same fingerprint `85ab163f4727450f`. It is not in
the staging image lineage (image built from 7927f06fa where `dist/` is untracked/absent). Covered
by fixing `origin/main`.

## Clean areas (verified)

- Staging UI bundle: no Firebase/Gemini/@google/genai references, no AIza material.
- Image layers (13/13 scanned): no real credentials; env names clean; build metadata pins commit correctly.
- Compose/deploy-staging committed artifacts: gitleaks clean; real values confined to gitignored `deploy-staging/secrets/*` and `.env`.
- Postgres content: secrets only as AES-GCM (`local_encrypted_v1`) ciphertext; plaintext grep of full pg_dump = 0.
- Runtime logs and container stdout/stderr: clean.
- Egress: no Google/Firebase/Gemini network destinations observed.
- `dangerouslyAllowInsecureRemoteHttp=true` remains a disclosed staging-only bridge-hop setting (inherited from K16 handoff); flagged again as residual risk for production.

## Residual risk

1. Public repo `main` + GH Pages still serve the legacy key until owner revokes it (F1) — outside this card's write scope.
2. Staging DB retains historical key copies in session JSONs (F2) and in a restored `test_ai_todo/` project workspace (F4: `services/firebase.ts`, `dist/assets/index-C8FL1zCC.js`) until purged — 8 occurrences across 5 files volume-wide.
3. Insecure plain-HTTP Hermes relay hop accepted for staging only.
4. Image not yet pushed to any registry; digest here covers the local build tag only.

## Evidence pointers

- Reports/artifacts: `k17b-worktree-gitleaks.sarif`, `layer-scan-output2.txt`, fetched GH Pages bundle copy `ghp-bundle.js` (all under `/tmp/k17b/`).
- Commands and counts are quoted inline above; image inspected: `paperclip:k15-7927f06fa` @ `sha256:275f2aaad4ccc3d2c4bfebfbe13bcadaaf7a18ef6a7fa74df2ab4095bad96125`.
