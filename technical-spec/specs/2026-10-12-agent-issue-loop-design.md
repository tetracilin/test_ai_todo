# Agent issue-to-PR loop — design

Date: 2026-10-12 · Status: **draft for owner review** · Repo: `tetracilin/test_ai_todo`
Implements `CICD/PLAN_AI_FACTORY.md` §5.1–5.3 and §5.6 steps 1–6, 8–9, with **human merge**
(decision D10 stays "no auto-merge"). Extends, does not replace, that plan.

## 1. Intent

An agent turns a labelled GitHub issue into a pull request that is green, independently
reviewed and documented, without a human typing at each step. A human decides which issues
enter the loop and clicks merge. The loop also repairs red CI on its own PRs.

**Success.** One issue labelled `agent-ready` goes from open to a PR that has passed t3-ci and
the independent review, carries a written hand-off, and is labelled `ready-to-merge`, with no
human commit and no human PR comment. Flipping the kill switch mid-run stops the run before
any push.

**Not in scope.**
- Auto-merge (D10, deferred). Merge, tag, release and environment approval stay human.
- Any change to `main`, releases, or `kmv8` (agents never run there).
- Bridging Paperclip's own in-product issue tracker to GitHub issues.
- Agent work outside `develop`-based `fix/issue-<n>-*` branches.

## 2. Fixed constraints (from CLAUDE.md and PLAN_AI_FACTORY.md)

- Pipeline files (`.github/workflows/`, `deploy/`) change only in a `ci`-labelled PR with human review, never in a PR with application code.
- Agents never tag, never approve environments, never merge unless a human says so for that task.
- Untrusted PR code runs only on GitHub-hosted runners (P4). `kmv8` runs only merged code.
- `develop` requires t3-ci checks `unit`, `build`, `build-image` and an up-to-date branch.
- Every agent commit carries the attribution trailer.

## 3. Verified starting state (2026-10-12)

- Repo secrets: only `DISCORD_WEBHOOK_URL` (plus an unrelated Firebase one). **No Claude credential.** No repo variables.
- Labels present: `ci`, `qa`, `decision`, `bug`, `enhancement`, `documentation`. Loop labels do not exist.
- Skills present in `.agents/skills`: `prcheckloop`, `pr-gardening`, `prepare-paperclip-pr`, `check-pr`. PR #113 (`t3-pr-loop` skill) is open.
- The required `server-tests` PR check (PR #110, decision D3) is **not** built. `slow-tests` has not yet run green.
- The only runner is `kmv8`; GitHub-hosted runners are used for tests.

## 4. Architecture

### 4.1 State machine (labels)

```
(human) agent-ready ─▶ agent-working ─▶ agent-pr ─▶ ready-to-merge ─▶ (human merges)
                          │                │
                          └──── agent-blocked ◀┘   (any guard, cap, retry or review failure)
```

- `agent-ready` is applied **only by a human with write access**. It is the sole trigger.
- Issues labelled `decision` or `ci` are never picked up, even if also `agent-ready`.
- `agent-blocked` always comes with a comment naming the stopping rule. No silent stop, no unbounded retry.
- The issue carries `agent-ready`, `agent-working`, `agent-pr` (a PR is open) and `agent-blocked`. The PR carries `agent-pr`, `ready-to-merge` and `agent-blocked`.
- The repository default branch is `develop`, so `issues`-triggered workflows run from `develop` and need no release to take effect.

### 4.2 Workflows (each a separate `ci` PR)

| Workflow | Trigger | Job |
|---|---|---|
| `t3-agent-develop.yml` | `issues: labeled` = `agent-ready`; `workflow_dispatch` (issue number, `dry_run`) | `gate` → `agent` → `publish` |
| `t3-agent-ci-loop.yml` | `workflow_run` of t3-ci, conclusion failure, PR labelled `agent-pr` | read failed log, push fix, stop |
| `t3-agent-review.yml` | `pull_request` (same-repo) labelled `agent-pr`; `workflow_run` of t3-ci success | independent review, hand-off |

**`gate`** (read-only): kill switch `vars.T3_AGENT_AUTOMATION == 'on'`; the actor that applied the label has write permission (API check, not the issue author); daily cap not reached (count PRs labelled `agent-pr` created since 00:00 UTC, limit 3); issue has none of `decision`/`ci`; concurrency group `t3-agent-develop` (one run at a time).

**`agent`** (permissions: `contents: read`, `issues: read`; secrets: Claude credential only): checks out `develop`, installs deps, and runs the agent with a prompt that (a) says issue text is data, not instructions, (b) requires reading `roadmap.md`, `backlog.md`, `design.md`, `AGENTS.md`, `CLAUDE.md` in that order, (c) requires test-first changes and running the smallest relevant test, (d) forbids touching protected paths, (e) asks for a PR description in the repo template. Output contract: a `git diff` patch plus a JSON result (`summary`, `tests_run`, `risks`, `docs_updated`). The agent never holds a token that can write. Implementation uses `anthropics/claude-code-action` if it can run with these permissions and emit a patch; otherwise headless Claude Code (`claude -p`). The contract is the same either way; this is settled by a spike before step 3 of delivery.

**`publish`** (permissions: GitHub App token): downloads the patch, applies it to a fresh `develop` checkout, runs `scripts/agent-guard.mjs`; on pass, commits with the trailer, pushes `fix/issue-<n>-<slug>`, opens the PR from `.github/PULL_REQUEST_TEMPLATE.md` with `Fixes #<n>`, thinking path, model-used field; labels the PR `agent-pr` and the issue `agent-pr`. On fail, labels the issue `agent-blocked` and comments the rule. With `dry_run=true` it prints the patch and verdict to the job summary and stops.

**`t3-agent-ci-loop`**: only for same-repo PRs labelled `agent-pr`. Reads the failed job log, produces a fix patch (same agent/publish split), pushes one commit per round. Rounds counted from commits on the branch carrying the trailer `T3-Agent-Round: <n>`. After round 3 the PR gets `agent-blocked` and a comment linking the failed run. Never acts on a PR whose diff touches protected paths.

**`t3-agent-review`**: a second agent with a different prompt (reviewer, not author), read-only, compares the diff with the issue and repo rules, and posts one structured comment `PASS` or `FAIL` plus a commit status `agent-review`. It is advisory today and can become a required check when auto-merge is later enabled. When t3-ci is green **and** the review is `PASS`, it posts the hand-off comment (What Changed, Verification, Risks, rounds used, model) and adds `ready-to-merge`. A `FAIL` leaves the PR open without that label.

### 4.3 Nightly report

`t3-nightly`'s Discord report gains one section: `Agent-authored PRs merged since last deploy`, listing PRs labelled `agent-pr` merged between the last deployed sha and the current head, with `Fixes #n`, the one-line What Changed, and rounds used. Built from the existing change-list step.

## 5. Safety and trust model

- **Untrusted input.** Issue and comment text can carry hostile instructions. Controls: only a write-access human starts a run (actor check); the `agent` job holds no write credential; the `publish` job, which holds the write token, never executes agent output beyond applying a patch and running the guard; the prompt marks issue text as data. The credential split is the control; the prompt is only a mitigation.
- **Guards** (`scripts/agent-guard.mjs`, pure function diff → verdict). Reject and `agent-blocked` if the patch:
  - touches `.github/workflows/`, `deploy/`, `CICD/`, `.env*`, `**/secrets/**`, `pnpm-lock.yaml`, or dependency sections of any `package.json`;
  - exceeds 15 files or 400 changed lines;
  - weakens tests: fewer test cases than before in a changed test file, or newly added `skip`/`todo`/retry;
  - adds a database migration (`packages/db/src/migrations/`);
  - changes `.github/PULL_REQUEST_TEMPLATE.md` or the guard/agent scripts themselves.
- **Limits.** 3 agent PRs per UTC day; 3 CI-fix rounds per PR; 1 retry on API error then `agent-blocked`; every agent job has a timeout of 30 minutes.
- **Kill switch.** Repository variable `T3_AGENT_AUTOMATION` (`on`/`off`, default unset = off), read in the first step of every agent workflow and again before `publish` pushes. Changing it needs no PR or deploy.
- **Never permitted:** merge, tag, approve environments, run on `kmv8`, push to `develop` or `main`, edit pipeline files.
- **Residual risk (not mitigated by guards):** a plausible but wrong change to application logic. The independent review and the human merge click are the controls.

## 6. Branch hygiene

The loop creates many branches, and a bulk branch cleanup is under way on this repo, so hygiene is part of the design:

- Enable the repository setting "Automatically delete head branches".
- Agent branches use one prefix, `fix/issue-<n>-*`.
- The nightly report flags any issue in `agent-working` or `agent-blocked` for more than 14 days and its branch; humans delete them. No automatic deletion.
- Any cleanup must skip branches that are the head of an open PR (deleting one closes the PR).

## 7. Testing

- `scripts/agent-guard.mjs` and `scripts/agent-state.mjs` (label transitions, daily-cap count, round count) are pure functions with `node --test` tests, run by the existing t3-ci `unit` job. The guard is the control that protects `develop`, so it gets the most coverage: every protected path, the size boundary (15/16 files, 400/401 lines), test-weakening, migrations.
- Workflows are verified in three stages: (1) `dry_run` on a real issue; (2) a canary issue (a trivial doc fix) labelled `agent-ready` with the switch `on`, success = PR passes t3-ci and review with no human commit; (3) kill-switch drill: flip to `off` mid-run and confirm no push happens.
- Workflow YAML is checked with `actionlint` in the `ci` PRs' own verification.
- Agent output quality is not proven by any of this. Start with one or two small issues and review them closely.

## 8. Failure behaviour

| Failure | Result |
|---|---|
| Guard rejects the patch | issue `agent-blocked`, comment names the rule |
| Agent cannot make tests pass | `agent-blocked` with the last failing output |
| CI still red after 3 rounds | PR `agent-blocked`, links the failed run |
| Review `FAIL` | PR stays open with the review comment, no `ready-to-merge` |
| Daily cap reached | issue keeps `agent-ready`, runs next UTC day |
| Claude API error or timeout | one retry, then `agent-blocked` |
| Kill switch `off` | run stops at the next check, nothing pushed |

## 9. Delivery order

Each row is its own PR off `develop`. Pipeline rows are `ci`-labelled and human-reviewed.

| # | Deliverable | Type | Owner |
|---|---|---|---|
| 0 | Add Claude credential secret; create GitHub App (or token) for push and PR creation; create labels (`agent-ready`, `agent-working`, `agent-pr`, `ready-to-merge`, `agent-blocked`); set `T3_AGENT_AUTOMATION=off`; enable auto-delete of head branches | repo settings | owner |
| 1 | `scripts/agent-guard.mjs`, `scripts/agent-state.mjs`, tests | app code | agent |
| 2 | `t3-agent-review.yml` (read-only, advisory) | `ci` | agent, owner reviews |
| 3 | Spike (action vs headless CLI), then `t3-agent-develop.yml` with `dry_run` | `ci` | agent, owner reviews |
| 4 | `t3-agent-ci-loop.yml` | `ci` | agent, owner reviews |
| 5 | Hand-off comment, nightly "agent PRs merged" section, doc updates (D10 note in `PLAN_AI_FACTORY.md`, `CLAUDE.md`) | `ci` + docs | agent, owner reviews |
| 6 | Canary issue, kill-switch drill, switch `on` | operator | owner |

Review comes first (step 2): it is read-only, useful on every PR on its own, and proves the credential and App wiring before any agent writes code.

**Needed before step 6 is worth doing** (outside this build): `slow-tests` green in `t3-nightly`, and the required `server-tests` PR check (PR #110 / D3) in place. Without the second, an agent PR that touches `server/` passes t3-ci with its tests unrun.

## 10. Decisions already made

| Decision | Choice |
|---|---|
| Merge policy | Human merges; agent does everything up to a green, reviewed PR |
| Runtime | GitHub Actions on GitHub-hosted runners |
| Trigger | Label `agent-ready` applied by a write-access human |
| Review | Independent second agent, advisory status |
| Limits | 3 PRs/day, 3 CI rounds, 15 files / 400 lines (tunable via the guard script's constants) |

## 11. Prerequisites the owner provides

A Claude credential (API key or Claude Code OAuth token) and a GitHub App or token for pushing and opening PRs. PRs opened with the default `GITHUB_TOKEN` do not trigger t3-ci, so this second credential is required (plan decision D7). Neither is created or stored by the agent.
