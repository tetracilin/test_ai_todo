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

- [ ] **Set `DISCORD_WEBHOOK_URL` as a repository secret** (P1, human: ~10min / CC: 0 — needs repo settings access)
  - What: populate the secret every report step reads, so failures actually post.
  - Why: all seven t3-nightly runs to date produced zero alerts. The deploy job logs `DISCORD_WEBHOOK_URL not set; skipping`; the `slow-tests` report step exits silently on `[[ -n "$WEBHOOK" ]] || exit 0`. CLAUDE.md promises "a failed deploy or e2e is reported to Discord with a link to the run" — today that never happens, which is why the other items here went unnoticed for five days.
  - Context: it must be a **repo**-level secret, not an environment secret. The `deploy` job declares `environment: staging`, but `slow-tests` (`t3-nightly.yml:199`, `runs-on: ubuntu-latest`) declares no environment at all, so an environment-scoped secret is invisible to it — and the slow-tests alert is the one that would have caught the test regressions. PLAN_CICD.md §2.3 already says repo secret. Channel 1534836487772704800.

- [ ] **Create the nightly artifact-storage secrets on kmv8** (P1, human: ~15min if staging MinIO credentials exist, ~1h if a staging bucket + user must be minted / CC: 0 — agents must not touch kmv8)
  - What: `/etc/t3/secrets/nightly/paperclip_artifacts_access_key` and `..._secret_key`, `root:ghrunner`, mode 0640, holding staging-scoped credentials.
  - Why: PR #78 made both mandatory in `t3-nightly.yml`'s fail-early check and in `deploy/compose.yaml`, and merged without the host-side prerequisite its own commit message demanded. Staging has been frozen at `c3c03e81` (2026-09-03) ever since.
  - Context: staging must never carry production bucket credentials. `deploy/paperclip-config.json` currently sets `storage.provider = "local_disk"` with no `accessKeySecretRef`, so nothing reads the values yet — placeholders would unblock the deploy, but leave a trap for whoever first points staging at S3.

- [ ] **Fix the two server-test regressions on develop** (P2, human: ~1-2h / CC: ~20min)
  - What: (a) `server-startup-feedback-export.test.ts` replaces `@paperclipai/db` wholesale and omits `externalObjects`, which `evidence-provider-minio.ts:131` dereferences at module scope — the file throws before any test runs. (b) `status-cards.test.ts:885` asserts `documentRevisions` is empty, but PR #81's dossier intake hook now seeds a revision for every created issue.
  - Why: both merged green because t3-ci runs no server vitest. Nightly has been red on them since 2026-09-04.
  - Context: (a) came from **PR #80** (`53d00239`), not #79 — `git log -S objectIdentityColumns -- server/src/services/evidence-provider-minio.ts` shows #80 hoisted the deref to module scope; under #79 every `externalObjects` reference sat inside a function body and the mock gap never fired at import. (b) came from PR #81. Two further failures on 2026-09-06 (`tool-gateway.test.ts:2357`, `workspace-runtime.test.ts:7619`) look like contention flakes — the failing set rotates run to run — so reproduce before touching them. Note the earlier nightlies (09-02, 09-03) failed on an unrelated third suite, `cli-invocation-safety.test.ts`.
  - Running these locally needs the plugin-SDK prebuilt first, exactly as the nightly does it: `pnpm --filter @paperclipai/plugin-sdk ensure-build-deps` before any `vitest run`, or you get `ERR_MODULE_NOT_FOUND` for `@paperclipai/plugin-sdk/testing`.

- [ ] **Fix the two remaining branch-protection gaps on `main`** (P2, human: ~10min / CC: ~5min — needs an admin token)
  - What: (a) ~~protect `develop`~~ **done 2026-09-09** — requires the three t3-ci checks, a PR, an up-to-date branch, and blocks force pushes and deletions; (b) turn off `allow_force_pushes` on `main`; (c) turn off `required_linear_history` on `main`.
  - Why: `GET /repos/.../branches/develop/protection` returns 404 "Branch not protected", so "never push directly to develop" is convention only. On `main`, `allow_force_pushes: true` contradicts the CLAUDE.md force-push rule, and `required_linear_history: true` contradicts the release procedure's "merge commit, not squash". The linear-history one is a live contradiction rather than a hard wall: `main`'s tip `2b696cad` is already a two-parent merge commit landed 2026-09-03, and `enforce_admins` is `false`, so the admin reviewer bypasses it. It will stop the first non-admin release.
  - Context: re-verified 2026-09-07 via `gh api`; see PLAN_CICD.md §2.1. Repo settings, not a code change — but reachable through the API with a `repo`-scoped token, which is how (a) was done, so this does not require the web UI.

## From /document-release operator-guide pass (2026-09-08)

- [ ] **Land or close the seven stale Dependabot PRs** (P2, human: ~1h spread over days / CC: ~10min per PR)
  - What: #93 (npm minor/patch group, 33 packages), #61 (lucide-react), #60 (@vitejs/plugin-react), #18 (commander), #13 (@types/supertest), #5 (@types/node), #2 (@mdxeditor/editor). None is rebased on current `develop`; the four oldest predate `t3-ci` existing, so their recorded check results are meaningless.
  - Why: PRs #62 and #63 were exactly this shape — opened 2026-09-02, merged 2026-09-07 97 seconds apart. #63 was five days stale with red checks; #62 had just been rebased and its checks were still RUNNING when it was merged, completing red six seconds later — and broke `develop` at `pnpm install --frozen-lockfile` for every job and both nightly stacks. Reverted in PR #91. The remaining seven sit in the PR list looking mergeable and carry the same hazard.
  - How to land one safely, one at a time: rebase it onto current `develop` → wait for `t3-ci` to actually re-run and go green → merge that one → confirm `develop` is still green → only then start the next. Never merge two in the same sitting; their lockfiles are computed independently and the second one's will not account for the first.
  - Context: `docs/operating-with-claude-code.md` records this as a repo-specific trap. The durable fix is branch protection on `develop` with "require branches to be up to date" — see the branch-protection item above — which makes this class mechanically unmergeable rather than relying on the reviewer remembering.
