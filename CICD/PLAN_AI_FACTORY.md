# PLAN_AI_FACTORY — CI/CD upgrade plan, v2 (for review)

Repo: `tetracilin/test_ai_todo` · Host: `kmv8` · Status: **DRAFT, awaiting owner review**
Extends `CICD/PLAN_CICD.md` (Phase 1–4 there are treated as done or superseded here) and
`docs/designs/t3-agent-host-access.md` (its Phase 2 becomes Phase 3 below).
Written 2026-09-18. Every claim about pipeline state was checked against the Actions API
that day, not inferred from documents; the documents were wrong in three places (§0.4).

---

## 0. Read this first: what is actually failing

### 0.1 The failure you are receiving is not from the pipeline

The message quoted in the task:

```
T3 nightly build — FAILED
main worktree is dirty; refusing to build. Commit or stash first.
merged: 0 | skipped: 0
image: none
port: 33130
log: /root/.hermes/logs/t3-nightly-20260917-220041.log
```

is produced by the **legacy Hermes cron nightly** on kmv8, not by GitHub Actions:

| Evidence | Where it points |
|---|---|
| Log path `/root/.hermes/logs/t3-nightly-*.log` | Hermes home on the host, not `~/actions-runner/_diag` |
| `merged: N \| skipped: N` summary | The branch-scanning script that used to merge `t3-paperclip-aitodo/*` branches (`CICD/CLAUDE-cicd-section.md` "Branch flow": *"the nightly script no longer scans them"*) |
| "main worktree is dirty" | The shared checkout `/root/projects/t3-paperclip-Aitodo` (CLAUDE.md hard rule 3), which the script builds from and which someone has left with uncommitted changes |
| Fires at 22:00 UTC | Same slot as the Actions schedule (`t3-nightly.yml:14`), so the two are easily conflated |

`t3-nightly.yml:3` says it *replaces* `/root/.hermes/scripts/t3-nightly-build.sh` and Hermes
cron `8b51805f9dc5`. `PLAN_CICD.md` §4 step 2 says to disable that cron at cutover. It was
never disabled: `docs/deploy/kmv8-stack-inventory.md` gap 4 records the owner still receiving
its morning notifications, and `t3-agent-host-access.md` ("Status Quo") says the same.

**Two consequences.** First, every "troubleshooting attempt" aimed at the Actions workflow was
aimed at the wrong pipeline; that pipeline's deploy has been green since 2026-09-08. Second,
the legacy script targets **port 33130, the same stack Actions deploys to**. Today it refuses
to build because the worktree is dirty. The day someone "fixes" that by committing or
stashing, it will build a hand-rolled image and deploy it over the Actions-managed
`t3-nightly` stack, and the Actions health check will start failing on commit mismatch.
Retiring it is the P0 in this plan (Phase 0.1).

### 0.2 What the Actions pipeline actually does today (last five runs)

Read the **job**, not the run. `t3-nightly` has three independent jobs.

| Run | Date (UTC) | Trigger | `develop` sha | build-and-deploy (kmv8) | e2e | slow-tests | Failing test |
|---|---|---|---|---|---|---|---|
| 24 `35288968354` | 09-17 23:55 | schedule | `f6de6fba` | ✅ 5m09 build, health OK | ✅ 8m42 | ❌ 23m36 | `workspace-runtime.test.ts:7441` (`adopted: 0` vs `1`) |
| 23 `35201279125` | 09-17 08:44 | dispatch | `5f694591` | ✅ 7m00 build, health OK | ✅ 8m49 | ❌ 35m43 | `plugin-worker-manager-duplex.test.ts:368` (`[]` vs `["aaaaa","bbbbb"]`) |
| 22 `35165285609` | 09-17 00:08 | schedule | `2ea7b0ad` | ✅ | ❌ | ❌ | stale e2e specs (fixed by #104), two server suites (fixed by #103) |
| 21 `35038014050` | 09-15 23:58 | schedule | `2ea7b0ad` | ✅ | ❌ | ❌ | same |
| 20 `34912759866` | 09-15 00:20 | schedule | `2ea7b0ad` | ✅ | ❌ | ❌ | same |

Totals: 24 runs since 2026-09-02, **zero fully green**, but the shape has changed completely
since 2026-09-17:

- **Deploy works.** Staging at `100.103.41.112:33130` serves `f6de6fba`, the current head of
  `develop`, verified by the workflow's own commit-matching health check in run 24.
- **e2e works.** It executed for the first time in run 23 (PR #98 made it its own job, PR #104
  fixed the stale specs) and has passed twice. The docs still say "e2e has never run".
- **slow-tests is the only red job**, and it is red on **one test out of 4,834**, a different
  one each night. 406 of 407 test files pass. Both failures are timing-shaped (a reconciliation
  that has not "adopted" yet; a duplex stream whose chunks have not arrived yet) on a 2-vCPU
  GitHub-hosted runner running the whole server suite serially for 24–36 minutes. That is a
  flake profile, not a regression profile. `CLAUDE.md` is right that a red check is never
  "flaky, merge anyway"; the fix is to make the two tests deterministic and to stop running
  4,834 tests on one small machine (Phase 1).
- **Discord alerts now fire.** In runs 23 and 24 the report step shows `WEBHOOK: ***` (a
  set, masked secret); in runs 20–22 it shows `WEBHOOK:` (empty). The secret was created on
  2026-09-17. `TODOS.md:35`, `PLAN_CICD.md` §0, `CLAUDE.md` and the operator guide all still
  say it is unset.

### 0.3 What has never happened

- **`t3-release` has never run.** Zero runs. `main` is 32 commits behind `develop` and 0
  ahead. Tag `v0.1.0` points at `7927f06f`, a commit from before the fork cleanup. Production
  (`t3-prod`, `:33100`) runs a hand-deployed image of unknown provenance (inventory §t3-prod).
  Every rule in `CLAUDE.md` about releases describes a path nobody has walked.
- **No PR has ever been gated on server tests.** `t3-ci` runs the non-server vitest groups only
  (`t3-ci.yml:95-99`). Two regressions reached `develop` this way (#80, #81). At agent merge
  rates this is the largest open hole.

### 0.4 Documents that are now wrong (fix in Phase 0, one docs PR)

| Document | Says | Reality (2026-09-18) |
|---|---|---|
| `CLAUDE.md` "Staging / nightly", `TODOS.md:35`, `PLAN_CICD.md` §0 and §8, `docs/operating-with-claude-code.md` "Traps" | `DISCORD_WEBHOOK_URL` unset, no alert ever sent | Set since 2026-09-17; runs 23 and 24 posted |
| `CLAUDE.md`, operator guide, `PLAN_CICD.md` §0 | e2e has never executed | Executed and passed in runs 23 and 24 |
| `PLAN_CICD.md` §4, §8 | Hermes cron retired at cutover | Still firing nightly; it is the source of the failure email |
| `.github/CODEOWNERS` | Owners `@cryppadotta @devinfoley @nickyleach` for `.github/**`, `package.json`, `pnpm-lock.yaml`, `skills/**` | Upstream maintainers, not collaborators here. "Require review from code owners" cannot be enabled until this is rewritten |

---

## 1. What "AI factory" means for this repository

The charter (`design.md:85-94`, `docs/designs/t3-company-os-ssot.md` premise 5) commits to an
agent loop that authors and merges PRs, measured on *merged auto-PRs vs. regressions and
rollbacks*. Industry practice in 2026 (sources in §9) converges on the same shape:

- Agent-authored PRs merge less often than human ones (roughly 55–68% vs. 86–87% in the
  Microsoft/Spotify data), so **the gate matters more, not less**, as agent volume rises.
- Agents fit CI/CD at five points: PR review, test selection and repair, build-failure
  triage, security remediation, post-deploy verification. Each is a place where a failure
  signal becomes an *action* instead of an email.
- The factory separates three approvals: accepting work into the queue, approving the plan,
  merging the PR. Humans keep the second and, for production, the third.
- Every agent action carries an attribution trailer and a kill switch.

Translated into seven principles this plan enforces:

| # | Principle | What violates it today |
|---|---|---|
| P1 | **One deployer per stack.** Only a workflow may change what runs on `:33130` or `:33100`. | Hermes cron targets `:33130`; `t3-prod` was hand-deployed |
| P2 | **Gates that can refuse.** A red or stale PR cannot merge; a PR that touches `server/` runs the server suites before merge. | `unit` skips all server tests; CODEOWNERS is dead |
| P3 | **Per-PR attribution.** A regression must map to one PR, not to "whatever landed since last night". | Server suites and e2e run only nightly, after N merges |
| P4 | **Trusted/untrusted split.** PR code runs only on GitHub-hosted runners; kmv8 runs only merged `develop`/`main`. | Already correct; keep it |
| P5 | **Actionable signals.** One message per nightly naming job, test, sha and the PRs since the last green. | Three separate Discord messages from three jobs; a legacy email that names an un-actionable cause |
| P6 | **Host operations through reviewed workflows**, never through a shell handed to a human at 2 a.m. | Secret files, cron retirement, stack restarts all require the owner to type commands they were not shown |
| P7 | **Build once, promote the digest.** The image tested in staging is the image deployed to production. | `t3-release.yml:113` rebuilds from the tag on kmv8; prod never runs a tested image |

---

## 2. Target architecture

```
feature/* PR ──▶ t3-ci (GitHub-hosted, untrusted)
                 ├─ unit  (non-server vitest, guards)          required
                 ├─ build (pnpm build, bundle scan, net guard)  required
                 ├─ build-image (docker, cache)                 required
                 ├─ server-tests (only when server/** changed;  required, skip = pass
                 │    sharded general-server + serialized)
                 └─ claude-review (advisory comment; Phase 5)
        ▼ squash-merge (human today; steward agent for feature/* later, never main)
develop ──▶ t3-nightly 22:00 UTC or dispatch
             ├─ build-and-publish (GitHub-hosted) ─▶ ghcr.io/tetracilin/paperclip:nightly-<sha>
             ├─ deploy (kmv8) pulls digest ─▶ compose up ─▶ health(sha) ─▶ seed tester ─▶ smoke(login, list, create issue)
             ├─ slow-tests matrix [general-server ×3, serialized ×2, workspaces-a, workspaces-b]
             ├─ e2e matrix [×2 via scripts/e2e-shard.mjs]
             └─ summary (needs: all, if: always) ─▶ ONE Discord message + job summary + flake ledger
develop ──▶ PR ──▶ main ──▶ tag vX.Y.Z ──▶ t3-release
             ├─ verify-tag-on-main (GitHub-hosted)
             ├─ resolve digest: the nightly-<sha> image already tested (P7); rebuild only if absent
             ├─ [production environment gate: human approval]
             └─ deploy (kmv8) ─▶ health(sha) ─▶ release smoke ─▶ Discord
t3-hostops (kmv8, `hostops` environment, human approval) ─ secrets:check · secrets:provision-missing · stack:status · stack:restart · stack:logs · db:backup
```

Workflow inventory after the upgrade (all under `.github/workflows/`, all prefixed `t3-`):

| Workflow | Change | Phase |
|---|---|---|
| `t3-ci.yml` | + `server-tests` conditional required job; + `merge_group` trigger only if the repo moves to an org (§3.2.3) | 2 |
| `t3-nightly.yml` | restructure per diagram: shard slow-tests and e2e, single summary, post-deploy smoke, publish image | 1, 2 |
| `t3-release.yml` | promote the tested digest instead of rebuilding; add release smoke; keep the human gate | 2, 4 |
| `t3-hostops.yml` | **new**, from `t3-agent-host-access.md` Phase 2 | 3 |
| `t3-claude-review.yml` | **new**, advisory PR review via `anthropics/claude-code-action`; fork PRs get no secrets | 5 |

---

## 3. Upgrade phases

Each phase ends with a verification you can run yourself. Phases 0 and 1 are the ones that
turn the nightly green; everything after is what makes green *stay* green at agent rates.

### Phase 0 — Stop the noise (operator, ~1 hour, no pipeline PR)

**0.1 Retire the Hermes cron nightly (P0).** This is the source of the failure email and the
only remaining second deployer on `:33130`.

On kmv8, as root:
```
hermes cron list
```
Find `8b51805f9dc5` and disable it (Hermes' own command; the CLI verb is `hermes cron disable
<id>` or the equivalent in the Hermes UI — confirm the verb from `hermes cron --help` rather
than from this document, which cannot see the host). Then move the script aside so nothing
re-enables it by accident:
```
mv /root/.hermes/scripts/t3-nightly-build.sh /root/.hermes/scripts/t3-nightly-build.sh.retired-2026-09-18
```
Verify next morning:
```
ls -t /root/.hermes/logs/t3-nightly-* | head -1
```
must show no file newer than 2026-09-17, and no "T3 nightly build" email arrives. Then:
```
docker ps --format '{{.Names}}\t{{.Image}}' | grep t3-nightly
```
must show `paperclip:nightly-<8 hex>` only.

**0.2 Decide the fate of `/root/projects/t3-paperclip-Aitodo`.** It is "dirty". Either the
agent team still uses it, in which case its uncommitted changes are theirs to commit on a
`feature/*` branch, or nobody does, in which case rename it `…-archived-2026-09-18` and leave
it. Do not `git checkout -- .` or `git clean` it: the dirty state may be somebody's work.

**0.3 Close or refresh the 19 open PRs.** Eleven predate the fork flow and target `main` or
retired branches (#22, #25, #26, #27, #28, #29, #30, #36, #38, #39, #42); close them with a
one-line comment pointing at `doc/ORIGIN.md`. Seven are Dependabot (#2, #5, #13, #18, #60,
#61, #93): #93 is red on `t3-ci`; the rest are stale by two weeks. Close all seven and let the
monthly grouped run (`.github/dependabot.yml`) reopen a single fresh grouped PR against the
current lockfile. #106 (ci) is current; review and merge it. Result: an open-PR list that
contains only live work, which is what a steward agent will later be allowed to touch.

**0.4 One docs PR** correcting the four rows in §0.4 and adding this file to `CLAUDE.md`
"Where things live". Docs only, no workflow changes, so it can merge without the `ci` label.

Verification for Phase 0: no legacy email for two consecutive mornings; open PRs ≤ 3;
`docs/deploy/kmv8-stack-inventory.md` gap 4 closed.

### Phase 1 — First fully green nightly (one `fix/*` PR, one `ci` PR)

**1.1 Make the two flaky server tests deterministic** (`fix/nightly-flaky-server-tests`,
touches `server/` only):

- `server/src/__tests__/workspace-runtime.test.ts:7441` expects `adopted: 1` immediately after
  `reconcilePersistedRuntimeServicesOnStartup`. On a slow runner the supervisor stdio close
  that the test simulates has not propagated yet. Await the observable state (poll the
  persisted row or the service handle until adopted or timeout), then assert.
- `server/src/__tests__/plugin-worker-manager-duplex.test.ts:368` expects both chunks to have
  been delivered before `session.wait()` resolves. Collect chunks with a promise that resolves
  on the second chunk, race it against the cap-exceeded end, then assert; do not rely on the
  order in which the route end and the listener callbacks are scheduled.

Run each 20× locally under load to confirm (`for i in $(seq 20); do npx vitest run <file>
|| break; done`) after `pnpm --filter @paperclipai/plugin-sdk ensure-build-deps`.

**1.2 Shard `slow-tests` across machines** (`ci/nightly-shard-and-summarize`). The runner
already supports it: `scripts/run-vitest-stable.mjs:165-220` accepts `--shard-index` and
`--shard-count` for `--mode serialized`, `--group general-server` and
`--group general-workspaces-a`, balanced by the duration manifests in `scripts/*shard-durations.json`.
Matrix:

| Job | Command | Est. wall clock |
|---|---|---|
| `slow-tests (general-server, 0..2 of 3)` | `test:run:general --group general-server --shard-index N --shard-count 3` | ~7 min |
| `slow-tests (serialized, 0..1 of 2)` | `test:run:serialized --shard-index N --shard-count 2` | ~8 min |
| `slow-tests (workspaces-a)`, `(workspaces-b)` | unchanged groups | ~4 min |
| `e2e (0..1 of 2)` | `node scripts/e2e-shard.mjs --shard-index N --shard-count 2` piped to `playwright test` | ~5 min |

Effect: nightly wall clock from 36 min to ~10 min, and each shard runs with the CPU headroom
that makes the timing-sensitive suites stop flaking. The manifests were sampled on 2026-08-04;
refresh them in the same PR (`general-server-shard-durations.json` documents the method).

**1.3 One summary job** (`needs: [deploy, slow-tests, e2e]`, `if: always()`) that posts a single
Discord message and a GitHub job summary:

```
✅/❌ nightly f6de6fba — deploy ✅ · server-tests ✅ (7 shards) · e2e ✅ (2 shards)
Staging: http://100.103.41.112:33130 (login: admintest@staging.local)
Changes since last green (2ea7b0ad → f6de6fba): • #103 … • #104 … • #105 …
Failures: server-tests/serialized-1 → src/__tests__/foo.test.ts > bar (first seen 09-17, 2/2 runs)
```
The per-job Discord steps go away. The failing-test line comes from vitest's JSON reporter
(`--reporter=json --outputFile`) uploaded as an artifact by each shard and merged in summary.
"First seen / N of last M runs" is the **flake ledger**: a small JSON file committed to a
`ci-ledger` branch or kept as a rolling artifact; it is what turns "red again" into "this
exact test, third night running, assign it".

**1.4 Post-deploy smoke on kmv8** (in `deploy`, after the tester seed): sign in as the seeded
tester through `/api/auth/sign-in/email` with the real `Origin` header, list companies,
create and delete an issue. PR #99's lesson was that a green health check proved the bind and
nothing about usability (sign-in returned 403 for four days). Ten lines of bash with `curl`
and `jq`, reusing `deploy/scripts/seed-staging-tester.sh`'s sign-in block.

Verification for Phase 1: **one fully green `t3-nightly` run**, the first ever; the Discord
channel receives exactly one message for it; the summary names zero failures.

### Phase 2 — Gates that refuse at agent rates (repo settings + two `ci` PRs)

**2.1 Server tests on pull requests that touch the server** (`ci/pr-server-tests`). Add a
`server-tests` job to `t3-ci.yml` that runs only when the PR diff touches `server/**`,
`packages/db/**`, `packages/shared/**` or `pnpm-lock.yaml` (compute with
`git diff --name-only origin/${{ github.base_ref }}...HEAD`; no third-party action needed),
using the same sharded matrix as nightly. Make `server-tests` a **required** check: GitHub
treats a skipped required job as passing, so PRs that do not touch the server pay nothing.
Cost: ~8–10 min on server PRs. This is the single change that closes the #80/#81 hole and
gives per-PR attribution (P2, P3).

**2.2 Rulesets on `main`.** `PLAN_CICD.md` §2.1 still lists two contradictions:
`allow_force_pushes: true` and `required_linear_history: true` versus the documented
"merge commit, not squash" release. Resolve: block force pushes; **drop linear history** on
`main` and keep merge-commit releases so `main`'s history is exactly `develop`'s at each tag
(a rollback by tag then maps to a known set of squash commits). Convert both branches from
classic protection to a **ruleset**, because rulesets are what merge queue, bypass lists and
audit logs attach to.

**2.3 Merge queue: not available here, and why.** `tetracilin` is a personal account.
GitHub's merge queue is only offered on public repositories **owned by an organization** (or
Enterprise Cloud private repos). Options:

| Option | Cost | When |
|---|---|---|
| A. Transfer the repo to a free organization (e.g. `tetracilin-t3`) | Zero money; redirects keep old URLs, PRs, Actions history, runner registration must be redone once | When agent-merged PRs exceed ~10/day, or when two agents first race each other into `develop` |
| B. Keep "require branch up to date" (already on) | Zero; serializes merges by making each PR rebase after the previous one lands | Now. Correct at today's 2–4 PRs/day |

Recommendation: **B now, A when the steward agent (Phase 5) goes live.** If you choose A,
`t3-ci.yml` gains `on: merge_group:` and nothing else changes.

**2.4 Rewrite `.github/CODEOWNERS`** to `@tetracilin` for `.github/**`, `deploy/**`,
`CICD/**`, `package.json`, `pnpm-lock.yaml`, and enable "require review from code owners".
Today CODEOWNERS names three upstream maintainers with no access, so the rule would block
every pipeline PR forever if switched on as-is. This is what enforces `CLAUDE.md` hard rule 6
(pipeline changes get a human) mechanically instead of by convention.

**2.5 Build once, promote the digest** (`ci/build-once-promote`, P7). Move the image build
from kmv8 to the GitHub-hosted `build-image` job, which already builds it (`t3-ci.yml:150`),
and push to `ghcr.io/tetracilin/paperclip` (free for public repos; needs
`permissions: packages: write`). Nightly and release deploys `docker pull` by digest.
Consequences: the image tested by nightly is byte-identical to the one released; kmv8 stops
spending 5–7 min of CPU per build next to production; `image-retention.sh` becomes a
registry-retention policy. **Pipeline contract change** (`PAPERCLIP_IMAGE` now carries a
registry ref, and `t3-release.yml` needs `packages: read`): its own PR, human-reviewed, and
`CLAUDE.md` "Pipeline contracts" updated in the same PR.

**2.6 Agent identity.** Create a GitHub App (`t3-factory-bot`) installed on the repo with
`contents: write`, `pull_requests: write`, `checks: read`, no admin. Agent workflows mint a
short-lived installation token (`actions/create-github-app-token`); no PAT anywhere. Commits
carry `Co-Authored-By` plus an `Assisted-by: <agent>:<model>` trailer, per the pattern the
Linux kernel adopted in 2026. CODEOWNERS (2.4) then guarantees the bot cannot approve its own
pipeline change.

Verification for Phase 2: open a throwaway PR that deletes one server test assertion and
confirm `server-tests` blocks it; confirm a pipeline-file PR shows "review required from code
owner"; confirm `docker inspect` on staging shows a `ghcr.io/…@sha256:` image.

### Phase 3 — Host operations through a workflow (`t3-hostops`, one `ci` PR)

Exactly `docs/designs/t3-agent-host-access.md` Phase 2, with one addition. Operations as
checked-in scripts under `deploy/scripts/hostops/` with the exec bit committed, exposed via
`workflow_dispatch` with a `choice` input, run on `[self-hosted, kmv8]` under a new `hostops`
environment with `@tetracilin` as required reviewer:

| Operation | Does | Never |
|---|---|---|
| `secrets:check <nightly\|prod>` | Reports presence and non-emptiness of the four secret files | prints a value |
| `secrets:provision-missing <nightly>` | Creates absent files from `openssl rand` | overwrites, touches `prod` |
| `stack:status` | `docker compose ps`, health JSON, image digest, for both stacks | mutates |
| `stack:restart <nightly\|prod>` | `compose restart`; `prod` routes through the `production` environment gate | `down -v` |
| `stack:logs <nightly> [lines]` | Tail with the same redaction rules as `t3-nightly`'s Discord step | secrets |
| `db:backup <nightly\|prod>` | Runs `deploy/scripts/backup-postgres.sh` into `/etc/t3/backups/<stack>/` | restores |

Addition: `secrets:check prod` is the first thing to run, because `t3-release.yml:99-102`
gates on `/etc/t3/secrets/prod/` and nobody has verified it (inventory gap 3; the same gap
kept nightly red for five days in September).

Verification: an agent, given the task "confirm prod secrets are complete", closes it end to
end by dispatching `secrets:check prod` and reading the run, with no human typing a command.

### Phase 4 — First production release through the pipeline (human, ~1 hour)

1. `secrets:check prod` green (Phase 3), or the operator creates the files by hand once.
2. PR `develop → main` (merge commit). Title: `release: v0.2.0`. Body lists the 32 squash
   commits by PR number (the nightly summary's change list is the template).
3. `git tag -a v0.2.0 -m "First release via t3-release" && git push origin v0.2.0`.
4. Approve the `production` gate in the Actions UI. Watch `t3-release` pull the digest that
   nightly tested (P7), deploy, health-check, run the release smoke.
5. Confirm `curl -s 100.103.41.112:33100/api/health` reports the tagged sha.
6. **Rollback rehearsal** the same week: re-run `t3-release` for `v0.2.0` after cutting a
   trivial `v0.2.1`, and confirm the older sha comes back. Do not rehearse against `v0.1.0`:
   it predates 32 commits of schema migrations and the migration rule in `CLAUDE.md` says the
   pipeline cannot roll those back.

Verification: `t3-release` has one green run; production's health sha matches the tag; the
rollback rehearsal has a green run.

### Phase 5 — The factory loop (agents on the pipeline)

Only after Phases 1–3 hold for one week, because agents amplify whatever the gate lets
through (the two Dependabot PRs of 2026-09-07 demonstrated this at a volume of two).

**5.1 Advisory review on every PR** (`t3-claude-review.yml`): `anthropics/claude-code-action`
on `pull_request` for same-repo branches, read-only, posting one review comment. Fork PRs
run under `pull_request` (no secrets), so the job skips for them. Budget order of magnitude:
tens of dollars a month at current PR volume (§9). The job is **not** a required check; its
value is triage, not gating.

**5.2 CI-failure fix loop on `feature/*` only.** When `t3-ci` fails on a same-repo PR, the
author (human or agent) may comment `@claude fix ci`; the action reads the failed job log,
pushes a fix commit to the PR branch as `t3-factory-bot`, and stops. It never runs on
`develop`, `main`, or pipeline files (CODEOWNERS paths are excluded in the workflow
condition). This retargets the existing `.agents/skills/prcheckloop` and
`prepare-paperclip-pr` skills at this fork's `develop` (they still say `paperclipai/paperclip`
master).

**5.3 Nightly triage.** When the summary reports a failure, the same action opens (or updates)
one `fix/nightly-<test-slug>` PR per failing test, carrying the ledger history in the body.
No auto-merge. This is what makes the flake ledger self-healing.

**5.4 Metrics that the charter asks for** (`design.md:93`, PC-013), computed by the summary
job and posted weekly:

| Metric | Source |
|---|---|
| Staging deploy frequency | `t3-nightly` green deploys / week |
| Lead time PR → staging | PR merged_at → deploy record |
| Change failure rate | `revert:`/`fix/nightly-*` merges ÷ merges |
| Time to green | first red summary → next green summary |
| Auto-PR share | commits with `Assisted-by:` ÷ all, via `scripts/paperclip-commit-metrics.ts` |

**5.5 Kill switch.** Repository variable `T3_AGENT_AUTOMATION` (`on`/`off`) checked in the
first step of every agent workflow. Flipping it needs no PR and no deploy.

**5.6 Issue-driven development loop (proposed 2026-09-22, not yet decided — see D10).**
Owner request, verbatim: an agent reads a GitHub issue, decides using this repo's
architecture and docs, develops, tests, opens a PR, loops CI to green, merges, documents,
and logs the run into the nightly report. No part of this exists as one pipeline today.
Each step maps to something already built, partially built, or genuinely new:

| Step | Maps to | Status |
|---|---|---|
| 1. Read the issue | new: an issue-intake step that fetches one open issue by label | not built |
| 2. Decide using architecture/docs | new: point it at the SSoT trio (`roadmap.md` → `backlog.md` → `design.md`) plus `AGENTS.md`/`CLAUDE.md`, the same reading order every human contributor follows | not built |
| 3. Develop | existing convention: `feature/*`/`fix/*` from `develop`, one PR per task (`CLAUDE.md`) | convention exists, not automated |
| 4. Test | existing: `pnpm test`, server suites once §2.1 lands | exists |
| 5. Open PR | existing convention (PR template, thinking path, model-used field) | convention exists, not automated |
| 6. Loop CI to green | `.agents/skills/prcheckloop` (merged) and the fuller draft in PR #113 (`t3-pr-loop`, open) | **already built** |
| 7. Merge | forbidden today, everywhere it is mentioned — `CLAUDE.md`: "Do not merge your own PR unless the task explicitly says so"; `.agents/skills/pr-gardening` and PR #113 both stop at opening/updating a PR | **the one real policy gap** |
| 8. Document | PR #113 posts a hand-off comment to a human; nothing writes a durable record | partial |
| 9. Nightly log | the Phase 1.3 summary already lists commit/PR titles since the last deploy | partial, generic |

`CLAUDE.md`'s rule already lets an agent merge *when a human says so for that task* — that
is what happened repeatedly this session. Step 7 as described asks for something different:
standing authorization to merge without a human present at each instance. Every other agent
capability in this file — 5.1 (advisory review), 5.2 (CI-fix on request), 5.3 (nightly triage
PR) — stops at "open or update a PR" on purpose, so a human's click stays the last gate
before code lands on `develop`. This plan does not decide that for you; it describes what
would have to exist if you say yes.

**If approved, scope it narrower than "any issue":**

- **Issue eligibility.** Only issues carrying a label such as `auto-eligible`, applied
  deliberately by a human when filing or triaging — never every open issue by default.
  Exclude anything labelled `decision` outright (this session's #126–129 and #133 exist
  precisely because they need a human judgment call, not code). Exclude anything that would
  touch `.github/workflows/`, `deploy/compose.yaml`, `deploy/scripts/`, or a secret — those
  stay `ci`-labelled and human-reviewed regardless (`CLAUDE.md` hard rule).
- **Branch and diff scope.** `feature/*`/`fix/*` from `develop` only, same as every rule in
  this file; a diff-size or file-count cap, so the loop declines rather than guesses on a
  large refactor.
- **The merge gate itself.** Auto-merge fires only when every required check is green
  (§2.1's `server-tests` included) and Greptile is clean (a checklist item every PR already
  carries) — and, as the new mechanical control, a second, independent agent pass (or
  `t3-claude-review`, 5.1) reviews the diff and returns a pass, so the agent that wrote the
  code is never the only thing that approved it.
- **Reuse, don't rebuild, step 6.** `.agents/skills/prcheckloop` already does "read the
  failed check, fix, push, loop, escalate a precise blocker after N rounds" — retarget it at
  this fork's `develop` (5.2 already calls for the same retarget) rather than writing a
  second CI-loop skill.
- **Kill switch and cap.** Gated by the same `T3_AGENT_AUTOMATION` variable (5.5), plus a
  per-day merge cap, so a bad day fails loud and small instead of quiet and large.
- **Step 9, concretely.** Extend the Phase 1.3 nightly summary with one more section, sourced
  from the PR's own "What Changed"/"Verification" fields (already required by the PR
  template and `CONTRIBUTING.md`) instead of inventing a new log format:
  ```
  Agent-authored merges since last deploy:
  • #NNN (closes #issue) — <one-line "What Changed">, model: claude-sonnet-5, CI: 2 rounds to green
  ```

**Sequencing.** Not Phase 5 work — it depends on 5.1–5.3 running clean for the one-week
observation period the top of Phase 5 already requires, plus the second-reviewer gate above
landing as its own PR. Treat it as Phase 6 if approved. Do not fold it into 5.2/5.3: those
are deliberately narrower (CI-fix on an existing PR; one failing test's triage) and this is
issue-to-merge from a cold start.

Verification if built: one issue labelled `auto-eligible` goes from open to a merged PR with
zero human commits and zero human PR comments, and the nightly summary names it, inside one
`T3_AGENT_AUTOMATION=on` window; flipping the variable to `off` mid-loop stops it before merge.

Verification: one agent-authored `fix/*` PR merges through the full gate with no human
commit; the weekly metrics message posts; the kill switch stops 5.1–5.6 within one run.

---

## 4. Sequencing, effort, ownership

| Phase | PRs | Who | Effort | Blocks |
|---|---|---|---|---|
| 0 Stop the noise | 1 docs | Owner on kmv8 (0.1, 0.2); agent for 0.3, 0.4 | ~1 h host, ~1 h agent | everything (P1) |
| 1 First green nightly | 1 `fix/`, 1 `ci` | Agent authors; owner reviews `ci` | ~1 day | 2, 5 |
| 2 Gates | 3 `ci` + repo settings | Agent authors; owner sets rulesets, CODEOWNERS, GitHub App | ~2 days | 3 (2.6), 5 |
| 3 hostops | 1 `ci` | Agent authors; owner creates `hostops` environment | ~1 day | 4 |
| 4 First release | 1 release PR + tag | Owner | ~1 h | — |
| 5 Factory loop | 2 `ci` + skill edits | Agent | ~2 days, then a week of observation | — |

Rules that hold throughout, from `CLAUDE.md`: pipeline files in their own `ci`-labelled PR;
agents never tag, never approve environments, never run anything under `deploy/` on kmv8;
Phase 0.1 and 0.2 are the only host commands in this plan and they are the owner's.

---

## 5. Decisions needed from you

| # | Decision | Recommendation | Reversible? |
|---|---|---|---|
| D1 | Retire the Hermes cron now (Phase 0.1) | **Yes, today.** It is the failure you are seeing and a second deployer on the staging port | Yes (re-enable the cron) |
| D2 | Close the 11 pre-fork PRs and 7 stale Dependabot PRs | **Yes.** Dependabot reopens a fresh grouped PR monthly | Yes (reopen) |
| D3 | Add `server-tests` as a required conditional check on PRs (2.1) | **Yes.** ~8–10 min on server PRs, 0 on others; closes the #80/#81 hole | Yes |
| D4 | Build once on GitHub, push to GHCR, deploy by digest (2.5) | **Yes**, as its own contract-change PR | Yes (revert to host build) |
| D5 | Move the repo to a free org for merge queue (2.3) | **Not yet.** "Require up to date" is enough at today's volume; revisit when the steward goes live | Yes, but runner must re-register |
| D6 | Drop `required_linear_history` on `main`, keep merge-commit releases (2.2) | **Yes** | Yes |
| D7 | Create a GitHub App identity for agents (2.6) | **Yes**, before any agent pushes | Yes |
| D8 | Enable Claude review on PRs (5.1) with a monthly cap | **Yes**, advisory only, after Phase 2 | Yes (kill switch) |
| D9 | Release cadence after v0.2.0 | **Weekly tag from `develop` when nightly was green the night before**; a rule, not a schedule | Yes |
| D10 | Build the issue-driven auto-merge loop (§5.6) | **Not yet — needs your explicit scope decision** (eligible-issue label, second-reviewer gate, per-day cap). Steps 1–6, 8–9 can be built now under existing rules; only step 7 (merge) is blocked pending this | Yes (kill switch, or never build it) |

---

## 6. Risks and how the plan bounds them

| Risk | Bound |
|---|---|
| Sharding hides a real ordering bug behind smaller groups | The serialized lane stays serialized within each shard (`--no-file-parallelism --maxWorkers=1`, `run-vitest-stable.mjs:69-72`); shards are file partitions, not concurrency changes |
| The "fixed" flaky tests still flake | The ledger (1.3) makes it visible on night one; 5.3 opens the PR; no quarantine is ever the answer (`CLAUDE.md`) |
| GHCR outage blocks a deploy | `t3-release` keeps the rebuild path as fallback when the digest is absent (§2 diagram) |
| Agent fix loop pushes to the wrong branch | Workflow condition allows `feature/*`, `fix/*`, `chore/*` heads only; CODEOWNERS paths excluded; kill switch |
| GitHub App token leaks | Installation tokens live one hour and are scoped to this repo; no PAT exists to leak |
| Owner locked out by rulesets | Bypass list contains `@tetracilin` (the same posture as `enforce_admins: false` today) |

---

## 7. Definition of done for this plan

- [ ] No legacy nightly email for seven consecutive mornings; `docker ps` on kmv8 shows only
      workflow-built images on `:33130`
- [ ] One fully green `t3-nightly` run, then seven in a row
- [ ] `server-tests` is a required check and has blocked at least one red PR
- [ ] `.github/CODEOWNERS` names real reviewers and code-owner review is required
- [ ] Staging and production run a `ghcr.io/…@sha256:` digest, the same one for a given sha
- [ ] `t3-release` has deployed and rolled back through the pipeline
- [ ] `t3-hostops` exists with the six operations and one human gate
- [ ] An agent-authored `fix/*` PR has merged through the full gate
- [ ] `CLAUDE.md`, `PLAN_CICD.md`, the operator guide and the inventory describe this state

---

## 8. Open questions (not blocking Phase 0 or 1)

1. What does `/root/projects/t3-paperclip-Aitodo`'s dirty state contain, and whose is it?
2. Does `/etc/t3/secrets/prod/` hold all four files? (`hostops secrets:check prod` answers it;
   until then, assume no.)
3. What serves `:8642` on kmv8 (Hermes API for both stacks, inventory "A dependency that is
   not a container here")? A nightly smoke that exercises an agent run will need it.
4. Should `hostops` reuse the `production` reviewer or have its own environment? (Plan: its own.)

---

## 9. Sources

Pipeline state: GitHub Actions API for `tetracilin/test_ai_todo`, runs `35288968354`,
`35201279125`, `35165285609`, `35038014050`, `34912759866`, queried 2026-09-18; PR list and
account type from the same API.

Practice:

- Firecrawl, [How to Build an AI Software Factory: Agents That Open, Review, and Merge PRs](https://www.firecrawl.dev/blog/ai-software-factory)
- Spacelift, [Where Do AI Agents Fit in CI/CD Pipelines?](https://spacelift.io/blog/agentic-cicd)
- Port, [AI Software Factory: What It Is, Why You Need One, Who Owns It](https://www.port.io/blog/ai-software-factory)
- arXiv 2605.08017, [Collaborator or Assistant? How AI Coding Agents Partition Work Across Pull Request Lifecycles](https://arxiv.org/pdf/2605.08017)
- arXiv 2604.18334, [Reliability of AI Bots Footprints in GitHub Actions CI/CD Workflows](https://arxiv.org/pdf/2604.18334)
- BCG Platinion, [The Agentic Software Factory](https://www.bcgplatinion.com/insights/the-agentic-software-factory)
- Augment Code, [What Is a Software Factory? The Agentic Operating Model, Defined](https://www.augmentcode.com/guides/what-is-a-software-factory)
- BuildMVPFast, [AI Agents in CI/CD: Productivity, Risk & Governance (2026)](https://www.buildmvpfast.com/blog/ai-agents-ci-cd-pipeline-devops-automation-2026)
- GitHub Docs, [Managing a merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)
- Tenki, [GitHub Merge Queue in 2026: How It Works & Handling Flaky Required Status Checks](https://tenki.cloud/blog/github-merge-queue-setup)
- Human Who Codes, [Improving developer velocity with GitHub merge queue](https://humanwhocodes.com/blog/2026/04/improving-developer-velocity-github-merge-queue/)
- 7Tech, [A 2026 GitHub Merge Queue Workflow with Rulesets and merge_group CI](https://www.7tech.co.in/github-merge-queue-workflow-rulesets-merge-group-ci/)
- Anthropic, [anthropics/claude-code-action](https://github.com/anthropics/claude-code-action)
- systemprompt.io, [Set Up Claude Code GitHub Actions for PR Review and CI](https://systemprompt.io/guides/claude-code-github-actions)
- Groundy, [Claude Code in GitHub Actions: A Complete Guide to Automated PR Fixes](https://groundy.com/articles/how-to-run-claude-code-as-a-github-actions-agent-for-automated-pr-fixes/)
- The Prompt Shelf, [Claude Code GitHub Actions: Complete CI/CD Integration Guide (2026)](https://thepromptshelf.dev/blog/claude-code-github-actions-cicd-complete-guide-2026/)
