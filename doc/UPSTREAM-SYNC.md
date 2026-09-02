# Upstream policy — hard fork, one-way selective cherry-picks

`tetracilin/test_ai_todo` is a **hard fork** of
[`paperclipai/paperclip`](https://github.com/paperclipai/paperclip) with an independent
roadmap (see `roadmap.md`). `main` is the development branch; the former
`integration/paperclip` integration branch is retired. Nothing is ever contributed back
to upstream, and there is no merge-based sync workflow: divergence is accepted and
expected.

## What we take from upstream

One-way, **selective cherry-picks only**, at the owner's discretion:

- security fixes
- useful core improvements that apply cleanly to the fork

There is no schedule and no obligation to take anything.

## Remote contract

No `upstream` remote is configured until the first actual cherry-pick. When one is
needed:

```sh
git remote add upstream https://github.com/paperclipai/paperclip.git
git fetch upstream
```

`origin` stays `https://github.com/tetracilin/test_ai_todo.git`. Do not point `upstream`
at another fork. Never force-push `main`.

## Cherry-pick workflow

1. Branch from `main` (e.g. `sync/cherry-pick-<topic>`).
2. `git cherry-pick -x <sha>...` the specific upstream commits. Resolve conflicts
   deliberately; fork behavior wins unless the pick is the point.
3. Preserve `LICENSE` and `NOTICE` when carrying over substantial upstream code.
4. Run the checks required by `AGENTS.md` (smallest relevant check for a narrow pick;
   full `pnpm -r typecheck` / `pnpm test:run` / `pnpm build` for broad ones).
5. Run the after-sync checklist below.
6. Land through a normal PR into `main`.

Record the upstream SHAs taken (the `-x` trailer does this) and any intentionally
dropped hunks in the PR description.

## After-sync checklist (run after every cherry-pick)

1. **Delete any re-added upstream `DESIGN.md` or `ROADMAP.md`.** The fork relocated
   upstream's `DESIGN.md` → `docs/designs/DESIGN-UI.md`, dropped upstream's `ROADMAP.md`
   entirely (the fork's roadmap is independent), and owns lowercase `design.md` and
   `roadmap.md` at the root. In git's tree, `DESIGN.md` and `design.md` are *different paths* — but on
   case-insensitive filesystems (Windows, macOS) they collide on one file at checkout.
   Any upstream commit that re-adds the uppercase files reintroduces that collision, so
   every sync must check:

   ```sh
   git ls-files | grep -iE '^(design|roadmap)\.md$'
   ```

   Only `design.md` and `roadmap.md` (lowercase, fork-owned) may appear. Remove any
   re-added uppercase path with `git rm` in the sync branch. Upstream roadmap content is
   never kept; fold upstream UI-design content into `docs/designs/DESIGN-UI.md` only if
   it is worth keeping.

2. **Verify SSoT provenance.** The three fork SSoT files — `roadmap.md`, `backlog.md`,
   `design.md` — are fork-owned. Confirm the cherry-pick did not silently merge upstream
   content into them; their content changes only through deliberate fork commits.

3. **Grep for dangling references to relocated paths.** New upstream code or docs may
   reference the old root locations:

   ```sh
   git grep -nE '(^|[^A-Za-z/-])(DESIGN\.md|ROADMAP\.md)' -- . ':!docs/designs'
   ```

   Repoint any hit at `docs/designs/DESIGN-UI.md`, or at the fork's `roadmap.md`
   where the fork's plan is what is meant.

## Baseline and provenance

Fork history began from upstream commit `599ad7016c34a3b869716129cc0ea5a94b87920f`
(2026-08-21). The old requirement that upstream remain an ancestor of the fork's history
(`git merge-base --is-ancestor`) is **retired** — cherry-picks do not preserve ancestry,
and none is required. Keep `LICENSE` and `NOTICE` when copying or distributing
substantial upstream code.
