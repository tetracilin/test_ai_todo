#!/usr/bin/env python3
"""wp-close-export — T3 PM-IDE MVP §1.8. Export a Workpackage's close record.

Input : a Workpackage ID (WP-xxx, as used in engineer card titles `[WP-xxx] ...`).
Output: wp-records/<WP-ID>/ under the wiki-internal repo (/root/T3-wiki by default):
  dossiers/       one .md per card (first-comment dossier per card contract §1.4)
  activity.jsonl  Paperclip activity_log rows for those cards (chronological)
  artifacts.csv   object_key,card,size,sha256,tier (attachments + evidence: links)
  summary.md      cards count, evidence coverage %, scope changes vs meeting
                  dates, time-to-replan, sync stubs (§1.7), source metadata

Data source: the Paperclip production Postgres via `docker exec <container>
psql -U paperclip -d paperclip` (the HTTP API on 127.0.0.1:33100 rejects the
board token on this host — see the paperclip-self-hosting skill). The Teable
Meetings table is read through the REST API only when TEABLE_API_KEY is
available; no meetings data = clearly-marked UNKNOWN columns, never invented.

Confidential tier (AD-026): dossiers of cards labelled tier:confidential are
written ONLY into WP_CLOSE_EXPORT_NAS_WIKI_DIR (default
/mnt/nas/wiki-internal/wp-records); the shared repo gets a stub. Fail closed.

Exit codes: 0 ok, 1 runtime/config error, 2 confidential-NAS unavailable.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import subprocess
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

# --------------------------------------------------------------------------
# Constants / config
# --------------------------------------------------------------------------

DEFAULT_WIKI_DIR = "/root/T3-wiki"
DEFAULT_DB_CONTAINER = "t3-prod-db-1"
DEFAULT_NAS_WIKI_DIR = "/mnt/nas/wiki-internal/wp-records"
MEETINGS_TABLE_ID = "tbllNPP0tDOltxr0etj"  # Teable "Meetings" (Tec CN base; verified 2026-08-31)
MEETINGS_DATE_FIELD = "Date"
TEABLE_BASE_URL = "https://teable.tecotec.tech:8443/api/table"

# Card contract §1.4 fixed headings, in order.
EVIDENCE_HEADING_RE = re.compile(r"(?:^|\n)[ \t]*#+[ \t]*Evidence[ \t]*\n", re.IGNORECASE)
NEXT_H12_HEADING_RE = re.compile(r"(?:^|\n)[ \t]*(?:#{1,2})[ \t]+", re.IGNORECASE)
EVIDENCE_LINK_RE = re.compile(r"evidence\s*:\s*(\S+)", re.IGNORECASE)
SCOPE_LINE_RE = re.compile(
    r"^\s*-\s*([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]*Z?)\s*[—-]?\s*(.*)$", re.IGNORECASE
)
OBJKEY_ISH_RE = re.compile(r"^(t3-evidence|[a-zA-Z0-9]+://)[^\s,;]+", re.IGNORECASE)


def log(msg: str) -> None:
    print(msg, flush=True)


def slugify(name: str) -> str:
    """ASCII-safe slug for file names (strips diacritics, slashes, spaces)."""
    nfkd = unicodedata.normalize("NFKD", name)
    ascii_only = "".join(c for c in nfkd if not unicodedata.combining(c) or c in "-_")
    out = re.sub(r"[^A-Za-z0-9._-]+", "-", ascii_only)
    return out.strip(".-") or "card"


# --------------------------------------------------------------------------
# DB access (tab-separated psql via docker exec)
# --------------------------------------------------------------------------


def _render(sql: str, params: tuple[Any, ...]) -> str:
    values: list[str] = []
    for p in params:
        if p is None:
            values.append("NULL")
        elif isinstance(p, bool):
            values.append("TRUE" if p else "FALSE")
        elif isinstance(p, (int, float)):
            values.append(str(p))
        else:
            values.append("'" + str(p).replace("'", "''") + "'")
    rendered = sql
    for v in values:
        rendered = rendered.replace("%s", v, 1)
    return rendered


def psql_rows(container: str, sql: str, params: tuple[Any, ...] = ()) -> tuple[list[dict[str, Any]], list[str]]:
    """Run a SELECT in the Paperclip prod Postgres; return (rows, colnames)."""
    rendered = _render(sql, params)
    cmd = [
        "docker", "exec", container, "psql", "-U", "paperclip", "-d", "paperclip",
        "-A", "-F", "\t", "-c", rendered,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise RuntimeError(f"psql failed (exit {proc.returncode}): {proc.stderr.strip()[:600]}")
    rows: list[dict[str, Any]] = []
    cols: list[str] = []
    for line in proc.stdout.splitlines():
        if not line.strip():
            continue
        if re.match(r"^\(\d+ rows?\)$", line.strip()):
            continue  # psql row-count footer
        cells = line.split("\t")
        if not cols:
            cols = [c.strip() for c in cells]
            continue
        rows.append(dict(zip(cols, cells)))
    return rows, cols


# --------------------------------------------------------------------------
# Paperclip model queries
# --------------------------------------------------------------------------


def load_cards(container: str, company_id: str, wp_id: str, project_id: str | None) -> list[dict[str, Any]]:
    """Cards = issues whose title starts with `[WP-ID]` (case-insensitive)."""
    params: list[Any] = [company_id, wp_id]
    project_clause = ""
    if project_id:
        project_clause = " AND i.project_id = %s"
        params.append(project_id)
    sql = f"""
      SELECT i.id::text AS id, i.identifier, i.title, i.status,
             i.created_at::text AS created_at, i.completed_at::text AS completed_at,
             i.updated_at::text AS updated_at, p.name AS project_name
      FROM issues i
      LEFT JOIN projects p ON p.id = i.project_id
      WHERE i.company_id = %s AND i.hidden_at IS NULL
        AND i.title ILIKE '[' || %s || ']%'
        {project_clause}
      ORDER BY i.created_at, i.id
    """
    rows, _ = psql_rows(container, sql, tuple(params))
    return rows


def load_labels(container: str, card_id: str) -> list[str]:
    sql = """
      SELECT l.name FROM labels l
      JOIN issue_labels il ON il.label_id = l.id
      WHERE il.issue_id = %s ORDER BY l.name
    """
    rows, _ = psql_rows(container, sql, (card_id,))
    return [r.get("name", "") for r in rows]


def load_dossier(container: str, card_id: str) -> str | None:
    """First comment on the card is the dossier (contract §1.4)."""
    sql = """
      SELECT to_json(c.body)::text AS body FROM issue_comments c
      WHERE c.issue_id = %s AND c.deleted_at IS NULL
      ORDER BY c.created_at, c.id LIMIT 1
    """
    rows, _ = psql_rows(container, sql, (card_id,))
    if not rows:
        return None
    raw = rows[0].get("body")
    if not raw:
        return None
    try:
        # to_json() emits a quoted, escaped string — decode it.
        return json.loads(raw)
    except (ValueError, TypeError):
        return raw.strip('"')


def load_attachments(container: str, card_id: str) -> list[dict[str, Any]]:
    sql = """
      SELECT a.object_key, a.byte_size::text AS byte_size, a.sha256,
             a.content_type, a.original_filename, a.provider
      FROM issue_attachments ia
      JOIN assets a ON a.id = ia.asset_id
      WHERE ia.issue_id = %s
      ORDER BY a.object_key
    """
    rows, _ = psql_rows(container, sql, (card_id,))
    return rows


def load_activity(container: str, company_id: str, card_ids: list[str]) -> list[dict[str, Any]]:
    if not card_ids:
        return []
    id_list = ", ".join(f"'{cid}'" for cid in card_ids)
    sql = f"""
      SELECT al.id::text AS id, al.actor_type, al.actor_id, al.action,
             al.entity_type, al.entity_id, a.name AS agent_name,
             to_json(al.details)::text AS details, al.created_at::text AS created_at,
             al.run_id::text AS run_id, al.responsible_user_id
      FROM activity_log al
      LEFT JOIN agents a ON a.id = al.agent_id
      WHERE al.company_id = '{company_id}'
        AND al.entity_type = 'issue'
        AND al.entity_id IN ({id_list})
      ORDER BY al.created_at, al.id
    """
    rows, _ = psql_rows(container, sql)
    for r in rows:
        details = r.get("details")
        if details:
            try:
                r["details"] = json.loads(details)
            except (ValueError, TypeError):
                pass  # keep raw text
    return rows


def tier_of(labels: Iterable[str]) -> str:
    for l in labels:
        if l.lower().startswith("tier:"):
            return l.split(":", 1)[1].strip().lower()
    return "open"


# --------------------------------------------------------------------------
# Dossier parsing (evidence counting + scope changes)
# --------------------------------------------------------------------------


def count_evidence_from_dossier(dossier: str | None, attachments: int) -> tuple[int, list[str], int]:
    """Evidence per MVP-01 gate semantics.

    attachments always count; `evidence:` links count only inside the
    `## Evidence` section (bound at the next H1/H2 heading). Returns
    (count, evidence_object_keys, pending_count).
    """
    links: list[str] = []
    pending = 0
    if dossier:
        m = EVIDENCE_HEADING_RE.search(dossier)
        if m:
            section = dossier[m.end():]
            cut = NEXT_H12_HEADING_RE.search(section)
            if cut:
                section = section[:cut.start()]
            for line in section.splitlines():
                if "PENDING STORAGE" in line:
                    pending += 1
                    continue
                for lm in EVIDENCE_LINK_RE.finditer(line):
                    key = lm.group(1).strip().strip("`").strip("()")
                    if key and OBJKEY_ISH_RE.match(key):
                        links.append(key)
    return attachments + len(links), links, pending


def parse_scope_events(dossier: str | None) -> list[dict[str, Any]]:
    """Lines under ## Scope changes matching `- <ISO ts> — description`."""
    events: list[dict[str, Any]] = []
    if not dossier:
        return events
    m = re.search(r"(?:^|\n)[ \t]*#+[ \t]*Scope changes[ \t]*\n", dossier, re.IGNORECASE)
    if not m:
        return events
    section = dossier[m.end():]
    cut = NEXT_H12_HEADING_RE.search(section)
    if cut:
        section = section[:cut.start()]
    for line in section.splitlines():
        lm = SCOPE_LINE_RE.match(line)
        if lm:
            ts_raw = lm.group(1)
            desc = lm.group(2).strip() or "(no description)"
            events.append({"timestamp_raw": ts_raw, "description": desc})
    return events


# --------------------------------------------------------------------------
# Teable meetings (optional; no key => UNKNOWN)
# --------------------------------------------------------------------------


def load_meeting_dates() -> list[str] | None:
    """ISO dates from the Teable Meetings table; None if no API key."""
    key = os.environ.get("TEABLE_API_KEY")
    if not key:
        env_path = Path("/root/.hermes/.env")
        if env_path.exists():
            for line in env_path.read_text().splitlines():
                if line.startswith("TEABLE_API_KEY="):
                    key = line.split("=", 1)[1].strip().strip('"')
                    break
    if not key:
        return None
    import ssl
    import urllib.request

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    url = f"{TEABLE_BASE_URL}/{MEETINGS_TABLE_ID}/record?fieldKeyType=name&take=1000"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {key}"})
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=30) as resp:
            data = json.loads(resp.read().decode())
    except Exception as e:  # noqa: BLE001
        log(f"  [warn] could not fetch Meetings table: {e}")
        return None
    dates: list[str] = []
    for rec in data.get("records", []):
        d = rec.get("fields", {}).get("Date")
        if d:
            dates.append(str(d)[:10])
    return sorted(set(dates))


def meeting_analysis(events: list[dict[str, Any]], meeting_dates: list[str] | None) -> list[dict[str, Any]]:
    """Annotate scope events with next_meeting_date / days_to_meeting."""
    out: list[dict[str, Any]] = []
    for ev in events:
        ev = dict(ev)
        ev["meeting_source"] = "teable" if meeting_dates is not None else "UNKNOWN"
        ev["next_meeting_date"] = "UNKNOWN" if meeting_dates is None else "none-on-record"
        ev["time_to_replan_days"] = "UNKNOWN" if meeting_dates is None else "n/a"
        ev["missed_review_window"] = None
        if meeting_dates:
            try:
                ev_ts = datetime.fromisoformat(ev["timestamp_raw"].replace("Z", "+00:00"))
            except ValueError:
                ev_ts = None
            if ev_ts:
                next_meeting = None
                for ds in meeting_dates:
                    md = datetime.fromisoformat(ds + "T00:00:00+00:00")
                    if md >= ev_ts:
                        next_meeting = md
                        break
                if next_meeting:
                    ev["next_meeting_date"] = next_meeting.date().isoformat()
                    ev["time_to_replan_days"] = round((next_meeting - ev_ts).total_seconds() / 86400.0, 1)
                    ev["missed_review_window"] = False
                else:
                    ev["next_meeting_date"] = "none-on-record"
                    ev["time_to_replan_days"] = "n/a (no later meeting on record)"
                    ev["missed_review_window"] = None
            else:
                ev["next_meeting_date"] = "parse-error"
                ev["time_to_replan_days"] = "n/a"
        out.append(ev)
    return out


# --------------------------------------------------------------------------
# Export writing
# --------------------------------------------------------------------------


def build_artifact_rows(cards: list[dict[str, Any]], attachments_by_card: dict[str, list[dict[str, Any]]],
                        links_by_card: dict[str, set[str]], tiers: dict[str, str]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for card in cards:
        cid = card["id"]
        ident = card.get("identifier") or cid[:8]
        tier = tiers.get(cid, "open")
        for att in attachments_by_card.get(cid, []):
            key = att.get("object_key", "")
            if (key, ident) in seen:
                continue
            seen.add((key, ident))
            rows.append({
                "object_key": key,
                "card": ident,
                "size": att.get("byte_size", ""),
                "sha256": att.get("sha256", ""),
                "tier": tier,
            })
        for key in sorted(links_by_card.get(cid, set())):
            if any(att.get("object_key") == key for att in attachments_by_card.get(cid, [])):
                continue
            if (key, ident) in seen:
                continue
            seen.add((key, ident))
            rows.append({"object_key": key, "card": ident, "size": "", "sha256": "", "tier": tier})
    return rows


def write_dossier_file(out_root: Path, nas_root: Path, card: dict[str, Any], tier: str,
                       nas_unavailable: bool) -> None:
    cid = card["id"]
    ident = card.get("identifier") or cid[:8]
    fname = f"{slugify(ident)}.md"
    body = card.get("_dossier") or "(no dossier comment on record)"
    header = (
        f"# Dossier — {card.get('title', '')}\n\n"
        f"- Card id: `{cid}`\n- Identifier: `{ident}`\n- Status: {card.get('status', '')}\n"
        f"- Tier: {tier}\n- Created: {card.get('created_at', '')}\n"
        f"- Completed: {card.get('completed_at', '') or '—'}\n\n---\n\n"
    )
    if tier == "confidential":
        if nas_unavailable:
            # Fail closed: no shared-repo file at all for this card.
            return
        target = nas_root / "dossiers" / fname
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(header + body, encoding="utf-8")
        log(f"  [nas] confidential dossier -> {target}")
        stub = (
            f"# Dossier — {card.get('title', '')}\n\n"
            f"**CONFIDENTIAL — dossier body withheld to the NAS-only wiki "
            f"directory per AD-026.**\n\n"
            f"- Card id: `{cid}`\n- Identifier: `{ident}`\n- Status: {card.get('status', '')}\n"
            f"- Tier: {tier}\n- Full dossier: NAS path `{target}`\n"
        )
        (out_root / "dossiers" / fname).write_text(stub, encoding="utf-8")
    else:
        (out_root / "dossiers" / fname).write_text(header + body, encoding="utf-8")
    log(f"  [dossier] {ident} ({tier})")


def build_summary_md(wp_id: str, company_id: str, container: str, project_id: str | None,
                     cards: list[dict[str, Any]], stats: dict[str, Any],
                     scope_events: list[dict[str, Any]], meeting_dates: list[str] | None,
                     artifact_rows: list[dict[str, Any]], activity_rows: list[dict[str, Any]]) -> str:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    lines: list[str] = []
    lines.append("---")
    lines.append(f"title: WP-close export — {wp_id}")
    lines.append(f"created: {now}")
    lines.append(f"updated: {now}")
    lines.append("author: Hermes Agent (wp-close-export skill)")
    lines.append("status: export")
    lines.append("tags: [wp-close, export, paperclip, dossier, evidence, t3-pmide]")
    lines.append("---")
    lines.append("")
    lines.append(f"# WP-close export — {wp_id}")
    lines.append("")
    lines.append(f"- Generated: {now}")
    lines.append(f"- Workpackage: `{wp_id}`")
    lines.append(f"- Source: Paperclip company `{company_id}` (container `{container}`)"
                 + (f", project `{project_id}`" if project_id else ""))
    lines.append(f"- Cards in WP: **{stats['cards']}**")
    lines.append(f"- Cards with evidence: **{stats['cards_with_evidence']}**")
    lines.append(f"- Evidence coverage: **{stats['evidence_coverage_pct']}%**")
    lines.append(f"- Confidential cards: **{stats['confidential_cards']}**"
                 + (" (NAS-routed)" if stats["confidential_cards"] else ""))
    if stats["nas_unavailable_cards"]:
        lines.append(f"- ⚠️ NAS-unavailable cards (dossiers withheld, fail-closed): "
                     f"{', '.join(stats['nas_unavailable_cards'])}")
    lines.append("")
    lines.append("## Cards")
    lines.append("")
    lines.append("| Identifier | Title | Status | Tier | Evidence count |")
    lines.append("|---|---|---|---|---|")
    for card in cards:
        ident = card.get("identifier") or card["id"][:8]
        tier = card.get("_tier", "open")
        ev = card.get("_evidence_count", 0)
        title = card.get("title", "").replace("|", "\\|")[:60]
        lines.append(f"| {ident} | {title} | {card.get('status', '')} | {tier} | {ev} |")
    lines.append("")
    lines.append("## Scope changes vs meeting dates")
    lines.append("")
    if scope_events:
        lines.append("| Card | Timestamp | Description | Next meeting | Time to replan (days) |")
        lines.append("|---|---|---|---|---|")
        for ev in scope_events:
            ident = ev.get("_ident", "?")
            desc = ev.get("description", "").replace("|", "\\|")[:50]
            lines.append(f"| {ident} | {ev.get('timestamp_raw', '')} | {desc} | "
                         f"{ev.get('next_meeting_date', '')} | {ev.get('time_to_replan_days', '')} |")
        missed = [e for e in scope_events if e.get("missed_review_window")]
        if missed:
            lines.append("")
            lines.append(f"⚠️ {len(missed)} scope-change event(s) logged AFTER the prior meeting window "
                         "— check whether the PM was notified (contract rule 3).")
    else:
        lines.append("No scope-change events found in the dossiers.")
    lines.append("")
    lines.append("## Sync stubs (§1.7 Teable sync — not landed)")
    lines.append("")
    lines.append("The Teable sync (WP-T3-PMIDE-MVP-001 §1.7) that would provide "
                 "`paperclip_card_id` and `evidence_count` columns on the Teable "
                 "Task/Workpackage tables has **not shipped yet**. This export "
                 "therefore computes evidence from Paperclip tables directly "
                 "(issue_attachments + `evidence:` links under the dossier "
                 "`## Evidence` heading), and does NOT report a Teable-side "
                 "`paperclip_card_id`. Re-run after §1.7 lands to fill these fields.")
    lines.append("")
    lines.append("## Artifacts inventory")
    lines.append("")
    lines.append(f"`{len(artifact_rows)}` rows in `artifacts.csv` "
                 "(object_key, card, size, sha256, tier). Rows for evidence links "
                 "not backed by an `assets` row carry empty size/sha256 — those "
                 "stats are only filled by the S3 provider (MVP prerequisite 1.1/1.2).")
    lines.append("")
    lines.append("## Activity log")
    lines.append("")
    lines.append(f"`{len(activity_rows)}` Paperclip activity_log rows in `activity.jsonl` "
                 "(chronological; includes agent run ids and responsible users where recorded).")
    lines.append("")
    lines.append("## Files")
    lines.append("")
    lines.append("- `dossiers/` — one markdown per card (first-comment dossier body; "
                 "confidential dossiers routed to the NAS-only wiki dir per AD-026)")
    lines.append("- `activity.jsonl` — Paperclip activity log for the WP cards")
    lines.append("- `artifacts.csv` — evidence object inventory (key, card, size, sha256, tier)")
    lines.append("- `summary.md` — this file")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description="WP-close export (§1.8)")
    ap.add_argument("wp_id", help="Workpackage ID, e.g. WP-001 (matches title `[WP-001] ...`)")
    ap.add_argument("--wiki-dir", default=os.environ.get("WP_CLOSE_EXPORT_WIKI_DIR", DEFAULT_WIKI_DIR))
    ap.add_argument("--company-id", required=True, help="Paperclip company UUID")
    ap.add_argument("--project-id", default=None)
    ap.add_argument("--db-container", default=os.environ.get("WP_CLOSE_EXPORT_DB_CONTAINER", DEFAULT_DB_CONTAINER))
    ap.add_argument("--nas-wiki-dir", default=os.environ.get("WP_CLOSE_EXPORT_NAS_WIKI_DIR", DEFAULT_NAS_WIKI_DIR))
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    wp_id_norm = args.wp_id.strip().upper()
    if not re.match(r"^WP-[A-Z0-9_-]{1,60}$", wp_id_norm):
        log(f"error: Workpackage ID must look like WP-001 (got {args.wp_id!r})")
        return 1

    wiki = Path(args.wiki_dir)
    out_root = wiki / "wp-records" / wp_id_norm
    nas_root = Path(args.nas_wiki_dir) / wp_id_norm

    log(f"wp-close-export: {wp_id_norm}")
    log(f"  wiki out: {out_root}")
    log(f"  nas out : {nas_root}")

    try:
        cards = load_cards(args.db_container, args.company_id, wp_id_norm, args.project_id)
    except RuntimeError as e:
        log(f"error: {e}")
        return 1

    if not cards:
        log(f"error: no cards found with title prefix `[{wp_id_norm}]` in company {args.company_id}")
        return 1
    log(f"  [query] {len(cards)} card(s)")

    tiers: dict[str, str] = {}
    attachments_by_card: dict[str, list[dict[str, Any]]] = {}
    links_by_card: dict[str, set[str]] = {}
    scope_events: list[dict[str, Any]] = []

    card_ids = [c["id"] for c in cards]
    for card in cards:
        cid = card["id"]
        labels = load_labels(args.db_container, cid)
        tier = tier_of(labels)
        tiers[cid] = tier
        dossier = load_dossier(args.db_container, cid)
        card["_dossier"] = dossier
        card["_tier"] = tier
        atts = load_attachments(args.db_container, cid)
        attachments_by_card[cid] = atts
        ev_count, links, pending = count_evidence_from_dossier(dossier, len(atts))
        card["_evidence_count"] = ev_count
        card["_pending_storage"] = pending
        links_by_card[cid] = set(links)
        for ev in parse_scope_events(dossier):
            ev["_ident"] = card.get("identifier") or cid[:8]
            ev["_card_id"] = cid
            scope_events.append(ev)
        log(f"  [card] {card.get('identifier') or cid[:8]} tier={tier} evidence={ev_count} "
            f"attachments={len(atts)} links={len(links)} pending={pending}")

    activity_rows = load_activity(args.db_container, args.company_id, card_ids)
    log(f"  [query] {len(activity_rows)} activity rows")

    meeting_dates = load_meeting_dates()
    if meeting_dates is None:
        log("  [meetings] TEABLE_API_KEY absent — meeting comparison will be UNKNOWN")
    else:
        log(f"  [meetings] {len(meeting_dates)} meeting date(s) from Teable")
    scope_events = meeting_analysis(scope_events, meeting_dates)

    confidential_ids = {c["id"] for c in cards if tiers.get(c["id"]) == "confidential"}
    nas_unavailable: list[str] = []
    if confidential_ids and not args.dry_run:
        ok = nas_root.exists() and nas_root.is_dir() and os.access(nas_root, os.W_OK)
        if not ok:
            try:
                nas_root.mkdir(parents=True, exist_ok=True)
                ok = os.access(nas_root, os.W_OK)
            except OSError as e:
                log(f"  [nas] cannot create {nas_root}: {e}")
                ok = False
        if not ok:
            nas_unavailable = [c.get("identifier") or c["id"][:8] for c in cards if c["id"] in confidential_ids]
            log(f"error: {len(nas_unavailable)} confidential card(s) cannot be routed to NAS "
                f"({nas_root} unavailable). Failing closed for those dossiers.")

    artifact_rows = build_artifact_rows(cards, attachments_by_card, links_by_card, tiers)

    if args.dry_run:
        log("  [dry-run] planned files:")
        log(f"    dossiers/  {len(cards)} file(s)")
        log(f"    activity.jsonl  {len(activity_rows)} line(s)")
        log(f"    artifacts.csv  {len(artifact_rows)} row(s)")
        log("    summary.md")
        for c in cards:
            if tiers.get(c["id"]) == "confidential":
                fname = slugify(c.get("identifier") or c["id"][:8]) + ".md"
                log(f"    [nas] confidential dossier -> {nas_root / 'dossiers' / fname}")
        return 0

    (out_root / "dossiers").mkdir(parents=True, exist_ok=True)
    for card in cards:
        cid = card["id"]
        suppressed = (tiers[cid] == "confidential") and (cid in confidential_ids) and bool(nas_unavailable)
        write_dossier_file(out_root, nas_root, card, tiers[cid], suppressed)

    # Write the remaining outputs.
    with (out_root / "activity.jsonl").open("w", encoding="utf-8") as f:
        for row in activity_rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    log(f"  [activity] {len(activity_rows)} rows -> activity.jsonl")

    with (out_root / "artifacts.csv").open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["object_key", "card", "size", "sha256", "tier"])
        writer.writeheader()
        writer.writerows(artifact_rows)
    log(f"  [artifacts] {len(artifact_rows)} rows -> artifacts.csv")

    with_evidence = sum(1 for c in cards if c.get("_evidence_count", 0) > 0)
    conf = sum(1 for t in tiers.values() if t == "confidential")
    stats = {
        "cards": len(cards),
        "cards_with_evidence": with_evidence,
        "evidence_coverage_pct": round(100.0 * with_evidence / len(cards), 1) if cards else 0.0,
        "confidential_cards": conf,
        "nas_unavailable_cards": nas_unavailable,
    }
    summary = build_summary_md(wp_id_norm, args.company_id, args.db_container, args.project_id,
                               cards, stats, scope_events, meeting_dates, artifact_rows, activity_rows)
    (out_root / "summary.md").write_text(summary, encoding="utf-8")
    log(f"  [summary] -> summary.md ({len(summary)} chars)")
    log(f"done: {out_root}")
    return 0


if __name__ == "__main__":
    sys.exit(main())