# 2026-09-22/23 Hermes/local-adapter session handoff

Read this before picking the work back up. It covers three linked threads from
2026-09-20 to 2026-09-23: the onboarding-adapter bug, the Hermes Gateway
network path on kvm8, and the `hermes_local` (in-image Hermes CLI)
architecture — plus the first live nightly confirmation. Written so a fresh
session — human or agent — does not have to re-derive any of it.

## Where things stand right now (updated 2026-09-23)

- **`develop` has everything merged, through #142.** Nothing from this work
  is stuck in review.
- **It has deployed, and is confirmed live.** `t3-nightly` run `35800182658`
  (triggered 2026-09-23 00:01 UTC — the schedule is written as "22:00 UTC"
  but actually fires just after midnight UTC) deployed commit `1695a4d3`
  (the #142 merge, so everything through #142 is on staging). `deploy` and
  `e2e` jobs were green. See "2026-09-23 nightly check" below for the full
  result, including a live, non-UI confirmation that `hermes_local` and the
  `hermes` CLI actually work inside the deployed container.
- **The scheduled cron check (id `9f284032`) never fired** — the session
  that created it wasn't asked to continue in the background, and this
  check ended up done by hand instead, at the user's direct request, the
  next morning. Don't assume a `CronCreate` job scheduled hours out will
  fire; it needs the same session alive at fire time. #125 is effectively
  done now (see below) but is left open pending one more thing: a real
  UI walkthrough (see #134's status).
- **hermes_gateway (remote HTTP)** was connected once, by hand, from a
  Paperclip agent on nightly to the Hermes gateway on kvm8 — see "Hermes
  Gateway network path" below for the working config. It is not part of any
  default; nothing here depends on it.
- **hermes_local (in-image CLI)** is the path wired into the default
  adapter set and the production image, and is now confirmed present and
  working in the deployed nightly container. It has **not** been exercised
  end to end with a real model call yet (no real `hermes chat` run with a
  live provider key) — that is still #124.

## Merged PRs, in order

| PR | What | Commit |
|---|---|---|
| #118 | Server default selectable adapters → `hermes_gateway,claude_local` | `065d768e` |
| #119 | UI adapter pickers filter by the server's `selectable` flag instead of a static rule | `9ced60e9` |
| #120 | Onboarding wizard no longer restarts at step 1 after "Confirm mission" | `cf7a8383` |
| #121 | Scheduling routines generate their task on a 5-minute timer, not only on manual "Run" | `6671bd62` |
| #135 | Policy: agents may read/download upstream `paperclipai/paperclip` code when a feature needs it (read-only, no remote, provenance in the PR body) | `325b852d` |
| #136 | `hermes_local` adapter checks (model detection, API-key check, skills scan) honor a configured `HERMES_HOME` instead of always reading `~/.hermes` | `c450b28f` |
| #137 | Production `Dockerfile` installs `hermes-agent==0.19.0` (pinned, PyPI, via `uv`/Python 3.11) and sets `HERMES_HOME=/paperclip/.hermes` | `8d3b5591` |
| #139 | Deploy default (`compose.yaml`, `t3-nightly.yml`, `t3-release.yml`) widened to `hermes_gateway,claude_local,hermes_local` | `5be8c2b0` |
| #140 | Server code default matches the deploy default (`hermes_gateway,claude_local,hermes_local`) | `cdf1cb61` |
| #141 | Adds the first version of this handoff doc | `ce249d1f` |
| #142 | Documents the issue-driven auto-merge loop as a proposal in `CICD/PLAN_AI_FACTORY.md` §5.6, decision **D10** (not built, not decided) | `1695a4d3` |

Source: `docs/qa/2026-09-20-new-user-onboarding-report.md` (the QA run that
found the onboarding bug and the routine-sweep bug) and this session's own
work (#122 investigation → #135–#142, then the 2026-09-23 nightly check).

## 2026-09-23 nightly check — what was verified live, and how

Done read-only, on explicit request, without triggering any deploy or merge.

**Run checked:** `35800182658` (`gh run list --workflow=t3-nightly.yml`).
Read job-by-job, not the overall run color, per this repo's own rule
(a red run can still mean a green deploy):

| Job | Result |
|---|---|
| `build-and-deploy-nightly` | ✅ green |
| `e2e` | ✅ green |
| `slow-tests` | ❌ red — see below, unrelated to this work |

**Deployed commit**, from `GET http://100.103.41.112:33130/api/health`:
`commit: 1695a4d3...` — matches the #142 merge exactly.

**`slow-tests` failure, filed as #143:**
`server/src/__tests__/server-startup-feedback-export.test.ts` failed with
`No "heartbeatRuns" export is defined on the "@paperclipai/db" mock`
(`src/services/successful-run-handoff-state.ts:11` via `src/services/issues.ts:74`).
408 of 410 server test files passed; this was the only failure, and it's
unrelated to anything in #136–#142.

**`adapter-registry.test.ts` and `scheduling-service.test.ts`:** confirmed
passing in the nightly log (18/18 and 12/12 tests). **`adapter-routes.test.ts`
could not be confirmed** — it does not appear anywhere in the job's log
(10MB, searched for the file name and for a specific test string added in
#139/#140), and it isn't the failing file either. Most likely just not
printed as an individual reporter line, but this wasn't verified — worth a
follow-up if certainty matters.

**Authenticated check (`GET /api/adapters`) was blocked:** nightly runs in
`PAPERCLIP_DEPLOYMENT_MODE=authenticated` (same posture as production), and
`GET /api/adapters` returned `403 Board access required`. **The seeded
tester's password is not retrievable** — `SEED_TESTER_PASSWORD` lives only
as a GitHub Environment secret on `staging` (`deploy/scripts/seed-staging-tester.sh`),
which is write-only; no tool here can read a secret's value. No login was
attempted, and none should be guessed.

**Live confirmation used instead — no credentials needed, more direct than
the API would have been:** SSH to kvm8 (`ssh kmv8`, alias for the `ghrunner`
user) and inspect the running container directly:

```sh
docker exec t3-nightly-paperclip-1 printenv PAPERCLIP_SELECTABLE_ADAPTER_TYPES
# → hermes_gateway,claude_local,hermes_local
docker exec t3-nightly-paperclip-1 hermes --version
# → Hermes Agent v0.19.0 (2026.7.20), Python 3.11.16, install method pip
docker exec t3-nightly-paperclip-1 printenv HERMES_HOME
# → /paperclip/.hermes
```

This is the pattern to reuse for "is X actually live" questions when there's
no board session available: read the container's real environment and
binaries over SSH rather than trying to authenticate through the API. It
proves more than a `selectable: true` API response would (that the CLI
binary is actually installed and runs), for less effort.

**Not yet done:** an actual UI walkthrough (create company → see the
adapter picker → pick Hermes/Claude) on nightly. Everything above proves
the server side is correct; it doesn't prove the UI experience end to end.
That's what would let #125 and #134 actually close.

## Open issues from this work

| # | Labels | What it needs |
|---|---|---|
| #117 | bug | Umbrella issue for the original onboarding-adapter bug. Superseded by the merged PRs; close once a real UI pass (below) confirms it. |
| #122 | qa | Verify `hermes_gateway` end to end with a real gateway. Partially done by hand this session — see "Hermes Gateway network path" below. Needs the actual agent-run leg (steps 6–8) repeated and written up. |
| #123 | qa | Verify a Claude Code agent run on a **non-Windows** host — every run on this Windows dev box fails (`acpx` spawn issue, see #129). |
| #124 | qa | `hermes_local` has never produced a real model reply. The CLI is confirmed installed and running (2026-09-23 check above); a real provider key as a Paperclip secret, plus an @mention, is still needed. |
| #125 | qa | Check `t3-nightly` after the adapter/wizard/routine merges. **Done by hand 2026-09-23** (deploy green, commit confirmed, `hermes_local` live) — leave open until a UI pass also confirms it, then close together with #134. |
| #126 | bug, decision | First real user on an authenticated instance gets "No company access" — needs an owner decision on the bootstrap path. |
| #127 | bug, decision | Scheduling routines have no timezone control (default UTC) — owner decision on per-routine/company/user. |
| #128 | enhancement, decision | Reviewer approval needs a comment (422 otherwise) and there's no Approve button — owner decision on UX. |
| #129 | bug, decision | `claude_local` (and by extension any ACP-engine adapter) fails to spawn on Windows (`claude-agent-acp.cmd`) — third-party `acpx` bug, needs a pin/patch decision. |
| #130 | enhancement, qa | `hermes_gateway` is hidden from every visual adapter picker (`hideFromVisualSelection: true`) by design, but there's no in-UI path to configure it — judge whether an operator can find it unaided. |
| #131 | qa | Full real-browser (not headless-only) fresh-account pass on current `develop`. |
| #132 | bug, qa | Dossier/document comments — owner's original acceptance test flags these as broken; not re-verified since. |
| #133 | decision | Triage the older, unrelated open PRs #106–#113 (mostly `ci` labelled, need human review). |
| #134 | — | User-filed, independent report of the same onboarding symptom as #117. Commented twice with the fix and, 2026-09-23, live confirmation via SSH; still open pending a real UI pass — see #125. |
| #138 | bug | Flaky UI test `MarkdownEditor.test.tsx` ("applies async..."), unrelated to this work, seen once in PR #136's CI, passed on re-run. |
| #143 | bug | `server-startup-feedback-export.test.ts` fails on a missing `heartbeatRuns` export in a `@paperclipai/db` mock — found in the 2026-09-23 nightly run, unrelated to #136–#142. |

## Hermes Gateway network path (kvm8) — what actually works

Found by trial while trying to connect an agent to the gateway over HTTPS.
None of this is checked into compose or workflows; it's operational
knowledge about the host.

- The Hermes API server on kvm8 binds **loopback only**, `127.0.0.1:8642`,
  and refuses to start without a 16+ char `API_SERVER_KEY`.
- **Port 8443 is taken** by a Caddy container that owns `0.0.0.0:8443` /
  `:443` (Teable's web app). A `tailscale serve --https=8443 ...` on that
  port gets shadowed and returns 404.
- **Ports 8444–8447 were already in use** by other `tailscale serve` entries
  on the same host (WOPI staging, another Hermes relay, unlabeled). **8448
  is the first free port** as of this session — re-check `tailscale serve
  status` before reusing it, another team member may have taken it since.
- Working command, on kvm8 as root: `tailscale serve --bg --https=8448
  http://127.0.0.1:8642`. Reachable at
  `https://hostinger-kvm8-host.tail9831b.ts.net:8448`.
- **`ufw` is active** on kvm8, default-deny incoming, and this blocks
  container-to-tailnet traffic by default (`docker exec` into a Paperclip
  container timed out reaching the tailnet address, even though the host
  itself reached it in under 2ms). The working rule, following the same
  per-Docker-network style already used for the prod Hermes bridge:
  `ufw allow from 172.16.19.0/24 to 100.103.41.112 port 8448 proto tcp
  comment 'nightly Paperclip -> Hermes gateway (tailscale serve)'`
  (`172.16.19.0/24` is `t3-nightly_gateway`; use `172.16.10.0/24` for
  `t3-prod_gateway` if/when needed there — add it deliberately, not by
  widening this rule).
- A green **Test now** in the agent config only proves `/health` answers —
  that endpoint needs no key. The real key is only checked on `/v1/models`,
  `/v1/runs`, etc. Getting a 401 there after a green Test now means the key
  in Paperclip's `apiKey` field doesn't match the gateway's live
  `API_SERVER_KEY` (check both the `.env` file and the running process's
  actual environment — they can differ).
- **This whole path is superseded by `hermes_local` for our actual use
  case.** The user's direction (this session) is: run the Hermes CLI on the
  Paperclip host/container, not call a remote gateway over HTTP. The
  firewall rule and the `hermes_gateway` test agent created during this
  investigation can stay (harmless) or be torn down — nobody's plan depends
  on them now.

## `hermes_local` architecture — the decision and why

Upstream (`paperclipai/paperclip`, read via `gh api`, not cloned/merged —
see the policy in `doc/ORIGIN.md` §"Feature-driven upstream import")
ships two Hermes adapters:

- `hermes_local` — runs the `hermes` CLI as a **child process on the
  Paperclip host**. This is what got built out this session, and is now
  confirmed live on nightly (see above).
- `hermes_gateway` — calls an **already-running** Hermes API server over
  HTTP/SSE. This is the kvm8 path above.

**Key fact that shaped the design:** Hermes has **no "attach to a running
gateway" mode**. The CLI and the gateway are separate programs that only
share state by pointing at the same `HERMES_HOME` directory
(`config.yaml`, `.env`, `skills/`, `state.db`). There is no RPC between
them. So "the CLI joins the gateway" means a shared home directory, not a
client/server call — and sharing kvm8's live gateway home (`/root/.hermes`)
was rejected: it's root-owned, holds the gateway's own messaging tokens,
and two processes writing one SQLite `state.db` is a real risk. Each
Paperclip-run agent gets its own `HERMES_HOME` instead
(`/paperclip/.hermes` in the container, on the persistent volume —
confirmed set on the live nightly container).

**Version note:** kvm8's standalone gateway runs `hermes-agent==0.21.0`,
installed from a GitHub tag (not on PyPI). PyPI tops out at `0.19.0`. The
image installs `0.19.0` (confirmed running live), pinned via the
`HERMES_AGENT_VERSION` Dockerfile arg specifically so it can be bumped
later without guessing. Not yet verified: whether 0.19 behaves identically
to 0.21 for the flags/output format `hermes_local`'s adapter code parses
(`--source tool --yolo`, session-id-from-stdout, `--resume`).

**Still open, not started:**
- **Credential handoff skill** — upstream ships a `paperclip-task-bridge`
  Hermes skill so Hermes can create/comment on Paperclip tasks using a
  claimed Paperclip agent key (invite → approve → claim-key flow in
  `docs/deploy/agent-adapters.md`'s upstream-derived section). Not wired up
  here yet.
- **A real end-to-end run** (#124): create a `hermes_local` agent on a
  deployed instance, give it a real provider key as a Paperclip secret,
  @mention it, confirm a real reply.
- **A real UI walkthrough** (#125/#134): create a company, see the adapter
  picker offer Claude Code and Hermes, pick one, confirm no 422. Needs a
  board session — either the seeded tester's actual password (ask the
  owner directly; it isn't recoverable from any tool available here) or a
  fresh bootstrap on a scratch instance.

## Reading order for a fresh session

1. This file.
2. `docs/qa/2026-09-20-new-user-onboarding-report.md` — the QA run that
   started all of this.
3. `docs/deploy/agent-adapters.md` — adapter prerequisites, the Hermes
   Gateway HTTPS/tailscale guide, and the `hermes_local` section.
4. `doc/ORIGIN.md` §"Feature-driven upstream import" — the policy that let
   this session read upstream's Hermes design.
5. `CICD/PLAN_AI_FACTORY.md` §5.6 and decision **D10** — the drafted,
   undecided proposal for an issue-driven auto-merge loop (#142), in case
   that's what a fresh session is meant to pick up next.
6. `gh issue list --state open` filtered to labels `qa`/`decision` for the
   punch list above, plus #143 for the newly found flake.
