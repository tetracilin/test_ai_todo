# TODOS

Deferred work with enough context to pick up cold. Format: what / why / context / effort / priority.

## Deferred from /autoplan CEO review of WP-0 (2026-09-01)

- [ ] **NAS bulk-import tooling for confidential-project evidence** (P3, human: ~2d / CC: ~2h)
  - What: a helper that files path references for batches of confidential (defense/B2G) artifacts already on the NAS, so confidential projects get the same evidence-gate discipline without content ever entering chat or the repo.
  - Why: C16 keeps confidential projects off chat bots entirely; their engineers use the NAS drop folder, which today means manual per-file card linking.
  - Context: provider `nas` external objects are path-reference-only (backlog.md PC-007 AC3, AD-021/C16). Revisit when the first confidential project needs volume filing.
  - Depends on: PC-007 shipped.

- [ ] **Competitive/moat section in roadmap.md** (P3, human: ~1h / CC: ~10min)
  - What: ~10 lines naming the real competitor (status quo: PM keeps doing it manually; generic AI assistants over any group chat) and the moat claim (evidence gate + Teable/NAS/dossier integration — the system, not the chat bot).
  - Why: zero competitive analysis exists in the SSoT trio; it changes what gets defended (the substrate, not the bot). Flagged by /autoplan CEO outside voice (F8), 2026-09-01.
  - Context: roadmap.md is owner-edited; /autoplan deferred rather than editing a sibling SSoT.

## From /autoplan Final Gate (2026-09-02)

- [ ] **WhatsApp work package (deferred by gate decision: Discord-only pilot)** (P2, human: ~1-2w / CC: ~2d)
  - What: bind the WhatsApp Business Cloud API transport to the channel-agnostic verb pipeline: webhook with raw-body HMAC + rate limit + body cap, media content-type allowlist, 24h-window/template handling, per-message spend cap under budgets.
  - Why: second channel, taken up only after the four verbs prove out on the Discord pilot; decision made against the post-pilot channel comparison (WhatsApp vs Zalo OA).
  - Context: all WhatsApp-specific op ACs (1/4/12) in backlog.md carry a re-scope note pointing here. Evidence to gather first: pilot-human channel usage, Zalo OA API snapshot, Meta 2026-10-01 in-window AI-reply billing.
  - Depends on: WP-0 pilot verb validation; channel comparison recorded on C13.

- [ ] **Identity doctrine sentence in roadmap.md (owner edit)** (P2, human: ~15min)
  - What: add: "For now, Tecotec-specific wins on conflict; portability is preserved only as (a) no company-id hardcoding and (b) company export keeps working."
  - Why: gate decision D4 (2026-09-02) — resolves the portable-OS premise vs Tecotec-bound backlog tension before WP-0 implementation hits it.

## From /document-release status audit (2026-09-07)

All four found by auditing the docs against live repo and Actions state. The first two are the
reason the other two went unnoticed for five days.

- [ ] **Set `DISCORD_WEBHOOK_URL` on the staging and production environments** (P1, human: ~10min / CC: 0 — needs repo settings access)
  - What: populate the secret both deploy workflows read, so the report steps actually post.
  - Why: every t3-nightly run logs `DISCORD_WEBHOOK_URL not set; skipping` and passes an empty `WEBHOOK` to its report step. Seven consecutive red nightlies produced zero alerts. CLAUDE.md promises "a failed deploy or e2e is reported to Discord with a link to the run" — today that never happens.
  - Context: `.github/workflows/t3-nightly.yml` Discord steps; channel 1534836487772704800.

- [ ] **Create the nightly artifact-storage secrets on kmv8** (P1, human: ~15min if staging MinIO credentials exist, ~1h if a staging bucket + user must be minted / CC: 0 — agents must not touch kmv8)
  - What: `/etc/t3/secrets/nightly/paperclip_artifacts_access_key` and `..._secret_key`, `root:ghrunner`, mode 0640, holding staging-scoped credentials.
  - Why: PR #78 made both mandatory in `t3-nightly.yml`'s fail-early check and in `deploy/compose.yaml`, and merged without the host-side prerequisite its own commit message demanded. Staging has been frozen at `c3c03e81` (2026-09-03) ever since.
  - Context: staging must never carry production bucket credentials. `deploy/paperclip-config.json` currently sets `storage.provider = "local_disk"` with no `accessKeySecretRef`, so nothing reads the values yet — placeholders would unblock the deploy, but leave a trap for whoever first points staging at S3.

- [ ] **Fix the two server-test regressions on develop** (P2, human: ~1-2h / CC: ~20min)
  - What: (a) `server-startup-feedback-export.test.ts` replaces `@paperclipai/db` wholesale and omits `externalObjects`, which `evidence-provider-minio.ts:131` dereferences at module scope — the file throws before any test runs. (b) `status-cards.test.ts:885` asserts `documentRevisions` is empty, but PR #81's dossier intake hook now seeds a revision for every created issue.
  - Why: both merged green because t3-ci runs no server vitest. Nightly has been red on them since 2026-09-04.
  - Context: introduced by PRs #79 and #81. Two further failures the same night (`tool-gateway.test.ts:2357`, `workspace-runtime.test.ts:7619`) look like contention flakes — the failing set rotates run to run — so reproduce before touching them.

- [ ] **Fix the three branch-protection gaps** (P2, human: ~15min / CC: 0 — needs repo settings access)
  - What: (a) protect `develop` with the `unit` / `build` / `build-image` checks, matching `main`; (b) turn off `allow_force_pushes` on `main`; (c) turn off `required_linear_history` on `main`.
  - Why: `GET /repos/.../branches/develop/protection` returns 404 "Branch not protected", so "never push directly to develop" is convention only. On `main`, `allow_force_pushes: true` contradicts the CLAUDE.md force-push rule, and `required_linear_history: true` will reject the `develop → main` merge commit the release procedure requires — so it blocks the first real release, not just style.
  - Context: re-verified 2026-09-07 via `gh api`; see PLAN_CICD.md §2.1. Repo settings only; no PR can make these changes.
