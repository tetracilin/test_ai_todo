# Operating this repo with Claude Code

**Who this is for:** the person who owns this project, drives every change through Claude Code,
and does not write git commands by hand. You do not need to learn git. You need to know what to
ask for, and how to tell whether what came back is safe.

**Why it exists:** over 2026-09-07 and 08, four things went wrong in about thirty hours. None
was technically hard. Each was a check nobody knew to make. This is that list of checks, with
the real incidents in the appendix.

---

## The six rules

**1. Never merge a pull request until its checks have *finished* and passed, and it is up to date.**

Not "no red X" — **finished**. A pull request with checks still spinning shows an amber dot, not
a red one, and looks mergeable. PR #62 was merged seven seconds after its checks started. They
failed nine seconds later.

Up to date means it was rebuilt against the current `develop`. A pull request opened five days
ago was tested against a five-day-old world.

Ask: *"have PR #N's checks finished, did they all pass, and is it rebased on current develop?"*
Three answers. All three must be yes.

**2. Read the output of every command you run, and run its check command too.**

Commands do not always fail loudly, and when they do fail loudly, it is easy to scroll past.
`chmod 640/etc/...` printed a real error, and it was missed because nobody looked.

Ask: *"give me the command, and the command that proves it worked."*

**3. One command per line, copied from a code block.**

Never copy a command out of a table or a paragraph. Formatting inserts line breaks that become
real newlines when you paste, and your shell runs the fragments as separate commands.

Ask: *"put each command in its own code block, one line each."*

**4. If a command is not complete, stop.**

Two ways it can be incomplete. **Placeholders** — `THE_ACCESS_KEY`, `<your-value>`, anything in
capitals or angle brackets that is not a real value. And **missing credentials** — a command
that calls an API which requires a login the command does not carry.

Ask: *"what do I have to replace, where do I get it, and does this need a login?"*

**5. Before you stop or delete anything, ask what depends on it.**

Ask: *"what breaks if I stop this?"* Claude Code can search the whole repository for references
in seconds. On 2026-09-08 that question prevented several containers being deleted, including
the object store Teable runs on.

**6. If the change touches `server/`, ask for the server tests to be run locally first.**

This is the trap that green CI does not catch. The `unit` check runs only the non-server tests;
the server suites run in the nightly build, *after* merge.

Ask: *"does this touch server/, and did you run the relevant suite?"* The commands, from
`CLAUDE.md`:

```
pnpm --filter @paperclipai/plugin-sdk ensure-build-deps
```
```
npx vitest run server/src/__tests__/<file>.test.ts
```

The first is not optional; without it the second fails with `ERR_MODULE_NOT_FOUND`.

---

## Words you will see, in plain English

| Word | What it actually means |
|---|---|
| **branch** | A private copy of the project where changes are made. Yours until you share it |
| **commit** | One saved change with a note explaining it |
| **push** | Upload your branch to GitHub so others (and CI) can see it |
| **pull request (PR)** | A request to copy your branch's changes into the shared one. Where review and checks happen |
| **diff** | The list of exactly what changed — which lines were added and removed |
| **`develop`** | The shared branch everything lands on first. Broken `develop` blocks everybody |
| **`main`** | Production-ready code only. Reached by PR from `develop` |
| **tag** | A permanent label on one commit, like `v0.1.0`. Production deploys are triggered by tags |
| **CI / checks** | Robots that build and test your branch automatically. Green = finished and passed |
| **merge** | Accept a PR and copy its changes in. This is the moment risk becomes real |
| **rebase** | Rebuild your branch on top of the current `develop`. This is what "up to date" means |
| **revert** | Undo a change that already landed, by adding a new change that cancels it. Safe |
| **branch protection** | A GitHub setting that refuses merges failing your rules. Currently OFF for `develop` |
| **Dependabot** | A robot that opens PRs to update dependencies. It does not rebase them; they go stale |
| **lockfile** | `pnpm-lock.yaml` — the exact version of every dependency. If it disagrees with the rest of the project, **nothing installs and everything fails** |
| **`pnpm install`** | Downloads dependencies. The first step of every build; when it fails, nothing after it runs |
| **stack** | One running copy of the app plus its database. This machine runs several |
| **SSH tunnel** | A temporary private link to a port on the server that is not otherwise reachable |
| **prune / force / `-v`** | Words that mean "delete without asking". Treat all three as stop signs |

---

## Recipes

### I want to change something

You never touch git. Say what you want, then:

1. *"Make this change on a new branch and open a PR."*
2. *"Have the checks finished, and did they pass?"*
3. If red: *"Is this my change or was `develop` already broken?"* That distinction matters —
   sometimes your PR is innocent.
4. If green: *"Anything risky in this diff?"*
5. Merge it yourself in the GitHub web page. If you want Claude Code to merge, **say so
   explicitly** — `CLAUDE.md` tells it to open a PR and stop, so it will not merge unless asked.

Every change goes through a PR, even a one-line documentation fix. That is not bureaucracy; the
PR is the only place the checks run.

Two shapes of change are forbidden and Claude Code should refuse them:

- **Pipeline files mixed with app code.** `.github/workflows/`, `deploy/compose.yaml` and
  `deploy/scripts/` get their own PR, labelled `ci`, reviewed by a human.
- **Anything from upstream.** This repo is a hard fork of `paperclipai/paperclip`. No upstream
  remote, no merges from upstream, no restoring upstream's workflows.

### Claude Code gave me a command to run on the server

Before pasting anything:

1. *"What does this do, and what happens if it's wrong?"*
2. *"Is any part of this irreversible?"*
3. *"Give me the command that verifies it worked."*

Then paste **one command**, read the output, and only then paste the next. Do not paste a block
of five.

If a command errors, paste the **entire** error back, including the line above it. Half an error
message produces half a diagnosis.

To reach the server you need an SSH client, a key installed on kmv8, and a `kmv8` alias in your
`~/.ssh/config`. If `ssh kmv8` does not connect, that is the first thing to fix, and Claude Code
cannot do it for you.

### Something in CI is broken

1. *"What failed, and was it failing before my change?"*
2. *"Is this one problem or several?"* A single red run often hides two unrelated failures in
   two different jobs.
3. *"What's the smallest fix, and what does it not fix?"*

Do not merge past a red check because it looks unrelated. On this repo it usually is not.

### I want to deploy

Staging deploys at 22:00 UTC from `develop` — **but only if `develop` changed since the last
run.** If you see no deploy, it may have skipped rather than failed. Check the Actions tab; do
not infer. You can also trigger it any time from the Actions tab with **Run workflow** on
`t3-nightly`.

Production needs a tag and a human approval in the Actions UI. That approval is yours alone.

Never deploy by running `docker` commands. That rule applies to everyone, not just to agents —
it is how this host ended up with stacks nobody can account for.

### I tested it and it still doesn't work

**Name the stack first.** This machine runs several copies of the app and only one is kept
current by CI. A hostname and a port do not tell you which.

Ask: *"which stack is this URL, and does any workflow deploy it?"*

See `docs/deploy/kmv8-stack-inventory.md`. On 2026-09-08 four rounds of debugging went into an
adapter that was configured perfectly, because the instance under test was a hand-built copy
from a week earlier that could not read the setting at all.

---

## Red flags in Claude Code's own output

Claude Code is confidently wrong sometimes. Every row below was observed in this project, and
several are mistakes it made while writing this guide:

| Red flag | What to say |
|---|---|
| A command with a capitalised or angle-bracket placeholder | *"What do I replace, and where do I get the value?"* |
| A command longer than one line, or inside a table | *"One line, in its own code block."* |
| *"This should work"* / *"should be fine"* | *"Have you verified that, or is it an inference?"* |
| A fix with no verification step | *"How do I know it worked?"* |
| A confident claim about the server | It cannot see your server. *"Can you actually check that, or are you guessing?"* |
| A claim with no file or line reference | *"Which file and line says that?"* |
| A claim it made correctly earlier, restated differently later | *"You said the opposite an hour ago. Which is right?"* |
| Advice to delete, remove, prune, or force | Stop. *"What depends on this, and how do I undo it?"* |

The second-to-last row is the one that actually catches things. In this session Claude Code
verified a storage setting correctly, then wrote the opposite into a document an hour later. An
independent review caught it. Asking *"are you sure, and how did you check?"* is not rude and
does not slow you down.

---

## Traps specific to this repo

**Green CI does not mean the tests passed.** The `unit` check runs only the non-server tests.
The server suites run in the nightly build, *after* merge. Two regressions reached `develop`
this way in September 2026. Rule 6 is the mitigation.

**e2e has never run at all.** Not "is flaky" — has never once executed. The browser tests sit
behind a step that fails first every time, so they have never reported anything about anything.

**`develop` is protected as of 2026-09-09**, so rule 1 is now enforced by GitHub rather than by
you remembering it: a PR cannot merge unless `unit`, `build` and `build-image` have passed and
the branch is up to date. Keep asking the rule 1 question anyway — `enforce_admins` is `false`,
so an admin account can still click through, and the checks tell you *why* something is red
before you go looking.

**Dependabot PRs are the highest-risk merges here.** They are opened automatically, they are
never rebased, and they touch the lockfile — the one file that breaks *everything* when it
disagrees with the rest of the project. Seven were open as of 2026-09-08, the oldest from
2026-08-30. Land them **one at a time**, each rebased, each green, checking `develop` between.

**Failure alerts do not reach Discord.** The `DISCORD_WEBHOOK_URL` secret does not exist, so
those steps silently do nothing. Do not read silence as success; check the Actions tab.

**Several stacks run on the host and only one is kept current by CI.** See the inventory.

---

## What Claude Code can and cannot do

Knowing the boundary saves you from waiting on something that will never happen.

**It cannot:**

- **Reach your server.** No SSH. Anything on kmv8, you run. If it hands you a host command it
  has not tested it — ask what it expects to see.
- **Deploy by hand, or approve a production release.** The approval is yours.
- **Read the value of a secret.** It can see that a secret exists and that one is missing; it
  cannot see what is in it.
- **See a stopped container, a file it was not shown, or anything you did not paste.** When in
  doubt, paste more.

**It can, which you may not expect:**

- **Change repository settings** — branch protection, environments, variables — through the
  GitHub API, if its token carries the `repo` scope. So "turn on branch protection for
  `develop`" is something you can simply ask for. An earlier version of this guide claimed
  otherwise and was wrong.
- **Trigger a workflow**, including a staging deploy, with `gh workflow run`.

There is an approved design (`docs/designs/t3-agent-host-access.md`) to give it a narrow,
audited way to run a fixed menu of operations on kmv8 through GitHub Actions. Until that ships,
the "cannot reach your server" line above holds.

---

## Appendix: what actually went wrong, 2026-09-07 and 08

**1. Two stale pull requests broke the shared branch.**
PR #63 merged at 23:48:02Z, PR #62 at 23:49:39Z — 97 seconds apart. Both were opened on 09-02.
#63 was five days stale with checks last run on 09-02, and they were red. #62 had just been
rebased by Dependabot, and its checks **were still running at the moment it was merged** —
they completed six seconds later and failed. Their lockfiles no longer agreed with the project,
so `pnpm install` failed and every check plus both nightly jobs died before running anything.
Reverted in PR #91.
→ **Rule 1**, and specifically the word *finished*. "No red X" was true of #62 and told you
nothing.

**2. A permissions command failed and nobody read the output.**
`chmod 640/etc/t3/secrets/...` — a missing space. `chmod` printed an error and exited non-zero.
The error scrolled past, the files kept the wrong permissions, and nothing downstream complained.
→ **Rule 2.**

**3. A command broke on paste, and would have failed anyway.**
A `curl` copied from a formatted table arrived as three separate lines and ran as three broken
commands. It also targeted an endpoint requiring a login it did not carry, so it would have
failed even formatted correctly.
→ **Rules 3 and 4.**

**4. A near-miss deletion.**
A request to "terminate the rest" of the containers on the host would have removed the object
store Teable depends on, a tabular database a planned feature needs, and a plugin backend.
Caught by asking what referenced each one before stopping any of them.
→ **Rule 5.**

**A fifth, for honesty.** Two documents written during this session — including an earlier
version of this one — were reviewed by an independent pass that found 16 and 31 errors
respectively. Several were confident, precise-looking citations that pointed at the wrong file.
That is why the red-flag table exists, and why "which file and line says that?" is worth asking
even when the answer looks authoritative.

The thread connecting all of them: **state that lives outside the pipeline drifts from the state
inside it, silently.** Old branches, hand-edited files on the host, hand-started containers,
settings changed in a web page, claims written from memory. The pipeline cannot see any of it,
so it cannot warn you. The six rules are all, in different forms, the same instruction: check
the thing itself, not the description of it.

## Related

- `docs/deploy/kmv8-stack-inventory.md` — what runs on the host and what depends on it
- `docs/designs/t3-agent-host-access.md` — the plan for safe agent access to kmv8
- `CLAUDE.md` — the rules Claude Code follows in this repo
- `CICD/PLAN_CICD.md` — pipeline plan and current known-broken list
