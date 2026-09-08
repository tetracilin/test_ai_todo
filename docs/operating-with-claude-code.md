# Operating this repo with Claude Code

**Who this is for:** the person who owns this project, drives every change through Claude Code,
and does not write git commands by hand. You do not need to learn git. You need to know what to
ask for, and how to tell whether what came back is safe.

**Why it exists:** on 2026-09-07 the integration branch was broken by two pull requests that
were merged in good faith. Nothing about them looked dangerous. This guide is the set of checks
that would have caught them, written down so the same class of mistake does not need to be
made twice. The real examples are in the appendix.

---

## The five rules

**1. Never merge a pull request unless it is green *and* up to date.**

Green means every check passed. Up to date means it was rebuilt against the current state of
`develop`. A pull request opened five days ago was tested against a five-day-old world.

Ask Claude Code: *"is PR #N green and up to date with develop?"* Do not merge until it says
yes to both.

**2. Every command you run on the server, run its check command too.**

A command that fails often says nothing. It just returns you to the prompt. If you did not
verify, you do not know.

Ask Claude Code: *"give me the command, and the command that proves it worked."*

**3. One command per line, copied from a code block.**

Never copy a command out of a table or a paragraph. Formatting inserts line breaks that become
real newlines when you paste, and your shell runs the fragments as separate commands.

Ask Claude Code: *"put each command in its own code block, one line each."*

**4. If a command contains a placeholder, stop.**

`THE_ACCESS_KEY`, `<your-value>`, `xxx` — anything in capitals or angle brackets that is not a
real value. Running it writes the placeholder text as if it were the real thing, and the
failure appears weeks later somewhere unrelated.

Ask Claude Code: *"which parts of this do I have to replace, and where do I get them?"*

**5. Before you stop or delete anything, ask what depends on it.**

Ask Claude Code: *"what breaks if I stop this?"* It can search the whole repository for
references in seconds. On 2026-09-08 that question prevented the deletion of the object store
that production writes every file to.

---

## Words you will see, in plain English

| Word | What it actually means |
|---|---|
| **branch** | A private copy of the project where changes are made. Yours until you share it |
| **commit** | One saved change with a note explaining it |
| **push** | Upload your branch to GitHub so others (and CI) can see it |
| **pull request (PR)** | A request to copy your branch's changes into the shared one. Where review and checks happen |
| **`develop`** | The shared branch everything lands on first. Broken `develop` blocks everybody |
| **`main`** | Production-ready code only. Reached by PR from `develop` |
| **CI / checks** | Robots that build and test your branch automatically. Green = passed |
| **merge** | Accept a PR and copy its changes in. This is the moment risk becomes real |
| **rebase** | Rebuild your branch on top of the current `develop`. This is what "up to date" means |
| **revert** | Undo a change that already landed, by adding a new change that cancels it. Safe |
| **lockfile** | `pnpm-lock.yaml` — records the exact version of every dependency. If it disagrees with the rest of the project, **nothing installs and everything fails** |
| **stack** | One running copy of the app plus its database. This machine runs several |

---

## Recipes

### I want to change something

You never touch git. Say what you want, then:

1. *"Make this change on a new branch and open a PR."*
2. Wait for checks. *"Is it green?"*
3. If red: *"Why is it red, and is it my change or something already broken?"* That distinction
   matters — sometimes `develop` is already broken and your PR is innocent.
4. If green: *"Anything risky in this diff?"*
5. Merge in the GitHub web page, or ask Claude Code to.

**Never** ask for a change to be pushed straight to `develop` or `main`. Every change goes
through a PR, even a one-line documentation fix. That is not bureaucracy; it is the only place
the checks run.

### Claude Code gave me a command to run on the server

Before pasting anything:

1. *"What does this do, and what happens if it's wrong?"*
2. *"Is any part of this irreversible?"*
3. *"Give me the command that verifies it worked."*

Then paste **one command**, look at the output, and only then paste the next. Do not paste a
block of five.

If a command errors, paste the **entire** error back to Claude Code, including the line above
it. Half an error message produces half a diagnosis.

### Something in CI is broken

1. *"What failed, and was it failing before my change?"*
2. *"Is this one problem or several?"* A single red run often hides two unrelated failures in
   two different jobs.
3. *"What's the smallest fix, and what does it not fix?"*

Do not merge past a red check because it looks unrelated. On this repo it usually is not.

### I want to deploy

Staging deploys automatically at 22:00 UTC from `develop`, or on demand from the GitHub
Actions tab (**Run workflow** on `t3-nightly`). Production requires a tag and a human approval.

Never run `docker` commands to deploy by hand. That is how this host ended up with several
stacks nobody can account for. If a deploy is needed now, trigger the workflow.

### I tested it and it still doesn't work

**Name the stack first.** This machine runs several copies of the app. A hostname and a port do
not tell you which one, and most of them are not updated by CI.

Ask: *"which stack is this URL, and is it deployed by CI?"*

See `docs/deploy/kmv8-stack-inventory.md`. On 2026-09-08 four rounds of debugging went into an
adapter that was configured perfectly, because the instance under test was a hand-built copy
from a week earlier that could not read the setting at all.

---

## Red flags in Claude Code's own output

Claude Code is confidently wrong sometimes. These are the tells, all observed in this project:

| Red flag | What to say |
|---|---|
| A command with a capitalised placeholder | *"What do I replace, and where do I get the value?"* |
| A command longer than one line, or inside a table | *"One line, in its own code block."* |
| *"This should work"* / *"should be fine"* | *"Have you verified that, or is it an inference?"* |
| A fix with no verification step | *"How do I know it worked?"* |
| A confident claim about the server | It cannot see your server. *"Can you actually check that, or are you guessing?"* |
| A claim with no file or line reference | *"Which file and line says that?"* |
| Advice to delete, remove, prune, or force | Stop. *"What depends on this, and how do I undo it?"* |

Asking *"are you sure, and how did you check?"* is not rude and does not slow you down. In this
project it has repeatedly caught real errors before they landed.

---

## Traps specific to this repo

**Green CI does not mean the tests passed.** The `unit` check runs only the non-server tests.
The server test suites run in the nightly build, *after* merge. Two regressions reached
`develop` this way in September 2026.

**`develop` has no branch protection.** Nothing mechanically stops a red or out-of-date PR from
being merged. Rule 1 is the only thing standing there. (Turning protection on is a five-minute
change in repo Settings → Branches, and is strongly recommended.)

**Dependabot PRs are the highest-risk merges here.** They are opened automatically, they age,
and they touch the lockfile — the one file that breaks *everything* when it disagrees with the
rest of the project. As of 2026-09-08 there were seven open, several months old. Treat every one
as: green? rebased? merged **one at a time**, checking after each?

**Failure alerts do not reach Discord.** The `DISCORD_WEBHOOK_URL` secret is unset, so those
steps silently do nothing. Do not read silence as success; check the Actions tab.

**Several stacks run on the host and only two are deployed by CI.** See the inventory.

---

## What Claude Code cannot do

Knowing the boundary saves you from waiting on something that will never happen:

- **It cannot reach your server.** No SSH. Anything on kmv8 you run yourself. If it hands you a
  host command, it has not tested it — ask what it expects to see.
- **It must not deploy by hand, or approve production.** Those are yours.
- **It cannot change repository settings.** Branch protection, secrets, environment variables
  are all in the GitHub web interface.
- **It cannot see a stopped container, a file it was not shown, or anything you did not paste.**
  When in doubt, paste more.

---

## Appendix: what actually went wrong, 2026-09-07 and 08

Four failures in about thirty hours. None was caused by a difficult technical problem.

**1. Two stale pull requests broke the shared branch.**
PRs #62 and #63 were opened on 09-02 and merged on 09-07, ninety-eight seconds apart. Both had
failing checks at merge time; #63's most recent check run was from five days earlier. Their
lockfiles no longer agreed with the project, so `pnpm install` failed and every check and both
nightly jobs died before running anything. Fixed by reverting both (PR #91).
→ **Rules 1.**

**2. A permissions command failed silently.**
`chmod 640/etc/t3/secrets/...` — a missing space. `chmod` reported an error, nobody looked, and
the files kept the wrong permissions. Nothing downstream complained.
→ **Rule 2.**

**3. A command broke on paste.**
A `curl` command copied from a formatted table arrived as three separate lines and ran as three
separate broken commands. The endpoint also required a login the command did not have — so it
would have failed even formatted correctly.
→ **Rules 3 and 4.**

**4. A near-miss deletion.**
A request to "terminate the rest" of the containers on the host would have removed the object
store that production writes every file to, the tabular database a planned feature depends on,
and a plugin backend. Caught by asking what referenced each one before stopping any of them.
→ **Rule 5.**

The thread connecting all four: **state that lives outside the pipeline drifts from the state
inside it, silently.** Old branches, hand-edited files on the host, hand-started containers,
settings changed in a web page. The pipeline cannot see any of it, so it cannot warn you. The
five rules are all, in different forms, the same instruction: check the thing itself, do not
trust the description of it.

## Related

- `docs/deploy/kmv8-stack-inventory.md` — what runs on the host and what depends on it
- `CLAUDE.md` — the rules Claude Code follows in this repo
- `CICD/PLAN_CICD.md` — pipeline plan and current known-broken list
