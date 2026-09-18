<!-- PR body template for the pr-loop skill. Copy this file to tmp/pr-loop/body.md, fill every section, then validate it: node .claude/skills/pr-loop/scripts/pr-preflight.mjs --no-fetch --body-file tmp/pr-loop/body.md --title "<PR title>" -->
<!-- Write all pull request text in Simplified Technical English (ASD-STE100): short sentences, one instruction per sentence, simple approved vocabulary, and the active voice. -->

## Thinking Path

<!-- Keep the first line exactly as written. Add 4 to 7 more "> -" lines that narrow from the project to this change: subsystem, the gap, why it matters, what this PR does, the benefit. Worked example from CONTRIBUTING.md:
> - Paperclip is the open source app people use to manage AI agents for work
> - But humans want to watch the agents and oversee their work
> - Human users also operate in teams and so they need their own logins, profiles, views etc.
> - So we have a multi-user system for humans
> - But humans want to be able to update their own profile picture and avatar
> - But the avatar upload form wasn't saving the avatar to the file storage system
> - So this PR fixes the avatar upload form to use the file storage service
> - The benefit is we don't have a one-off file storage for just one aspect of the system, which would cause confusion and extra configuration
-->

> - Paperclip is the open source app people use to manage AI agents for work
> - [Which subsystem or capability is involved]
> - [What problem or gap exists]
> - [Why it needs to be addressed]
> - This pull request ...
> - The benefit is ...

## Linked Issues or Issue Description

<!-- Pick ONE path. (A) An issue exists: write one line per issue, `Fixes: #123`, `Closes #123`, or `Refs #123`. Public github.com/tetracilin/test_ai_todo issues only. (B) No issue exists: keep at least three bold labels below, each alone on its line, with real content under each. Never paste internal Paperclip ticket ids, agent-scheme links, local-machine or tailnet URLs; the preflight body check fails on them. Before you open the PR, search for related work: `gh pr list --state all --search "<2-3 keywords from the title>" --json number,title,state`. Link every hit here with `Refs #N`, then tick the dedup-search box in the Checklist. -->

**Problem**
[One or two sentences on what is wrong or missing today.]

**Expected behavior**
[What should happen after this PR.]

**Context**
[Where it shows up, who is affected, how you found it.]

## What Changed

<!-- One bullet per logical change. Name the files or modules. -->

- [Change 1]
- [Change 2]

## Verification

<!-- REQUIRED: paste the full preflight table from `node .claude/skills/pr-loop/scripts/pr-preflight.mjs` (every "<id> | PASS|WARN|FAIL | <hint>" line and the final "preflight: PASS" line) inside the code block below. Then list any manual steps. If preflight showed a WARN, say what you did about it. -->

```
[paste the preflight table here]
```

- [Manual step or extra command, if any]

## Risks

<!-- What could go wrong? Migration safety, breaking changes, behaviour shifts. Write "Low risk: <why>" if it is genuinely minor. -->

- [Risk and how it is contained]

> For core feature work, check the fork roadmap [`roadmap.md`](roadmap.md) first and discuss it before opening the PR. Feature PRs that overlap with planned core work may need to be redirected — check the roadmap first. See `CONTRIBUTING.md`.

## Model Used

<!-- Pre-filled for Claude Code sessions. Paperclip agent runs replace this line with their own adapter and model. -->

- Claude (Anthropic), Claude Fable 5.1, model ID claude-fable-5-1, via Claude Code CLI, extended reasoning, tool use

## Checklist

<!-- Pre-ticked. Untick any line that is not true and fix it before you open the PR. The dedup-search line ships unticked: tick it only after you ran the `gh pr list --search` step described under Linked Issues. The two lines about CI gates and Greptile stay unticked until the pr-readiness verdict is ready_for_human_merge; a human ticks them. -->

- [x] I have included a thinking path that traces from project context to this change
- [x] I have specified the model used (with version and capability details)
- [x] I have checked roadmap.md and confirmed this PR does not duplicate planned core work
- [ ] I have searched GitHub for duplicate or related PRs and linked them above
- [x] I have either (a) linked existing issues with `Fixes: #` / `Closes #` / `Refs #` OR (b) described the issue in-PR following the relevant issue template
- [x] I have not referenced internal/instance-local Paperclip issues or links (only public GitHub `#NNN` / `github.com/tetracilin/test_ai_todo` URLs)
- [x] My branch name describes the change (e.g. `docs/...`, `fix/...`) and contains no internal Paperclip ticket id or instance-derived details
- [x] I have run tests locally and they pass
- [x] I have added or updated tests where applicable
- [x] I have updated relevant documentation to reflect my changes
- [x] I have considered and documented any risks above
- [ ] All Paperclip CI gates are green
- [ ] The Greptile Review check is green on the current head and every Greptile thread is resolved
- [x] I will address all Greptile and reviewer comments before requesting merge

🤖 Generated with [Claude Code](https://claude.com/claude-code)
