---
title: "K17b — Independent Credential and Bundle Security Sweep"
created: 2026-08-25T21:40:00Z
updated: 2026-08-25T21:40:00Z
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
| F2 | P2 | Same key embedded in agent session logs inside the restored staging DB volume (`/paperclip/.../acp-engine/**/sessions/*.json`, 6 occurrences, 6 files). Contained (private bind, authenticated mode) but present at rest. |
| F3 | P3 | Stale tracked bundle `dist/assets/index-rWdMXOuK.js` exists only on `main` (commit 518aedcb3), which is **not** in the staging/release lineage — but `main` is a public GitHub repo with a live GH Pages deploy. |

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
JSONs contain tool output quoting the old firebase config (6 occurrences across 6 files under
`companies/<id>/acp-engine/agents/*/sessions/`). Not exposed (bind 127.0.0.1, authenticated mode,
private exposure) but present at rest and in every future backup taken from this volume. Action:
purge those session rows/files in staging before K18 backup rehearsal, or accept documented risk.

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
2. Staging DB retains historical key copies in session JSONs (F2) until purged.
3. Insecure plain-HTTP Hermes relay hop accepted for staging only.
4. Image not yet pushed to any registry; digest here covers the local build tag only.

## Evidence pointers

- Reports/artifacts: `k17b-worktree-gitleaks.sarif`, `layer-scan-output2.txt`, fetched GH Pages bundle copy `ghp-bundle.js` (all under `/tmp/k17b/`).
- Commands and counts are quoted inline above; image inspected: `paperclip:k15-7927f06fa` @ `sha256:275f2aaad4ccc3d2c4bfebfbe13bcadaaf7a18ef6a7fa74df2ab4095bad96125`.
