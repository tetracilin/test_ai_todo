---
name: wp-close-export
description: >-
  Export a Workpackage close record (dossiers, activity, artifacts, summary)
  from Paperclip into the wiki-internal repo under wp-records/<WP-id>/.
version: 0.1.0
author: Hermes Agent (t3-backend)
license: MIT
platforms: [linux]
metadata:
  hermes:
    tags: [paperclip, workpackage, export, wiki, t3-pmide, close, dossier, evidence]
    related_skills: [paperclip-self-hosting, paperclip-board, teable-data-operations]
---

# wp-close-export — Workpackage close export (T3 PM-IDE, WP-T3-PMIDE-MVP-001 §1.8)

Turn a Workpackage ID into a close-out record in the **wiki-internal repo**
(`Tecotec-JSc/T3-wiki`, checked out at `/root/T3-wiki` on this host — the same
repo that is also called "wiki-internal"; see PATCH-003/AD-026 for the naming
and the confidential-data split).

## When to use

- A WP has ended (two-week trial slice, day-14 review, or any WP close) and the
  CTO/PM asks for the export.
- You need the evidence coverage, scope-change history, or artifact inventory of
  a WP as a durable, reviewable record.

## Input

A **Workpackage ID** — the `WP-xxx` token used in engineer card titles
(`[WP-xxx] <job order>`, card contract §1.4), e.g. `WP-001`, `wp-demo-001`.

The skill resolves cards as Paperclip issues whose title starts with
`[<WP-ID>]` (case-insensitive) in the configured company. Optionally pass
`--project-id` to restrict to a Paperclip project.

## Output (written to the wiki-internal repo)

`wp-records/<WP-ID>/` in `/root/T3-wiki`:

| File | Contents |
|---|---|
| `dossiers/<card-identifier>.md` | One per card: the card's dossier.md body (first comment per card contract §1.4, fixed headings Job order / Clarifications / Evidence / Scope changes / Related Teable rows) plus a small header with card id/title/status/tier |
| `activity.jsonl` | Paperclip `activity_log` rows for those cards (one JSON object per line, chronological) |
| `artifacts.csv` | `object_key,card,size,sha256,tier` — every evidence object: `issue_attachments`→`assets` rows, plus `evidence:` links found under the dossier `## Evidence` heading that are missing from `assets` |
| `summary.md` | Cards count, evidence coverage %, scope-change events with timestamps vs meeting dates, time-to-replan (per-card and per-WP), plus the Teable-sync stubs (§1.7) and the source metadata |

**Confidential dossiers (AD-026):** if a card is labelled `tier:confidential`,
its dossier body is written ONLY into the NAS-only wiki directory
(`WP_CLOSE_EXPORT_NAS_WIKI_DIR`, default `/mnt/nas/wiki-internal/wp-records`)
and the shared-repo copy is replaced by a stub that states the confidential
record was withheld to the NAS. Never let confidential content be written into
the shared repo. If the NAS dir is not available/writable, the export for that
card fails with a clear error and the shared-repo dossier is NOT created (fail
closed).

## Procedure (the script does all of this; run it, do not hand-roll)

```bash
python3 hermes-skills/wp-close-export/scripts/wp_close_export.py WP-001 \
  --wiki-dir /root/T3-wiki \
  --company-id <company-uuid> \
  [--nas-wiki-dir path] [--project-id <uuid>] [--dry-run]
```

Env vars the script reads (all optional, checked before CLI flags):
- `TEABLE_API_KEY` (or `/root/.hermes/.env`) — used only to fetch the Meetings
  table dates for the scope-change-vs-meeting analysis. If absent, the
  comparison columns are marked `UNKNOWN (no Teable key)` — never invent dates.
- `WP_CLOSE_EXPORT_NAS_WIKI_DIR` — NAS-only wiki directory for confidential
  dossiers (AD-026). Default `/mnt/nas/wiki-internal/wp-records`.
- `PAPERCLIP_*` — not used; data is read from the production Postgres via
  `docker exec t3-prod-db-1 psql` (matches the paperclip-self-hosting skill).
  Override the container with `--db-container`.

Then:
1. **Verify the source of truth** — read `deploy/paperclip-config.json` in the
   canonical repo to confirm the prod DB container name, and check
   `/root/T3-wiki` is on `main` and clean before writing.
2. **Run the script** with `--dry-run` first (prints the card list + planned
   files, writes nothing), then for real.
3. **Check the tier triage**: every card labelled `tier:confidential` must be
   listed in the `--dry-run` output under a NAS routing notice. If the NAS dir
   cannot be reached, do NOT proceed — surface the block to the user instead of
   writing confidential content to the shared repo.
4. **Commit in the wiki repo**: after a real run, `git add wp-records/<WP-ID>/`
   (plus the `wp-records/README.md` and `log.md`/`index.md` updates), commit
   with message `wp-records(<WP-ID>): close export — <N> cards, <X>% evidence`,
   and push when the user asks. Do NOT commit confidential stub files without
   the NAS routing notice.
5. **Report** to the user: path to `summary.md`, cards count, evidence coverage
   %, number of confidential cards routed to NAS.

## Output contract details (match exactly)

- **Dossier detection**: the FIRST comment on the card (contract §1.4 —
  `dossier.md` is created before any other comment). Same rule as the MVP-01
  done-gate (first-comment-dossier semantics). One `.md` file per card under
  `dossiers/`, named `<identifier>.md` (fallback: issue UUID). Include the
  dossier body verbatim under the header.
- **Evidence counting** (for summary.md coverage): attachments
  (`issue_attachments`→`assets`) always count; `evidence:` links count only
  inside the `## Evidence` section of the first-comment dossier (bound at the
  next H1/H2 heading — the MVP-01 gate rule). `PENDING STORAGE:` placeholders
  do NOT count. Confidence-tier files stored outside the bot are listed as
  evidence only if referenced in the dossier.
- **Scope-change events**: lines under `## Scope changes` matching
  `- <ts> — ...` (ISO-8601 timestamps, as written by the engineer-assistant
  contract rule 3). Compare each event's timestamp to the weekly meeting dates
  from the Teable Meetings table (`tbllNPP0tDOltxr0etj`, field `Date`):
  - `scope_change_at` — event timestamp
  - `next_meeting_date` — first meeting date >= event timestamp
  - `days_to_meeting` — (next_meeting_date − scope_change_at) in days
  - `time_to_replan_days` — same as days_to_meeting (the lag before the next
    planned review); negative means the event was logged AFTER the prior
    meeting (missed the review window) — flag it.
- **Teable-sync stubs (§1.7, not landed yet)**: the summary.md MUST include a
  `## Sync stubs` section listing which fields come from the Teable sync that
  has not shipped yet (paperclip_card_id, evidence_count columns, §1.7):
  compute evidence from Paperclip tables directly as above; never guess the
  Teable column value.

## Confidential handling (AD-026/PATCH-003 — read before any export)

- Tier comes from the card labels: exactly one of `tier:open`,
  `tier:internal`, `tier:confidential` (see card contract §1.4).
- `tier:confidential` dossier BODY goes to the NAS-only wiki dir; the shared
  repo gets a stub. `tier:internal` is fine in the shared repo (it is
  company-internal, not NAS-only).
- The `artifacts.csv` tier column must reflect the card's tier; confidential
  artifacts appear in the CSV (metadata only — keys/sizes/hashes are not the
  file contents) — that is allowed; the DOSSERS are what must not leave the
  NAS scope.

## Pitfalls (learned on this host)

- The prod Paperclip API on 127.0.0.1:33100 rejects the board token from
  `~/.paperclip/auth.json` (agent-token mismatch); use the Postgres path via
  `docker exec`, not the HTTP API.
- Embedded Postgres rules don't apply — `docker exec t3-prod-db-1
  psql -U paperclip -d paperclip` runs as root without a password.
- `dossiers/` filenames: strip `/`, spaces, and non-ASCII from the identifier
  (Vietnamese diacritics) when building the file name.
- The wiki repo has its own conventions (`log.md` append-only, `index.md`
  catalog) — update both, keep the commit message short and the diff focused.
- NEVER commit `.env`, tokens, or S3/MinIO keys into the wiki repo. The script
  prints no secrets; keep it that way when you extend it.