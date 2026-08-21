# Upstream sync policy

`tetracilin/test_ai_todo` derives from
[`paperclipai/paperclip`](https://github.com/paperclipai/paperclip). The canonical integration branch
is `integration/paperclip`; legacy `main` is not a Paperclip integration target before human-approved
cutover.

## Remote contract

```text
origin    https://github.com/tetracilin/test_ai_todo.git
upstream  https://github.com/paperclipai/paperclip.git
```

Do not change `upstream` to another fork. Add other forks under distinct remote names.

## Sync workflow

1. Start from current canonical integration history.

   ```sh
   git fetch --prune origin upstream
   git switch integration/paperclip
   git pull --ff-only origin integration/paperclip
   git switch -c sync/upstream-YYYY-MM-DD
   ```

2. Merge upstream without rewriting shared history.

   ```sh
   git merge --no-ff upstream/master
   ```

3. Resolve conflicts deliberately. Preserve fork behavior only where documented; do not accept a
   broad ours/theirs resolution.

4. Run checks required by `AGENTS.md`. At minimum:

   ```sh
   pnpm install --frozen-lockfile
   pnpm -r typecheck
   pnpm test:run
   pnpm build
   git diff --check upstream/master...HEAD
   git merge-base --is-ancestor upstream/master HEAD
   ```

5. Push the topic branch and merge it into `integration/paperclip` through review. Never force-push
   `integration/paperclip` or `main`.

## Baseline and provenance

Fork integration began from upstream commit
`599ad7016c34a3b869716129cc0ea5a94b87920f` on 2026-08-21. Each sync merge must retain upstream as
an ancestor so `git merge-base --is-ancestor <upstream-sha> HEAD` succeeds.

Record upstream baseline SHA, verification commands, and any intentionally retained fork delta in
review metadata. Keep `LICENSE` and `NOTICE` when copying or distributing substantial upstream code.