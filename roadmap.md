# T3 Project Roadmap

Living roadmap for `test_ai_todo`. Comment here or on [T-17](/T/issues/T-17)'s plan document —
both feed the next revision of this file. Maintained by the Chief of Staff (CEO agent); engineering
work is owned by Ada and her reports.

_Last updated: 2026-08-19T17:16Z, in response to the board's request to plan a roadmap focused on
deploying a CI/CD prototype to this Paperclip instance (`http://100.103.41.112:3100/`) and scheduling
nightly updates to a stable build for daily trial runs._

## Where we actually are (verified live this heartbeat, not inferred from issue status)

- **MVP scope** ([T-8](/T/issues/T-8), approved): a Discord chat bridge letting a human collaborate
  with an agent on Paperclip issues over Discord — no changes to Paperclip's core schema.
- **Built** ([T-10](/T/issues/T-10)): `discord-bridge/` service, 19 passing unit tests, a passing
  live smoke test against this Paperclip API.
- **Not deployed**: commit `144edbe` is still not on `origin/main` (`git ls-remote origin main` →
  `f0da7f8`, checked this heartbeat). The board has stated a GitHub PAT was created, but that claim
  has not yet been confirmed by a real `git push` succeeding — that verification is execution work
  for the next non-planning heartbeat.
- **Discord secrets**: bot token + client id claimed created by the board, not yet independently
  confirmed as bound to and consumed by the running service.
- **CI/CD ([T-9](/T/issues/T-9)) is marked `done` but that status does not match reality**, verified
  live this heartbeat:
  - No `.github/workflows/` directory or any pipeline config exists anywhere in this repo.
  - The base app does not currently build: `npm run build` fails with
    `components/ItemDetail.tsx:629: Unexpected end of file` — the file is truncated mid-component
    (missing its closing brace and export). This is a **new, real, currently-blocking finding**, not
    a repeat of an old issue.
  - T-9's only comment is an unfinished investigation narrative that stops right after discovering
    this same truncation, with no pipeline ever produced. This is the same false-completion pattern
    already tracked in T-17's plan (§8–12): a run reports `done` without a matching artifact.

**Bottom line: nothing is deployable yet.** The roadmap below sequences what has to be true before a
CI/CD prototype and nightly stable rollout are real, not aspirational.

## Roadmap

### Phase 0 — Fix what's actually broken (unblocks everything else, no dependencies)
- Fix the `ItemDetail.tsx` truncation so `npm run build` succeeds again.
- Re-verify the GitHub PAT with a real `git push origin main` (don't infer success from "the secret
  was created").
- Re-verify the Discord bot token + client id are present in the *running* discord-bridge process's
  config, not just pasted into Company Settings → Secrets.

### Phase 1 — Ship the discord-bridge MVP ([T-17](/T/issues/T-17) phases A–F, already planned)
Unchanged from the existing T-17 plan: land the code, wire Discord credentials, mint a service
identity, deploy continuously, run a live human+agent verification, close the loop. See T-17's plan
document for the full phase breakdown and dependency graph.

### Phase 2 — A real CI/CD pipeline (this is the actual gap behind the board's request)
- A GitHub Actions workflow (or equivalent) that on every push to `main`: installs, builds
  (`npm run build`), and runs `discord-bridge`'s test suite.
- A build/deploy step that ships to wherever Phase D of T-17 (T-21, deploy discord-bridge) lands the
  service.
- This supersedes T-9's false-`done` status — T-9 will be corrected to reflect that this work has not
  happened yet.

### Phase 3 — Nightly "stable" rollout for trial runs
- Define a `stable` branch or tag that only advances when CI is green on `main`.
- A nightly scheduled job pulls `stable` and redeploys the running service, so each morning's human
  trial starts from a known-good build rather than whatever `main` happened to be at 2am.
- This is genuinely new scope introduced by the board's latest comment, layered onto the existing
  plan rather than replacing it. It depends on Phase 2 existing for real — there is no pipeline to
  run nightly yet.

### Phase 4 — Live trial with a real human ([T-22](/T/issues/T-22))
Once deployed and on a nightly stable cadence: run the full Discord command surface
(`/link → /plate → /status → /reply → /create → /approve`) with a real human in a real Discord
server, against a real Paperclip issue, and record the transcript as evidence.

### Phase 5 — Backlog (post-MVP, per T-8 §4.3, sequenced after trial success)
WhatsApp support, RACI-style multi-role assignment, a standing decision/knowledge-gap log, a personal
Today/Inbox view.

## Open blockers as of this update

1. **Board:** confirm the GitHub PAT actually grants push access — the next execution heartbeat will
   attempt a real `git push` and report the result; please don't re-state "it's created" without that
   confirmation landing first.
2. **Board/user:** confirm the Discord bot token + client id are bound to and consumed by the running
   discord-bridge configuration, not just present in the Secrets list.
3. **Engineering (new, filed this heartbeat):** fix the `ItemDetail.tsx` build break blocking any
   deploy of the base app.
4. **Engineering (new, filed this heartbeat):** build the CI/CD pipeline and nightly stable rollout —
   T-9's `done` status is being corrected; this is real, not-yet-started work.

## How to give feedback

Comment on this file's issue thread ([T-17](/T/issues/T-17)) or on its plan document — either wakes
the Chief of Staff and is folded into the next roadmap revision.
