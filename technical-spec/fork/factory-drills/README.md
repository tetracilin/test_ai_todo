# Factory drills (WP-FACTORY-001)

Date: 2026-11-19. This file records the drills that proved the merge gate.

## Starting state (step 2)

- Repository: public, default branch `develop`, admin rights present.
- Protection on `develop` at the start: required checks `build`, `build-image`, `unit`; strict was `false` (the work package expects `true`); no required approvals; no code-owner review; admins not enforced.
- Secrets present: the reviewer login, the discord webhook and the factory app key. Variable `FACTORY_APP_ID` present.
- The last three nightly runs had failed.

## Canary numbers

| Canary | Pull request | What it proved |
|---|---|---|
| D | #221 | A documentation change merged by the factory app with no person (after the reviewer login was repaired). |
| C | #220 | A forced FAIL blocked it; later a real review passed, the app updated its branch from `develop`, and the factory merged it. |
| B | #226 | A change in a protected path (`CICD/`) was reviewed with PASS, labelled `needs-human` and merged by a person. |
| E | #219 | The kill switch stopped auto-merge; after the switch went back on, the factory merged it. |
| S | #217 | A broken server test made `server-tests` fail; closed, never merged. |

Other pull requests of the work: PR-1 #214, PR-2 #216, PR-3 #218, PR-4 #226, this pull request is PR-5. Extra repair pull requests: #215 (lockfile), #222, #223 and #225 (reviewer workflow).

## Deviations from the reference files and why

- `pnpm-lock.yaml` on `develop` was broken (missing entry for one package), so CI was red. Pull request #215 repaired it.
- In the two factory workflows, three `gh api --jq '... | @json'` pipes were fixed: `gh` prints strings without quotes, so `jq -s 'map(fromjson)'` failed.
- `strict` on the `develop` protection was set to `true` after canary E (the work package expects it).
- The reviewer first failed because the stored login token contained a line break. Pull request #222 removed the `--model` line, #223 set `--permission-mode dontAsk` and #225 added `show_full_output: true` to read the hidden error. The owner approved each of the three with an admin merge. The real cause was the token; the owner replaced it.
- A review started by the sweep runs as the actor `github-actions`, and the review action refuses bot actors. Reviews of never-reviewed pull requests had to be started by hand (canary E). A fix needs `allowed_bots` on the review step.
- `show_full_output: true` is still in the review workflow and must be removed.
- The server test suites are red on `develop` without any canary (vitest 5 changes), so `server-tests` blocks every pull request that touches a server path until that is repaired.

## Held pull requests

Six pull requests that were open at go-live carry the label `factory-hold` (#113, #144, #148, #152, #185, #213). None came from the DSH loop. The owner decides about each one (sign-off H-8).
