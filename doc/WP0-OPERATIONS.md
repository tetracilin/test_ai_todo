# WP-0 Operations — Discord DM pilot

Status: the single named home for WP-0 runbooks (backlog operational AC8). It is a
**pilot-start gate deliverable**: the engineer running the one-week, one-engineer +
one-PM pilot, and the maintainer on call behind them, work from this page. Scope is the
**Discord-only pilot** (owner gate decision, 2026-09-02). WhatsApp rows are deferred and
kept in §14 so nobody mistakes them for active scope.

This page answers five questions for every failure, in this order: **what the symptom
looks like → how you notice it → what you do → who retries (you or the system) → what it
does to the band call.** If a row cannot answer the fourth question, it is not finished.

Scope and sources:

- `backlog.md` — Epic 0, WP-0 operational ACs 1–12 and the pilot protocol (the spec this
  page implements; owner-edited, never edited from here).
- `docs/discord-integration.md` — authority split, data model, API contracts, bridge
  runtime, security constraints.
- `docs/rollback-discord-integration.md` — staging rollback and credential-rotation runbook.
- `docs/deploy/staging-k16.md`, `deploy-staging/compose.yaml`,
  `deploy-staging/scripts/healthcheck.sh` — the staging project (`t3-staging`) the pilot runs on.
- `docs/deploy/minio-nas-artifact-storage.md` — the NAS MinIO store. **Read §8 before you
  treat it as the evidence write path: staging runs the local-disk storage provider today.**
- `packages/shared/src/wp0-phrases.ts` — the canonical Vietnamese phrase table. **Every
  Vietnamese line this page tells you to send comes from there**; never retype one by hand.
- `doc/HERMES_GATEWAY_ONBOARDING.md`, `doc/TASK-WATCHDOG.md`, `doc/MCP-RUNTIME-OPERATIONS.md`
  — adjacent runtime runbooks.

Conventions used below — export these before you run anything on this page:

| Variable | What it is | Where it comes from |
| --- | --- | --- |
| `$STAGING_DEPLOY_PATH` | checkout of `deploy-staging/` on the staging host; commands run from there unless stated | the host |
| `$PAPERCLIP_URL` | base URL of the Paperclip API (e.g. `http://127.0.0.1:3100`) | `deploy-staging/compose.yaml` |
| `$PAPERCLIP_DISCORD_BRIDGE_TOKEN` | the bridge bearer token. **Every `/api/integrations/discord/*` operator call authenticates with this, not with an admin API key** — the routes call `assertBridge()` (`server/src/routes/discord-integrations.ts`), which 401s (`bridge_auth_required`) on anything else | `deploy-staging/secrets/*`, same value the bridge container runs with |
| `$COMPANY_ID` | the pilot company's UUID | `companies.id` |
| `$DISCORD_USER_ID` | the engineer's immutable Discord snowflake, never their display name | `discord_user_links.discord_user_id` |

Never print a bot token, bridge token, link code, or MinIO key into a shared channel.

---

## Incident index

| # | Symptom | Runbook | Who retries | Band-call effect |
| --- | --- | --- | --- | --- |
| 4 | Bot offline in Discord; DMs unanswered | [Discord gateway outage / disconnect](#4-discord-gateway-outage--disconnect) | System (outbound); inbound replay only once the DM surface ships | Discount the window if >15 min |
| 5 | Engineer's messages ignored, or "not linked" | [Discord account relink](#5-discord-account-relink) | Engineer (re-link, then resend) | Discount that engineer's gap |
| 6 | Photo arrives, evidence never appears | [Media-fetch failure](#6-media-fetch-failure) | Engineer (resend) | Invisible to the band — record in the capture-failure tally |
| 7 | Bot acknowledges, then goes quiet | [Agent runtime down](#7-agent-runtime-down) | System (replay) — **only after verifying inbound persistence**, else the engineer | Discount the window if >15 min |
| 8 | Evidence accepted but not filed | [Evidence store outage](#8-evidence-store-outage-local-disk-today-minio--nas-after-the-pilot-start-flip) | System (5-minute retry) — **only if the pending-write queue is holding it**, else the engineer | Discount; capture succeeded, storage failed |
| 9 | Cards stop mirroring to Teable | [Teable outage during PC-005 sync](#9-teable-outage-during-pc-005-sync) | System (backoff) | No effect — mirroring is not the wedge metric |
| 10 | No digest, or a digest-failure alert | [Digest alert response](#10-digest-alert-response) | Maintainer (manual send) | Affects the PM-engagement signal, not the band |
| 11 | Leaked/expired token, scheduled rotation | [Secrets rotation](#11-secrets-rotation) | Maintainer | Discount the planned window |
| 12 | Any outage longer than 15 minutes | [Downtime rule](#12-downtime-rule-op-ac9) | System notifies and the engineer waits — only once inbound persistence is verified live | Logged and discounted (segment split, §1) |
| 13 | Bot cannot take it at all | [Manual fallback — hand it to the PM](#13-manual-fallback--hand-it-to-the-pm) | Engineer → PM | Counts as `manual` in the ratio |
| 14 | WhatsApp rows | [Deferred](#14-deferred--whatsapp-rows-later-work-package) | — | Out of pilot scope |

---

## 1. Pilot facts and the band call

Read this before you decide anything during an incident. The band call is mechanical — it
is the PC-011 query output, not a judgment — so the only judgment you exercise during an
outage is **what to exclude from the measurement window**.

- Wedge metric `wp0_evidence_via_bot` = bot-filed acts over **every** filing act in the
  pilot window, counted on `issue_evidence_links` and `issue_attachments` (PC-011 AC1).
  Under the writer contract every act is `source='bot'` or `source='manual'`, so that is
  backlog's `bot/(bot+manual)`. The shipped query keeps the denominator at `count(*)`
  anyway (`server/src/services/evidence-provenance.ts`: "The denominator is count(*), NOT
  bot+manual") and reports anything outside that union as **`otherCount`** — `source` is a
  plain `text` column with no CHECK constraint, so a company-portability import or an
  out-of-contract writer can put a third value there. Those rows are real filing acts and
  stay in n. **Anywhere this page hands you counts to add up, `otherCount` adds up with
  them.** A non-zero `otherCount` is also a finding in its own right: name the writer in
  the incident note.
- Bands: **≥80% pass · 50–79% iterate one more week · <50% after one week = abort** and run
  the post-pilot channel comparison. Source of truth: the `metrics:` map in `backlog.md`.
- **Minimum n = 15 evidence items.** Below 15, extend the window; do not call the band.
- **Downtime is discounted, not averaged in — and the shipped query has no exclusion
  parameter, so there is exactly one way to do it.** `getWedgeMetric()` takes a single
  inclusive `from`/`to` range (`server/src/services/evidence-provenance.ts`); it cannot
  subtract an interval. Discount by **splitting the window, not by editing numbers**:

  1. Take the pilot window and cut out every downtime interval logged in §12. What is left
     is a list of contiguous **uptime segments**.
  2. Run `getWedgeMetric({ companyId, from, to })` once per segment.
  3. Sum **all three** counts each row carries, across the segments: `botCount`,
     `manualCount`, and `otherCount`.
  4. Call `callEvidenceWedgeBand(botTotal, manualTotal, otherTotal)` on those three sums —
     exported from the same module, and it takes three arguments. **Never re-derive the
     band or the n≥15 floor by hand**; that function is the band call, and it is what makes
     the result reproducible between two operators.

     `otherTotal` is normally 0, and dropping it looks harmless right up to the day it is
     not: the third argument defaults to 0, so a two-argument call is accepted silently,
     shrinks the denominator, and inflates the ratio toward `pass` — the unsafe direction,
     and enough to lift a real n≥15 sample back over the `extend_window` floor it should
     have fallen under. Pass it even when it is zero.

  Nothing else counts as discounting. Do not hand-subtract items you believe fell in a
  window, and do not eyeball the ratio: an unlogged outage silently depresses the ratio and
  can turn a passing pilot into a false abort, and a hand-adjusted one is not a measurement
  at all. (A one-call `excludeWindows` input would make this mechanical — filed as a
  follow-up on the PC-011 lane, not available today.)
- Op AC7's ≥90% card-matching bar separates "the verbs failed" from "the channel failed".
  When you triage an incident, record which of the two it was; that distinction is what the
  50–79% iterate band is diagnosed with.
- **The ratio is not the whole picture.** A capture that never became a row is invisible to
  it in both halves (§6). Every failed capture goes in the capture-failure tally, and that
  tally is reported alongside the band, never folded into it — otherwise a bot that drops
  evidence can read back as a `pass`.
- PM engagement is a **separate** signal: the PM reads/acts on the digest ≥4 of 5 pilot
  days. A missed digest (§10) hurts that signal, not the band.

---

## 2. What exists today

WP-0 is being built; this runbook is written to the pilot-start gate, so some rows cover
surfaces that land with their story. Check this table before you go hunting for a
component that is not there yet.

| Surface | Built today | Where |
| --- | --- | --- |
| Discord gateway, slash commands, delivery worker, outbox | **Yes** | `discord-bridge/`, `integration_event_outbox`, `discord_delivery_attempts` |
| Account link / unlink, link codes | **Yes** | `POST /api/integrations/discord/link-codes`, `.../link-codes/consume`, `.../unlink` |
| Object storage: the S3/MinIO provider exists in the server | **Yes** | `server/src/config.ts` (`PAPERCLIP_STORAGE_PROVIDER`, `PAPERCLIP_STORAGE_S3_*`), `docs/deploy/minio-nas-artifact-storage.md` |
| …but `t3-staging` is not running it — evidence bytes land on the container's **local disk** | **No — pilot-start gate item, §8** | `deploy-staging/paperclip-config.json` sets `storage.provider = "local_disk"` (`/paperclip/instances/default/data/storage`, on the `paperclip-data` volume); `deploy-staging/compose.yaml` sets only `PAPERCLIP_STORAGE_EXTERNAL_*` (the read-only open-file source), never `PAPERCLIP_STORAGE_PROVIDER` or `PAPERCLIP_STORAGE_S3_*` |
| Agent runtime (`eng-<name>` via Hermes gateway) | **Yes** | `packages/adapters/hermes-gateway`, PC-003 |
| Evidence gate on `done` | **Yes** | `server/src/services/issues.ts` (PC-001) |
| Vietnamese phrase table | **Yes** | `packages/shared/src/wp0-phrases.ts` (op AC10) |
| DM surface: message-content intent, DM auth gate, media fetch | **No — WP-0 pilot build** | privileged-intent request is on the critical path |
| Inbound capture persistence + replay on reconnect (op AC9) | **No — WP-0 pilot build** | no message handler and no inbound table in `discord-bridge/src/`; §4 and §7 depend on this |
| Capture pipeline, re-brief, PM digest | **No — WP-0 verbs 1–3** | |
| Pending-write queue + 5-minute replay for a rejected evidence write (op AC9) | **No — WP-0 pilot build** | no retry path in `server/src/services/assets.ts`; §8 depends on this |
| Evidence provenance `source` column | **Landing — PC-011** | `issue_evidence_links.source` / `issue_attachments.source`; needed before the band can be queried at all |
| Teable REST client | **No — PC-005 / PC-010** | no client exists in the repo today |

A row whose surface is not built yet still tells you the intended response; treat its
commands as the shape to implement against, and say so in the incident note rather than
inventing a workaround.

---

## 3. Alert routing and the daily watch

Op AC11: **all operator alerts land in one channel the maintainer demonstrably watches
daily.** Before pilot start:

1. Pick the single Discord channel (`$OPS_CHANNEL_ID`) and map it in the staging guild.
2. Route digest-failure, adoption-drop, and delivery error-rate alerts there — nowhere else.
   A second destination is a second thing to forget to watch.
3. **Test the digest-failure alert end-to-end (fires → seen) before pilot start.** An
   untested alert is a silent failure with extra steps.

Operator alerts are **English**; only engineer-facing copy is Vietnamese (backlog WP-0
language boundary). Do not translate an alert.

---

## 4. Discord gateway outage / disconnect

**Depends on — read this before you tell anyone not to resend.** This row spans two
halves with opposite maturity:

- **Outbound delivery is SHIPPED.** `integration_event_outbox` + `discord_delivery_attempts`
  + the bridge's delivery worker. The outbox row is written in the same transaction as the
  issue mutation and retries with backoff. Nothing queued for delivery is lost by a gateway
  drop.
- **Inbound capture persist-and-replay is NOT SHIPPED — it is WP-0 pilot build.** The
  shipped bridge constructs its client with `GatewayIntentBits.Guilds` only and has no
  `Events.MessageCreate` handler, no DM path, and no inbound message table
  (`discord-bridge/src/index.ts`; `discord-bridge/README.md`: "no message content or
  privileged intents"). Op AC9's persist-and-replay is an **acceptance criterion WP-0 has
  to meet**, not a guarantee you can lean on today. Until the DM surface lands, a message
  an engineer DMs during a gateway outage is **not stored anywhere**.

**Symptom.** The bot shows offline in Discord. Slash commands time out; DMs get no reply.
Notifications stop arriving in mapped channels. Engineers report "bot chết rồi".

**How you notice.**

- The delivery worker stops acknowledging: `discord_delivery_attempts` rows pile up in
  `pending` with `next_attempt_at` in the past.
- Bridge health probe fails:

  ```sh
  cd "$STAGING_DEPLOY_PATH"
  docker compose -f compose.yaml exec -T discord-bridge \
    node -e "fetch('http://127.0.0.1:8080/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
  docker compose -f compose.yaml logs --tail=200 discord-bridge
  ```
- `./scripts/healthcheck.sh` reaches its last check — the bridge — and fails there. The
  script is `set -eu` and short-circuits on the first failure, so getting as far as the
  bridge line *is* the signal that DB, server, and Hermes all passed, which isolates the
  fault to the transport. (The same property means it can never show you a *later* check
  after an earlier one fails — see §7.)

**What you do.**

1. Separate "Discord is down" from "we are down": check <https://discordstatus.com>. If
   Discord is degraded, stop here, log the window (§12), and wait. Restarting into a
   degraded gateway earns a rate-limit ban.
2. Otherwise restart the transport only — never the server:

   ```sh
   docker compose -f compose.yaml restart discord-bridge
   docker compose -f compose.yaml logs -f discord-bridge   # expect a fresh gateway READY
   ```
3. If it reconnects and immediately drops, suspect the token (§11) or a 4014 disallowed-intent
   error after an intent change — read the close code in the logs before rotating anything.
4. Confirm the backlog drains: `pending` deliveries fall to zero within a few poll intervals
   (`POLL_INTERVAL_SECONDS`, default 30).
5. If it does not recover in 15 minutes, roll back per `docs/rollback-discord-integration.md`.

**Who retries.** Answer it per direction, and **verify before you answer**:

- **Outbound (notifications, digests, bot replies): the system.** The outbox row is written
  in the same transaction as the issue mutation and delivery attempts retry with capped
  exponential backoff. Nobody needs to do anything.
- **Inbound (what the engineer sent): check first, then answer.** Run §7 step 1's guard
  before you say a word to the engineer — confirm inbound messages are actually being
  **persisted** (an inbound row exists for a message sent during the window). *If inbound
  persistence is not live — which is the case until the WP-0 DM surface ships — messages
  DM'd during the outage were never stored, and the engineer MUST resend.* Send them the
  phrase table's engineer-retry clause ("gửi lại giúp mình"). Telling them to sit tight on
  the strength of a persist-and-replay guarantee that does not exist yet loses their
  evidence permanently, and no retry anywhere in this system will bring it back.

Once inbound persistence is live and you have confirmed it, the default flips: engineers
must **not** resend, because a duplicate resend is worse than a delayed delivery, and if
§12's window is exceeded they get the `agent_downtime` message, which says the system
retries. Do not apply that default before the surface exists.

**Band-call effect.** Log the window (§12) and discount it. This is a channel-infrastructure
failure, not a verb failure — record it as such so a 50–79% outcome is not misdiagnosed.

---

## 5. Discord account relink

**Depends on:** shipped link-code endpoints (`/link-codes`, `/link-codes/consume`,
`/unlink`). The **DM auth gate** this row refers to is WP-0 pilot build (§2); today the
bridge reads no DMs at all, so an unlinked engineer's DM is ignored either way and nothing
is stored — which is why step 5's "ask them to resend" is correct now and stays correct
after the gate ships.

**Symptom.** A specific engineer's DMs are ignored while everyone else's work. Or:
"đã gửi rồi mà không thấy thẻ". Typical causes — the engineer switched Discord accounts,
their link was deactivated, or their Discord account is actively linked to a *different*
Paperclip user (`409 discord_account_already_linked`).

**How you notice.**

- One engineer only. Everyone else is fine.
- `discord_user_links` has no `active` row for that `discord_user_id` in the company, or it
  points at the wrong `user_id`.
- The DM auth gate drops the message (by design: DMs from unlinked Discord users are
  ignored — anyone can DM a bot).

**What you do.**

1. Confirm which Discord account they are actually DMing from — the immutable
   `discord_user_id`, not the display name.
2. If it is linked to the wrong Paperclip user, unlink first (this also disables that
   user's notification preferences):

   ```sh
   curl -fsS -X POST "$PAPERCLIP_URL/api/integrations/discord/unlink" \
     -H "Authorization: Bearer $PAPERCLIP_DISCORD_BRIDGE_TOKEN" \
     -H 'Content-Type: application/json' \
     -d '{"companyId":"'"$COMPANY_ID"'","discordUserId":"'"$DISCORD_USER_ID"'"}'
   ```

   Both fields are required: the body schema is `.strict()`, so a missing
   `companyId` or a stray extra key is a 400, and an admin API key is a 401
   (`bridge_auth_required`) — that 401 means *wrong credential*, not *Discord is
   down*, so do not escalate to §4 or §11 on it. `POST
   /api/integrations/discord/disconnect` is the **self-service** variant the
   engineer triggers from the UI; it is board-authenticated and scoped to the
   caller's own link, so it cannot unlink somebody else and is not an operator
   tool.
3. Issue a fresh link code from the UI (or `POST /api/integrations/discord/link-codes`) and
   give it to the engineer **directly, once**. Codes are single-use, expire in 10 minutes,
   and the server only stores the SHA-256 hash — you cannot look one up later, only reissue.
4. The engineer consumes it from Discord; verify an `active` row exists, then have the bot
   send the `welcome` message (`renderWp0Message("welcome", { name })` from
   `packages/shared/src/wp0-phrases.ts`) so they see the four verbs again.
5. Ask them to resend anything sent while unlinked. Nothing was stored — the gate drops
   unlinked DMs before persistence, deliberately.

**Who retries.** **The engineer**, after you relink. Use the phrase table's engineer-retry
clause ("gửi lại giúp mình") — never leave them guessing whether the system will catch up.

**Band-call effect.** Discount the gap for that engineer. A relink gap is an onboarding
defect (PC-003), not evidence that the channel failed.

---

## 6. Media-fetch failure

**Depends on:** the DM media path (WP-0 pilot build).

**Symptom.** The engineer sends a photo. The bot either says nothing or confirms and no
evidence link appears on the card. The card still fails the PC-001 gate on `done`.

**How you notice.**

- Bridge logs show a failed attachment download (expired CDN URL, 403, timeout, or a
  content type outside the allowlist).
- No `issue_evidence_links` / `issue_attachments` row for that capture; no `assets` row.
- The engineer is the first detector. Treat any "gửi ảnh rồi mà không thấy" report as this
  row until proven otherwise.

**What you do.**

1. Establish which side failed: **fetch** (we never got the bytes) or **store** (we got them
   and the evidence store rejected the write — that is §8, and the response is the opposite).
2. If the content type was rejected by the allowlist, that is correct behavior, not an
   outage. Tell the engineer what to send instead (photo or PDF, not a screen recording).
3. **Clear the capture's idempotency fingerprint before asking for a resend** (op AC9). If
   you skip this, their resend is dropped as a duplicate and you have manufactured a second,
   invisible failure.
4. Send `media_fetch_failed` from the phrase table (`renderWp0Message("media_fetch_failed",
   { item })`). It carries both facts the engineer needs: nothing was stored, so resend
   ("gửi lại giúp mình"), and the resend will not be rejected as a duplicate. It says that
   because step 3 cleared the fingerprint — if you skipped step 3, the message is now a
   lie, so do not send it before you have.
5. If several engineers hit it in one hour, stop treating it per-message: check Discord CDN
   status and the media allowlist config, and escalate to §4.

**Who retries.** **The engineer.** This is the one common failure where the bytes genuinely
do not exist on our side and there is nothing to replay.

**Band-call effect.** **Invisible to the band — which is why you must record it by hand.**
`wp0_evidence_via_bot` counts bot-filed acts over every filing act (§1) in
`issue_evidence_links` and `issue_attachments`. A failed media fetch writes **no row in
either table** (see "How you notice" above: no evidence link, no attachment, no `assets`
row), so it lands in neither the numerator nor the denominator. It does not depress the ratio; it does not appear in it.
The pathological case is real: if half of all photos fail and the engineer quietly gives up,
20 bot / 0 manual reads back as 100% `pass` on a bot that dropped half the evidence it was
handed. **The ratio alone cannot detect this failure mode.**

So:

- Do **not** log it as a downtime window (§12) — discounting a window it never entered
  changes nothing and corrupts the segment split in §1.
- **Do** record every §6 incident in the mis-file / capture-failure tally that op AC7
  already requires ("the live mis-file rate is tracked so a 50–79% band outcome can be
  diagnosed as a channel problem vs an accuracy problem"). One row per failed capture:
  date, engineer, card if known, failure type (expired CDN URL · 403 · timeout · content
  type outside the allowlist · store rejected), and whether the resend succeeded. Keep it
  beside the §12 downtime log for the pilot; it needs a queryable home (an `activity_log`
  action on the capture-failure path) before the next pilot — see the follow-up.
- Report that tally **next to** the band at pilot end, never folded into it. A `pass` band
  with a fat capture-failure tally is an accuracy problem wearing a passing number.

---

## 7. Agent runtime down

**Depends on:** Hermes gateway + `eng-<name>` agents (PC-003, shipped adapter) **and the
WP-0 inbound persistence layer, which is not shipped** — see §4. This row's whole premise
is that the transport kept receiving while the brain was down; that premise is only true
once the DM surface and its inbound store land.

**Symptom.** The bridge is online (bot shows online, slash commands still reply) but
conversational turns get no answer: no capture confirmation, no re-brief. The gap between
"transport up" and "brain up" is the tell.

**How you notice.**

Probe the two surfaces **independently**. `./scripts/healthcheck.sh` is `set -eu` and runs
db → paperclip → Hermes → bridge in that order, so it stops at the first failure: when
Hermes is down it exits there and never prints a bridge line. It cannot show you the
transport-up / brain-down contrast this row is built on — only these two commands can.

```sh
cd "$STAGING_DEPLOY_PATH"
# brain: expect this one to FAIL
docker compose -f compose.yaml exec -T paperclip \
  curl --fail --silent --show-error "${HERMES_API_BASE_URL:-http://host.docker.internal:8642}/health"
# transport: expect this one to PASS
docker compose -f compose.yaml exec -T discord-bridge \
  node -e "fetch('http://127.0.0.1:8080/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
# server itself, to rule out §4/§8
docker compose -f compose.yaml exec -T paperclip \
  curl --fail --silent --show-error http://127.0.0.1:3100/api/health
```

Also check the agent is not paused for a non-outage reason before you page anyone: a budget
hard-stop pauses agents by design, and that is a spend event, not an incident.

**What you do.**

1. Confirm inbound messages are still being **persisted** — op AC9 requires the bridge to
   store inbound messages independently of agent availability, and WP-0 is what builds
   that. Check for an inbound row written during the outage window before you assume it.
   If messages are not being persisted, captures are being **lost, not delayed**: tell the
   affected engineers to resend ("gửi lại giúp mình") and, if the surface was supposed to
   be live, treat it as a P1 and fix that first.
2. Restart the Hermes relay / gateway per `doc/HERMES_GATEWAY_ONBOARDING.md`; restart the
   Paperclip service only if `/api/health` itself is failing.
3. Watch the replay drain on recovery, then send `agent_recovered` from the phrase table to
   each affected engineer with the count of replayed messages.
4. If downtime crosses 15 minutes, §12 applies — send `agent_downtime` **once per engineer**,
   not once per message.

**Who retries.** **The system — once step 1 has confirmed it can.** Persist-and-replay is
the contract WP-0 must deliver; when it is live and verified, the engineer is told to wait,
in those words ("mình sẽ thử lại trong 5 phút"). If step 1 shows nothing was persisted, the
engineer retries instead ("gửi lại giúp mình") and the broken persist-and-replay path is
itself the incident to file. Never send the wait message on assumption.

**Band-call effect.** Log and discount the window (§12).

---

## 8. Evidence store outage (local disk today, MinIO / NAS after the pilot-start flip)

**Depends on — establish which storage provider this deployment actually runs before you
probe anything.** Two independent gaps, and the first one is a configuration fact, not a
missing feature:

- **The S3/MinIO provider is shipped in the server, but `t3-staging` is not configured to
  use it.** `deploy-staging/paperclip-config.json` sets `storage.provider = "local_disk"`
  with `localDisk.baseDir` `/paperclip/instances/default/data/storage` (the `paperclip-data`
  volume), and `deploy-staging/compose.yaml` sets only the `PAPERCLIP_STORAGE_EXTERNAL_*`
  family — the least-privilege **read** source behind the artifact open-file flow — never
  `PAPERCLIP_STORAGE_PROVIDER` or `PAPERCLIP_STORAGE_S3_*`. **As deployed today, evidence
  bytes never reach the NAS, so a MinIO/NAS outage cannot be the cause of a filing failure,
  and a MinIO health probe during an incident is a green light that means nothing.**
  **Pilot-start gate item (§2), decide before the pilot runs:** either switch the staging
  deployment to the s3 provider so this row reads as titled, or accept local disk and work
  the local-disk branch below. A deployment change lands in its own reviewed pipeline PR —
  never edit `deploy-staging/` from this page.
- **The pending-write queue is WP-0 build.** A queue that holds a rejected evidence write
  and replays it on a 5-minute cycle does **not** exist — there is no such retry path in
  `server/src/services/assets.ts` today. Op AC9 names the 5-minute reply ("mình sẽ thử lại
  trong 5 phút"), so WP-0's capture pipeline has to build the queue that sentence promises.
  Until it exists, a rejected write is simply lost, and this row's "do not resend"
  instruction is wrong — see step 3.

**Symptom.** Captures are understood and acknowledged, but evidence does not land: no
attachment on the card, gate still blocks `done`. On **local disk** (today) the server log
shows a filesystem write failure under `/paperclip/instances/default/data/storage` — no
space, permissions, or a read-only volume. On the **s3 provider** (only after the flip)
upload errors reference the NAS endpoint (`nas-storage-t19.tail9831b.ts.net:9000`) —
connection refused, 5xx, or an auth error on the `paperclip-artifacts` bucket.

**How you notice.**

- **First, read the provider off the running container** — everything below branches on it,
  and the answer today is `local_disk`:

  ```sh
  cd "$STAGING_DEPLOY_PATH"
  docker compose -f compose.yaml exec -T paperclip \
    sh -lc 'printenv PAPERCLIP_STORAGE_PROVIDER; grep -A4 storage /etc/paperclip/config.json'
  ```

  An empty env var and `"provider": "local_disk"` means the NAS is not in the write path.
- `local_disk`: server logs show filesystem write errors (ENOSPC, EACCES, read-only fs)
  against the storage base dir; the `paperclip-data` volume is full or unwritable.
- `s3`: server logs show S3 write failures against `PAPERCLIP_STORAGE_S3_ENDPOINT`; the NAS
  is unreachable over the tailnet, or the MinIO service is down.
- Either way: a cluster of failures across engineers at the same moment — unlike §6, which
  is per-message.

**What you do.**

1. Probe the store the server is actually writing to, from inside the server container —
   not from your laptop.

   **`local_disk` (today's staging):**

   ```sh
   docker compose -f compose.yaml exec -T paperclip sh -lc '
     df -h /paperclip
     ls -ld /paperclip/instances/default/data/storage
     touch /paperclip/instances/default/data/storage/.probe &&
       rm /paperclip/instances/default/data/storage/.probe &&
       echo writable'
   ```

   **`s3`, only once the provider has been flipped** — the tailnet path is what matters:

   ```sh
   docker compose -f compose.yaml exec -T paperclip \
     sh -lc 'curl --fail --silent --show-error "${PAPERCLIP_STORAGE_S3_ENDPOINT:-http://nas-storage-t19.tail9831b.ts.net:9000}/minio/health/live"'
   ```

   The `sh -lc` matters: the variable has to expand **inside** the container, where the
   value lives. Written bare, your host shell expands it first, it is empty there, and you
   get `curl: (3) ... missing URL` against `/minio/health/live` — a broken command that
   reads like a broken endpoint and sends you off restoring a NAS you never tested. On a
   `local_disk` deployment the variable is unset even inside the container, so this probe
   tests the hardcoded default and tells you nothing about where evidence went: that is
   exactly why step 1 branches on the provider instead of always probing MinIO.
2. `local_disk`: reclaim space or fix permissions on the `paperclip-data` volume, and check
   the backup dir on the same volume is not what filled it. `s3`: if MinIO is down, restore
   it on the NAS; if the tailnet is down, fix connectivity; if it is an auth error, the
   scoped credential (`paperclip-artifacts`) has expired or been rotated out from under the
   secret refs — go to §11.
3. **Confirm the write is actually queued before you promise a retry.** Look for the pending
   write for that capture. If the queue is live and holding it, do not tell engineers to
   resend — the bytes are accepted and the write replays. If there is no queue yet (see
   **Depends on**), the bytes are gone and the engineer must resend once storage is back;
   send the engineer-retry clause ("gửi lại giúp mình"), not `storage_unavailable`.
4. Once the queue is confirmed holding the write, send `storage_unavailable` from the phrase
   table. It names the card and states plainly that the system retries and they need not
   resend — which is true only in that case.
5. On recovery, verify the queued writes landed and the evidence links exist on the affected
   cards before you close the incident — a silently dropped queue is a PC-001 gate failure a
   week later.

**Who retries.** **The system**, on a 5-minute cycle — the case op AC9 names verbatim
("mình sẽ thử lại trong 5 phút") — **once the pending-write queue exists and step 3 has
confirmed this write is in it.** Otherwise the engineer retries, and the missing queue is
its own P1.

**Band-call effect.** Discount the window. The capture verb worked; storage did not.

---

## 9. Teable outage during PC-005 sync

**Depends on:** PC-005 mirror / PC-010 tabular writes. **No Teable client exists in the repo
today** — this row is the intended response, and the shape PC-005 must implement.

**Symptom.** Cards stop appearing or updating in the "Tecotec CN" base. The PM says the
board is stale. Sync latency exceeds the 5-minute target
(`pc005_teable_mirror_latency_minutes`).

**How you notice.**

- Sync failures surface in the activity log and retry with backoff (PC-005 AC4) — query
  `activity_log` for the sync action, filtered to the pilot company.
- The Teable instance is unreachable or returning 5xx.
- Verb-4 tabular writes (PC-010) fail with the same signature.

**What you do.**

1. Confirm it is Teable and not us: reach the Teable API directly. If Teable is down, there
   is nothing to fix on our side — the retry/backoff is the design.
2. **Do not disable the mirror to stop the noise.** Direction is Paperclip → Teable and
   Teable-side edits are flagged as conflicts, never overwritten; a disabled mirror silently
   diverges the board and the conflict flags fire in a batch when you re-enable it.
3. Tell the PM directly (Vietnamese, one line, from the phrase table's tone — the board is
   stale, cards are safe, no action needed from them). The **cards are the record**; Teable
   is the GUI over them. Nothing is lost while it is down.
4. On recovery, confirm the backlog drains within the 5-minute latency target and no
   conflict flags fired on the bot's own rows (PC-010 AC6 write attribution exists precisely
   so this cannot happen).

**Who retries.** **The system**, with backoff. Engineers and the PM do nothing.

**Band-call effect.** **None.** Teable mirroring is not the wedge metric, and evidence
filing does not depend on it. Say so explicitly in the incident note so a Teable outage is
never used as an excuse for a weak ratio.

---

## 10. Digest alert response

**Depends on:** WP-0 verb 3 (PM digest). **Not built yet.**

**Symptom.** The PM/CTO did not get the daily digest, or a digest-failure alert fired in
`$OPS_CHANNEL_ID`.

**How you notice.** Op AC5: **digest delivery failure raises an operator alert** — a
silently missing digest is the exact failure mode that recreates the PM's manual summary
and quietly kills the pilot's value story. An empty day is **not** a failure: it still
sends the one-line `digest_empty` message so absence is visible.

**What you do.**

1. Determine which half failed: **generation** (the digest was never built) or **delivery**
   (built, but the DM did not land — a delivery-attempt failure, §4).
2. Delivery half: check `discord_delivery_attempts` for the PM's and CTO's DM recipients.
   `terminal_failure` on a DM usually means the recipient's DMs are closed or they never
   linked — that is §5, and it is a pre-pilot checklist item (both accounts linked as digest
   recipients before pilot start).
3. Generation half: fix and **re-send the same day's digest manually.** A skipped day is a
   lost PM-engagement data point that cannot be recovered later.
4. If the alert did not fire and you found out from the PM, that is a second incident: fix
   the alert (§3) before the next pilot day.

**Who retries.** **The maintainer**, by hand, same day. Do not wait for tomorrow's run.

**Band-call effect.** None on `wp0_evidence_via_bot`. It hits the **PM engagement signal**
(≥4 of 5 pilot days), which is a separate pilot gate — note which day was missed and why.

---

## 11. Secrets rotation

**Depends on:** shipped. Follows `docs/rollback-discord-integration.md` §6.

**Symptom.** Either scheduled rotation, or a credential incident: the bridge authenticates
then immediately disconnects; `401 Discord bridge is not configured`; MinIO returns auth
errors; a token appeared somewhere it should not have (a log, a screenshot, a chat).

**Secrets in play.** `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`,
`PAPERCLIP_DISCORD_BRIDGE_TOKEN` / `PAPERCLIP_API_KEY` (bridge-scoped, authorized only for
`/api/integrations/discord/*`), and the MinIO credential — which today is referenced as
`PAPERCLIP_STORAGE_EXTERNAL_ACCESS_KEY_SECRET_REF` /
`PAPERCLIP_STORAGE_EXTERNAL_SECRET_KEY_SECRET_REF` (Docker secrets
`paperclip_artifacts_access_key` / `paperclip_artifacts_secret_key`, `deploy-staging/compose.yaml`),
because staging runs the local-disk storage provider and uses MinIO only as the read-only
artifact open-file source (§8). The `PAPERCLIP_STORAGE_S3_ACCESS_KEY_SECRET_REF` /
`PAPERCLIP_STORAGE_S3_SECRET_KEY_SECRET_REF` pair applies **only after** the pilot-start
flip to the s3 provider; rotate whichever pair the deployment actually sets, and check
before you assume. None are stored in the DB, returned by any API, or sent to the frontend.
Link codes are stored only as SHA-256 hashes.

**What you do.**

1. **Announce the window first.** Rotation is planned downtime; §12 applies to it exactly as
   it does to an outage. Log it before you start.
2. Rotate at the source: the Discord Developer Portal for the bot token; the operator secret
   manager for the bridge token; MinIO IAM for the storage credential (the scoped
   `paperclip-artifacts` identity, never a NAS admin key).
3. Update the protected `discord-staging` GitHub Environment secrets, or rewrite
   `deploy-staging/secrets/*` on the host, so the two do not drift.
4. Restart and verify:

   ```sh
   cd "$STAGING_DEPLOY_PATH"
   docker compose -f compose.yaml up -d --build
   ./scripts/healthcheck.sh
   ```
5. If the rotation was triggered by a leak, **disable channel mappings until validation
   completes**, and treat any evidence filed during the exposure window as suspect.
6. Never paste a rotated value into the ops channel to "check it worked" — verify by health
   probe, not by eye.

**Who retries.** **The maintainer.** Engineers are told nothing unless the window crosses 15
minutes, in which case §12's message goes out like any other downtime.

**Band-call effect.** Discount the planned window. An unannounced, unlogged rotation that
eats an afternoon of the pilot is a self-inflicted band failure.

---

## 12. Downtime rule (op AC9)

One rule, applied to every section above.

0. **Before either branch: confirm inbound persistence is live** (§4, §7 step 1). Both
   branches below assume messages sent during the window are stored and replayed. Until the
   WP-0 DM surface ships that is false, and the correct message is the engineer-retry one
   ("gửi lại giúp mình"), at any duration. Do not send `agent_downtime` on an unverified
   persistence claim — it tells the engineer "tin nhắn đã lưu, không mất", and if nothing
   was stored that sentence is what loses their evidence.
1. **Under 15 minutes:** say nothing. Persist, replay, let it heal. A status message for a
   4-minute blip trains engineers to distrust the bot.
2. **Over 15 minutes:** send **one** automated Vietnamese status message **per affected
   engineer** — `agent_downtime` from `packages/shared/src/wp0-phrases.ts`, which states that
   messages are stored, nothing is lost, and the system retries. One per engineer, not one
   per queued message.
3. **Log every window** in the pilot-day downtime log — start, end, which surface, which
   engineers were affected, and whether captures were persisted throughout:

   | Date | Start | End | Surface (§) | Engineers affected | Captures persisted? | Runbook section |
   | --- | --- | --- | --- | --- | --- | --- |

4. **The band call discounts logged windows — by the segment-split recipe in §1, and only
   by that.** The start/end columns above are not documentation; they are the cut points
   that turn the pilot window into the uptime segments you run `getWedgeMetric()` over. A
   window logged without an exact start and end cannot be discounted at all. Unlogged
   downtime is indistinguishable from engineers choosing not to use the bot — which is
   precisely the signal the pilot exists to measure. Logging is not paperwork; it is what
   keeps the abort criterion honest.
5. On recovery, send `agent_recovered` with the replayed count, and confirm the replayed
   captures actually produced evidence rows before you call it clean.

---

## 13. Manual fallback — hand it to the PM

Op AC8 requires the engineer's realistic fallback to be written down, not implicit. It is
this, and it is not a failure:

> **When the bot cannot take it, the engineer hands it to the PM.** Photo, message, or a
> word in person — whatever is fastest in the field. The PM files it through the Paperclip
> UI against the right card. That filing act records `source='manual'` (PC-011 AC2).

Why it is written down rather than tolerated silently:

- The work still gets recorded. The PC-001 evidence gate passes on a manually filed
  attachment exactly as it does on a bot-filed one — nothing is blocked by the bot being down.
- The wedge metric stays honest. Every fallback filing lands in the `manual` half of the
  ratio, which is what makes `wp0_evidence_via_bot` a real measurement instead of a
  self-fulfilling one. **Do not backfill fallback filings as `bot` to make the number look
  better** — that is falsifying the pilot's only decision input.
- It bounds the blast radius of every incident above. No outage on this page can lose a
  day's work; the worst case is that the day's work is filed by the PM and counts as manual.

Tell the engineer this once, at onboarding (PC-003 quickstart), not for the first time
during an outage.

---

## 14. Deferred — WhatsApp rows (later work package)

**Not pilot scope.** The pilot is Discord-only (owner gate decision, 2026-09-02). WhatsApp
re-scopes to a later work package taken up only after the four verbs prove out; the
channel comparison (WhatsApp Business vs Zalo OA — usage, API capability, cost including the
2026-10-01 per-message AI-reply billing change) runs as a post-pilot input to that decision.

The following rows are **deferred** and must not be written or read as active procedure.
They are listed so their absence is deliberate rather than an oversight, and so the later
WP inherits a named gap list:

| Deferred row | Activates with | Channel-generic intent that applies to the Discord pilot now |
| --- | --- | --- |
| WhatsApp platform outage | later WhatsApp WP | Covered by §4 (Discord gateway outage). Note §4's split: outbound delivery retry is shipped; inbound persist-and-replay is WP-0 build on Discord too, so it is not a guarantee either channel offers today |
| Message-template rejection | later WhatsApp WP | No proactive-window constraint exists on Discord; nothing to run today |
| Phone-number remap (engineer changes number/device) | later WhatsApp WP | Covered by §5 (Discord account relink) — the identity-rebinding procedure |
| Webhook signature / raw-body verification failure | later WhatsApp WP | Replaced in the pilot by the **DM auth gate**: DMs from unlinked Discord users are ignored (§5) |
| Meta per-message AI-reply spend alarm | later WhatsApp WP | Pilot LLM spend runs under the existing budgets subsystem and AD-037 `max_turns` |

If you are reading this page during a WhatsApp incident, you are on the wrong page and the
later work package has landed without updating this section — fix that first.

---

## 15. Verification coverage

What is covered by an automated test today, and what is covered only by this page.

| Behavior | Covered by |
| --- | --- |
| Vietnamese phrase table: no alias collides across verbs, every verb has a phrase, every message template names only phrases the table answers to — as `{{phrase.*}}` tokens **and** as literal quoted text — and each failure message states exactly one retry owner | `packages/shared/src/wp0-phrases.test.ts` |
| No template tells an engineer to ask the bot for a card action no verb resolves (cancel / delete / reassign) | `packages/shared/src/wp0-phrases.test.ts` |
| A bare card number ("T3-142", "142") is classified as a correction turn, not as unknown input — and only when a capture is actually pending, so a standalone number from an engineer with nothing pending never re-files evidence | `packages/shared/src/wp0-phrases.test.ts` (`resolveWp0CardReference`, `classifyWp0Inbound`) |
| The correction copy asks for the card number in the one shape the resolver answers to (number alone), and every example it shows resolves | `packages/shared/src/wp0-phrases.test.ts` |
| Four-line welcome message; gate rejection names the card, the accepted evidence types, and the filing phrase | `packages/shared/src/wp0-phrases.test.ts` |
| Evidence gate blocks `done` with zero evidence links (PC-001) | `server/src/__tests__/issue-evidence-gate.test.ts` |
| Discord bridge transport contracts (link/consume/unlink, delivery ack, idempotency) | `server/src/__tests__/` Discord integration suites; `discord-bridge/src/**/*.test.ts` |
| Staging bring-up (DB, server, Hermes, bridge health) | `deploy-staging/scripts/healthcheck.sh` |
| Digest-failure alert fires and is seen | **Manual, pre-pilot (§3).** Op AC11 requires this end-to-end test before pilot start; there is no automated coverage. |
| Downtime logging and band discounting | **Manual (§12).** Nothing enforces it — it is a discipline, and the band call depends on it. The discount itself is a multi-call segment split (§1); the shipped query has no window-exclusion input, and nothing checks that the operator carried all three per-segment counts (`botCount`, `manualCount`, `otherCount`) into `callEvidenceWedgeBand`. |
| Which storage provider the pilot deployment actually runs | **Manual (§8 step 1).** No test asserts the deployed config matches this runbook; `deploy-staging/paperclip-config.json` is the fact, and it says `local_disk`. |
| Inbound capture persistence and replay across a gateway/agent outage (op AC9) | **Not built, not covered.** No message handler or inbound store exists in `discord-bridge/src/` (§2, §4). Every "the system retries, do not resend" instruction on this page is conditional on this landing and being verified. |
| Pending-write queue and 5-minute replay for a rejected evidence write (op AC9) | **Not built, not covered.** No retry path in `server/src/services/assets.ts` (§2, §8). |
| Capture failures (§6) reaching a report at all | **Manual tally (§6).** They write no row, so no query finds them. |
| Every row in the incident index above | **Manual.** These are procedures, not code paths. |

Run the phrase-table test from the repo root:

```sh
pnpm exec vitest run packages/shared/src/wp0-phrases.test.ts --reporter=dot
```
