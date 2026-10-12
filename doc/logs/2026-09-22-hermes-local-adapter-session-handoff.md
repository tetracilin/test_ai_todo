# 2026-09-22 Hermes/local-adapter session handoff

Read this before picking the work back up. It covers three linked threads from
2026-09-20 to 2026-09-22: the onboarding-adapter bug, the Hermes Gateway
network path on kvm8, and the `hermes_local` (in-image Hermes CLI)
architecture. Written so a fresh session — human or agent — does not have to
re-derive any of it.

## Where things stand right now

- **`develop` has everything merged.** Nothing is stuck in review.
- **Nothing has deployed yet.** All of it lands on staging at the next
  `t3-nightly` run (22:00 UTC daily). A one-shot cron check was scheduled for
  ~06:07 local (≈23:00 UTC, an hour after trigger) to read the deploy and
  `slow-tests` jobs separately and report back — see "Scheduled follow-up"
  below. **That cron job is session-only** (in-memory on the Claude session
  that created it, not on disk) — if that session ended, the check did not
  fire and #125 needs doing manually.
- **hermes_gateway (remote HTTP)** was connected once, by hand, from a
  Paperclip agent on nightly to the Hermes gateway on kvm8 — see "Hermes
  Gateway network path" below for the working config. It is not part of any
  default; nothing here depends on it.
- **hermes_local (in-image CLI)** is the path now wired into the default
  adapter set and the production image. It has not been exercised end to end
  (no real `hermes chat` run inside a deployed container yet) — that is #124.

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

Source: `docs/qa/2026-09-20-new-user-onboarding-report.md` (the QA run that
found the onboarding bug and the routine-sweep bug) and this session's own
work (#122 investigation → #135–#140).

## Open issues from this work

| # | Labels | What it needs |
|---|---|---|
| #117 | bug | Umbrella issue for the original onboarding-adapter bug. Superseded by the merged PRs; close once #125 confirms it live. |
| #122 | qa | Verify `hermes_gateway` end to end with a real gateway. Partially done by hand this session — see below. Needs the actual agent-run leg (steps 6–8) repeated and written up. |
| #123 | qa | Verify a Claude Code agent run on a **non-Windows** host — every run on this Windows dev box fails (`acpx` spawn issue, see #129). |
| #124 | qa | `hermes_local` has never produced a real model reply. `hermes_local`'s test-suite run used a placeholder key; the OpenRouter test earlier used a key with insufficient credits. |
| #125 | qa | **Check tonight's `t3-nightly`.** This is the follow-up cron job below. If it didn't fire, do it manually: `gh run list --workflow=t3-nightly.yml`, read both jobs, confirm deployed sha, confirm `GET http://100.103.41.112:33130/api/adapters` lists `hermes_local` as `selectable: true`. |
| #126 | bug, decision | First real user on an authenticated instance gets "No company access" — needs an owner decision on the bootstrap path. |
| #127 | bug, decision | Scheduling routines have no timezone control (default UTC) — owner decision on per-routine/company/user. |
| #128 | enhancement, decision | Reviewer approval needs a comment (422 otherwise) and there's no Approve button — owner decision on UX. |
| #129 | bug, decision | `claude_local` (and by extension any ACP-engine adapter) fails to spawn on Windows (`claude-agent-acp.cmd`) — third-party `acpx` bug, needs a pin/patch decision. |
| #130 | enhancement, qa | `hermes_gateway` is hidden from every visual adapter picker (`hideFromVisualSelection: true`) by design, but there's no in-UI path to configure it — judge whether an operator can find it unaided. |
| #131 | qa | Full real-browser (not headless-only) fresh-account pass on current `develop`. |
| #132 | bug, qa | Dossier/document comments — owner's original acceptance test flags these as broken; not re-verified since. |
| #133 | decision | Triage the older, unrelated open PRs #106–#113 (mostly `ci` labelled, need human review). |
| #134 | — | User-filed, independent report of the same onboarding symptom as #117. Commented with the fix PR list; not closed until #125 confirms live. |
| #138 | bug | Flaky UI test `MarkdownEditor.test.tsx` ("applies async..."), unrelated to this work, seen once in PR #136's CI, passed on re-run. |

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
see the new policy in `doc/ORIGIN.md` §"Feature-driven upstream import")
ships two Hermes adapters:

- `hermes_local` — runs the `hermes` CLI as a **child process on the
  Paperclip host**. This is what got built out this session.
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
(`/paperclip/.hermes` in the container, on the persistent volume).

**Version note:** kvm8's standalone gateway runs `hermes-agent==0.21.0`,
installed from a GitHub tag (not on PyPI). PyPI tops out at `0.19.0`. The
image installs `0.19.0`, pinned via the `HERMES_AGENT_VERSION` Dockerfile
arg specifically so it can be bumped later without guessing. Not yet
verified: whether 0.19 behaves identically to 0.21 for the flags/output
format `hermes_local`'s adapter code parses (`--source tool --yolo`,
session-id-from-stdout, `--resume`).

**Still open, not started:**
- **Credential handoff skill** — upstream ships a `paperclip-task-bridge`
  Hermes skill so Hermes can create/comment on Paperclip tasks using a
  claimed Paperclip agent key (invite → approve → claim-key flow in
  `docs/deploy/agent-adapters.md`'s upstream-derived section). Not wired up
  here yet.
- **A real end-to-end run** (#124): create a `hermes_local` agent on a
  deployed instance, give it a real provider key as a Paperclip secret,
  @mention it, confirm a real reply.

## Scheduled follow-up

A one-shot cron job (id `9f284032`, fired via `CronCreate`) was scheduled
for `7 6 23 9 *` (06:07 local / UTC+7 on 2026-09-23, ~1h after the 22:00 UTC
nightly trigger) to check `t3-nightly`'s deploy and `slow-tests` jobs, the
deployed sha, and whether `hermes_local` shows up as `selectable` via
`GET /api/adapters` on staging. **This job is session-scoped** (lives in
the Claude session's memory, not on disk) — if that session had already
ended by fire time, nothing ran and this is still open work, tracked as
#125.

## Reading order for a fresh session

1. This file.
2. `docs/qa/2026-09-20-new-user-onboarding-report.md` — the QA run that
   started all of this.
3. `docs/deploy/agent-adapters.md` — adapter prerequisites, the Hermes
   Gateway HTTPS/tailscale guide, and the new `hermes_local` section.
4. `doc/ORIGIN.md` §"Feature-driven upstream import" — the policy that let
   this session read upstream's Hermes design.
5. `gh issue list --state open` filtered to labels `qa`/`decision` for the
   punch list above.
