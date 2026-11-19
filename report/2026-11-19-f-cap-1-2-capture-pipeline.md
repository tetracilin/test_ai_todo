# F-CAP-1 and F-CAP-2: capture pipeline and triage fallback

- **Status:** built; pull request open to `develop`; waiting for human validation on a real Discord DM
- **Units:** F-CAP-1 (capture pipeline, one bounded LLM call) and F-CAP-2 (fallback to a triage card), WP-0 verb 1
- **Plan:** `technical-spec/designs/t3-slice1-feature-plan.md`, section B.3
- **Branch:** `feature/f-cap-1-capture-pipeline`
- **Base:** `origin/develop` at `180e89cb`
- **Date:** 2026-11-19

## What the feature does

An engineer sends a photo or a file to the bot in a Discord DM. The file becomes evidence on
one of that engineer's open cards, and the bot confirms in one Vietnamese line.

1. The bridge pairs a photo with the text sent just before or after it (20 seconds).
2. The server downloads the file from the Discord CDN and checks its type.
3. The server asks the model once: which of the engineer's open cards, what kind of evidence,
   and a short English gloss.
4. The server stores the file in the evidence bucket, links it to the card with
   `source = bot`, and writes one dossier line with the caption word for word.
5. If the model gives no usable answer after one more try, or cannot be reached, the file
   goes to the engineer's `Unsorted chat captures` card. Nothing is lost.

## Test evidence

Commands were run in the worktree on 2026-11-19 (Windows 11, Node 22.23.2).

| Suite | Command | Result |
|---|---|---|
| Structuring client and parser | `npx vitest run server/src/__tests__/wp0-structuring.test.ts` | 23 passed |
| DM route, capture included | `npx vitest run server/src/routes/discord-integrations.test.ts` | 62 passed (17 new) |
| Capture service, part without a database | `npx vitest run server/src/__tests__/discord-capture.test.ts` | 12 passed, **21 skipped** |
| Bridge, pairing included | `cd discord-bridge && npm test` | 66 passed (12 new) |
| Neighbours (intake, phrase table, hostname gate) | `npx vitest run server/src/__tests__/discord-intake.test.ts packages/shared/src/wp0-phrases.test.ts server/src/__tests__/app-private-hostname-gate.test.ts` | 47 passed, 5 skipped |
| Server typecheck | `pnpm --filter @paperclipai/server typecheck` | exit 0 |
| Bridge typecheck | `cd discord-bridge && npx tsc --noEmit` | exit 0 |
| SSoT guards | `node scripts/check-ssot-guards.mjs` | clean |

### What the 21 skipped tests are, and where they run

They are the capture-service tests that need a real Postgres. This workstation cannot start
the embedded test database: `initdb.exe` answers `could not create directory ... Permission
denied` in every shell, with or without the tool sandbox. The same limit is recorded in
`report/2026-11-07-issue-46-evidence-gate-post-commit-publication.md`. The suite skips itself
when the database cannot start, so the local run says "skipped", not "passed".

**These 21 tests are not proven locally.** They run in the `server-tests` required check on
the pull request, on GitHub-hosted Linux runners. Read that check for the result. They cover
the rows marked "CI" below.

### Acceptance, mapped to tests

| Requirement (plan B.3) | Test | Runs |
|---|---|---|
| Pairing: photo then caption inside the window is one capture | `dmPairing.test.ts` "pairs a photo with the caption that follows it" | local |
| Pairing: just outside the window | `dmPairing.test.ts` "sends the photo alone when the caption arrives just outside the window" | local |
| Pairing: caption first | `dmPairing.test.ts` "pairs caption-first" | local |
| Paired caption is not answered twice by the replay | route test "settles the paired caption's message id" | local |
| One LLM call per capture | `discord-capture.test.ts` "files a photo on the card the model names" (`toHaveBeenCalledTimes(1)`) | CI |
| The call is bounded and is not an agent session | `wp0-structuring.test.ts` "makes one bounded chat-completion request" | local |
| Zero open cards goes to triage, no model call | `discord-capture.test.ts` "routes an engineer with zero open cards" | CI |
| Filed as `source = bot`; caption verbatim in the dossier; wedge ratio moves | `discord-capture.test.ts` "files a photo on the card the model names" | CI |
| Fallback: malformed, empty, refusal, each after one re-prompt | `discord-capture.test.ts` "files the raw capture on the triage card when both answers are ..." (3 cases) | CI |
| Fallback: provider down (6 failure kinds), no re-prompt | `discord-capture.test.ts` "when the provider is down (...)" | CI |
| Provider down does not use up the photo; a resend works | `discord-capture.test.ts` "lets the engineer resend after a provider outage" | CI |
| A card the caption asked for is refused in code | `wp0-structuring.test.ts` "rejects a card that was not offered"; `discord-capture.test.ts` "refuses a card the caption talked the model into" | local; CI |
| Download failure stores nothing | `discord-capture.test.ts` "stores nothing and asks nothing when the download fails" | CI |
| Only the Discord CDN is ever fetched | `discord-capture.test.ts` "refuses ... without making a request" (7 cases) | local |
| Evidence store down: 503, claim released, replay files it | `discord-capture.test.ts` "answers 503 and links nothing"; route test "releases the claim when the evidence store is down" | CI; local |
| Every reply comes from the phrase table | route tests compare against `renderWp0Message(...)` | local |

## What was not tested

- **No real Discord message, no real model, no real MinIO.** All three are replaced in the
  tests. The first real run is the human validation below.
- **Card-matching quality.** How often the model picks the right card on real Vietnamese
  messages is F-CAP-4 (the eval suite, 90% bar). It is not part of this change.
- **Replay does not pair.** A photo and caption that arrive through the F-DM-3 replay are
  handled as two messages: the photo is captured, the caption gets its own answer.

## What an operator must set before it works on staging

1. The evidence bucket: `PAPERCLIP_STORAGE_EXTERNAL_ENDPOINT` and
   `PAPERCLIP_STORAGE_EXTERNAL_BUCKET` (and its two secret files). Without it a photo DM gets
   `503 evidence_storage_not_configured`; the message stays in Discord and is replayed.
2. The model: server env `PAPERCLIP_WP0_LLM_BASE_URL` and `PAPERCLIP_WP0_LLM_MODEL`, and the
   company secret `WP0_LLM_API_KEY`. Without them every capture goes to the triage card.

Both are server env or company settings. This change touches no workflow, no compose file
and no deploy script.

## Human validation steps

On staging, after the two settings above, with a linked Discord account that has two open cards:

1. DM the bot one photo, then within 20 seconds a caption that fits one card. Expect one
   reply `Đã ghi vào thẻ <card> — ...`, the file under that card's evidence, and one new
   line in the dossier Evidence log with the caption word for word.
2. DM the caption first, then the photo. Expect the same single reply.
3. Remove the `WP0_LLM_API_KEY` secret and DM a photo. Expect a reply that names the triage
   card, and the file on `Unsorted chat captures`.
4. Close every open card and DM a photo. Expect the "no open cards" reply naming the triage card.

## Notes on this session

- A cmd AutoRun hook on this workstation changes directory to the primary checkout for every
  `pnpm` or `npx` call. The first `pnpm install` and `npm ci` of this session therefore ran in
  `test_ai_todo` and not in the worktree. Only `node_modules` there changed; `git status` and
  the branch were the same before and after.
- The existing bridge test "forwards attachment metadata only" was changed on purpose. The
  CDN URL now travels with the metadata; the bridge still does not download or forward bytes.

## Model used

- Provider: Anthropic. Model ID: `claude-fable-5-2` in Claude Code (desktop app), with tool
  use and code execution.
