# wp-close-export — contract references

Evidence-backed facts this skill relies on. All facts were verified against the
host on 2026-08-31 (MVP-03 build session).

## Card contract (WP-T3-PMIDE-MVP-001 §1.4, encoded by MVP-02)

`agents/engineer-assistant.md` (branch `t3-paperclip-aitodo/t_704f2ee9-...`,
commit `614ad1075`) fixes the dossier contract:

- Title: `[WP-xxx] <job order>`
- Labels: `tier:open|internal|confidential`, `owner:<name>`
- First comment = `dossier.md`, with five fixed headings, in order, always
  present: `## Job order`, `## Clarifications`, `## Evidence`,
  `## Scope changes`, `## Related Teable rows`.
- Evidence object key: `t3-evidence/<card-id>/<yyyymmdd>-<original-name>`,
  collision suffix `-2`, `-3`.
- Agent rule 2: evidence storage backend is the `t3-evidence` bucket on NAS
  MinIO (WP prerequisites 1.1/1.2, cards MVP-04 / infra work); before that
  lands, failures degrade to `PENDING STORAGE:` log lines, never fabricated
  links.
- Agent rule 3: out-of-scope work logged under `## Scope changes` with
  timestamp + `@pm` mention.
- Agent rule 4: Done refused at `evidence_count == 0` (paired with MVP-01).

## Evidence-count semantics (MVP-01 done-gate, merged INTO the fork)

Verified in `server/src/services/issues.ts` (branch
`t3-paperclip-aitodo/t_009eb4b7-...`, commit `7f378bfcc`):

- Evidence = `issue_attachments` rows (always) + `evidence:` links under the
  dossier's `## Evidence` heading.
- Only the FIRST comment is the card's dossier.
- The Evidence section is bounded at the next H1/H2 heading (`## Scope
  changes` content does NOT count as evidence).
- `PENDING STORAGE:` placeholders do NOT count.
- Threshold for Done: `>= 1` evidence.

`wp-close-export` reuses exactly these rules so the export's evidence coverage
agrees with what the done-gate enforced.

## Wiki-internal repo naming (PATCH-003)

The Duty Wiki repo is `Tecotec-JSc/T3-wiki` (git remote
`https://github.com/Tecotec-JSc/T3-wiki.git`), checked out at `/root/T3-wiki`
on this host. The MVP plan references it as "wiki-internal" — one repo, two
names. Writes land under `wp-records/<WP-ID>/` with the wiki's conventions
(`log.md` append-only updates, `index.md` catalog, short focused commits,
no secrets).

## Confidential handling (AD-026)

- `tier:confidential` dossier bodies must NEVER be written into the shared
  `Tecotec-JSc/T3-wiki` repo; they go into the NAS-only wiki directory
  (`WP_CLOSE_EXPORT_NAS_WIKI_DIR`, default `/mnt/nas/wiki-internal/wp-records`).
- On 2026-08-31 the NAS NFS mount was still pending (`/mnt/nas-backups`
  empty; WP execution log item 0.4: "NAS side has not exported that share for
  NFS yet"). The skill therefore FAILS CLOSED when a confidential dossier
  cannot be routed to the NAS dir: no shared-repo dossier file for that card,
  and the summary lists it as withheld.
- `tier:internal` is fine in the shared repo (company-internal, not
  NAS-only).
- `artifacts.csv` may list confidential object keys/sizes/hashes — that is
  metadata, not file content, and is part of the close record.

## Teable sync dependency (§1.7 — NOT landed)

Verified 2026-08-31: the Teable `Task` table (`tbln5nGviqqKLGL43UX`) and
`Workpackage` table (`tblEFaEr2A0Sc3ZMTkR`) have NO `paperclip_card_id` /
`evidence_count` columns yet. `summary.md` marks these as `## Sync stubs`
instead of inventing values. Meetings dates come from the Teable Meetings
table `tblmuAqQQm9erzrU5AA` (field `Date`) when `TEABLE_API_KEY` is present;
otherwise scope-change comparisons are marked UNKNOWN, never guessed.

## DB access on this host

- Paperclip prod: container `t3-prod-paperclip-1`, port 127.0.0.1:33100,
  DB at `docker exec t3-prod-db-1 psql -U paperclip -d paperclip` (root, no
  password).
- The HTTP API on :33100 rejects the board token in `~/.paperclip/auth.json`
  with "Agent token did not verify" — use the Postgres path.
- Main T3 company: `2588c455-47ca-4b0f-ba96-b5bf63a9c796` (issue prefix `T`).
- No `tier:*` labels or `[WP-*]` cards existed at build time (trial hasn't
  run) — evidence demo used a synthetic WP in a scratch company, then cleanup.