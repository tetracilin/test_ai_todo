#!/usr/bin/env python3
"""Unit tests for wp-close-export (pure logic — no Paperclip DB needed).

Run:  python3 -m unittest hermes-skills/wp-close-export/scripts/test_wp_close_export.py -v
or:   python3 hermes-skills/wp-close-export/scripts/test_wp_close_export.py
"""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import wp_close_export as wce  # noqa: E402


class TestEvidenceCounting(unittest.TestCase):
    def test_attachments_always_count(self):
        self.assertEqual(wce.count_evidence_from_dossier(None, 2)[0], 2)

    def test_evidence_links_in_section_count(self):
        dossier = (
            "## Job order\njob.\n\n"
            "## Evidence\n"
            "- 2026-08-14T03:20:00Z — photo — evidence: t3-evidence/abc/20260814-photo.jpg\n"
            "- 2026-08-15T02:00:00Z — pdf — evidence: t3-evidence/abc/20260815-doc.pdf\n"
        )
        count, links, pending = wce.count_evidence_from_dossier(dossier, 0)
        self.assertEqual(count, 2)
        self.assertEqual(len(links), 2)
        self.assertTrue(all(k.startswith("t3-evidence/") for k in links))
        self.assertEqual(pending, 0)

    def test_pending_storage_not_counted(self):
        dossier = (
            "## Evidence\n"
            "- 2026-08-16T09:00:00Z — test-rung.jpg — PENDING STORAGE: test-rung.jpg (evidence backend unavailable)\n"
        )
        count, links, pending = wce.count_evidence_from_dossier(dossier, 0)
        self.assertEqual(count, 0)
        self.assertEqual(pending, 1)

    def test_evidence_links_outside_section_ignored(self):
        # Scope-changes content must NOT count (MVP-01 gate semantics).
        dossier = (
            "## Evidence\n"
            "- 2026-08-14T03:20:00Z — photo — evidence: t3-evidence/abc/20260814-photo.jpg\n"
            "## Scope changes\n"
            "- 2026-08-13T07:30:00Z — Out of scope: x — evidence: t3-evidence/abc/20260813-x.jpg\n"
        )
        count, links, _ = wce.count_evidence_from_dossier(dossier, 0)
        self.assertEqual(count, 1)
        self.assertEqual(links, ["t3-evidence/abc/20260814-photo.jpg"])

    def test_no_evidence_heading(self):
        dossier = "## Job order\nonly job text.\n"
        count, links, pending = wce.count_evidence_from_dossier(dossier, 1)
        self.assertEqual(count, 1)  # attachment only
        self.assertEqual(links, [])

    def test_first_comment_only(self):
        # Dossier = first comment; later comments are not considered here
        # (the DB query takes comments[0]). Parse-level: no double count.
        dossier = "## Evidence\n- 2026-08-14T03:20:00Z — photo — evidence: t3-evidence/abc/1.jpg\n"
        count, _, _ = wce.count_evidence_from_dossier(dossier, 0)
        self.assertEqual(count, 1)


class TestScopeParsing(unittest.TestCase):
    DOSSIER = (
        "## Job order\njob.\n"
        "## Clarifications\n- 2026-08-10T02:15:00Z — q\n"
        "## Evidence\n- link\n"
        "## Scope changes\n"
        "- 2026-08-13T07:30:00Z — Out of scope: thêm điểm đo. @pm\n"
        "- 2026-08-18T02:10:00Z — Out of scope: lắp rơ le. @pm\n"
        "## Related Teable rows\n(empty)\n"
    )

    def test_scope_events_parsed(self):
        events = wce.parse_scope_events(self.DOSSIER)
        self.assertEqual(len(events), 2)
        self.assertEqual(events[0]["timestamp_raw"], "2026-08-13T07:30:00Z")
        self.assertIn("thêm điểm đo", events[0]["description"])

    def test_no_scope_section(self):
        self.assertEqual(wce.parse_scope_events("## Evidence\nx\n"), [])
        self.assertEqual(wce.parse_scope_events(None), [])


class TestMeetingAnalysis(unittest.TestCase):
    def test_next_meeting_and_days(self):
        events = [{"timestamp_raw": "2026-08-13T07:30:00Z", "description": "x"}]
        meetings = ["2026-08-12", "2026-08-14", "2026-08-21"]
        out = wce.meeting_analysis(events, meetings)
        self.assertEqual(out[0]["next_meeting_date"], "2026-08-14")
        self.assertAlmostEqual(out[0]["time_to_replan_days"], 0.7, places=1)
        self.assertIs(out[0]["missed_review_window"], False)

    def test_no_meeting_after(self):
        events = [{"timestamp_raw": "2026-08-22T01:00:00Z", "description": "x"}]
        out = wce.meeting_analysis(events, ["2026-08-12"])
        self.assertEqual(out[0]["next_meeting_date"], "none-on-record")

    def test_unknown_without_meetings(self):
        events = [{"timestamp_raw": "2026-08-13T07:30:00Z", "description": "x"}]
        out = wce.meeting_analysis(events, None)
        self.assertEqual(out[0]["next_meeting_date"], "UNKNOWN")
        self.assertEqual(out[0]["time_to_replan_days"], "UNKNOWN")


class TestArtifactRows(unittest.TestCase):
    def test_attachments_and_links_dedup(self):
        cards = [
            {"id": "c1", "identifier": "SYN-1"},
            {"id": "c2", "identifier": "SYN-2"},
        ]
        atts = {
            "c1": [{"object_key": "t3-evidence/SYN-1/a.jpg", "byte_size": "10", "sha256": "aa"}],
            "c2": [],
        }
        links = {"c1": {"t3-evidence/SYN-1/b.pdf"}, "c2": {"t3-evidence/SYN-2/c.docx"}}
        tiers = {"c1": "open", "c2": "internal"}
        rows = wce.build_artifact_rows(cards, atts, links, tiers)
        self.assertEqual(len(rows), 3)
        b = next(r for r in rows if r["object_key"].endswith("b.pdf"))
        self.assertEqual(b["size"], "")  # unbacked link: no fabricated stats
        self.assertEqual(b["tier"], "open")
        c = next(r for r in rows if r["object_key"].endswith("c.docx"))
        self.assertEqual(c["tier"], "internal")


class TestConfidentialRouting(unittest.TestCase):
    def test_confidential_dossier_goes_to_nas_and_stub_to_shared(self):
        with tempfile.TemporaryDirectory() as tmp:
            out_root = Path(tmp) / "wiki" / "wp-records" / "WP-X"
            nas_root = Path(tmp) / "nas" / "wprec" / "WP-X"
            (out_root / "dossiers").mkdir(parents=True)
            card = {
                "id": "c3",
                "identifier": "SYN-3",
                "title": "[WP-X] bơm",
                "status": "in_progress",
                "created_at": "2026-08-11 05:00:00+00",
                "completed_at": "",
                "_dossier": "## Job order\npump work.",
            }
            wce.write_dossier_file(out_root, nas_root, card, "confidential", nas_unavailable=False)
            shared = out_root / "dossiers" / "SYN-3.md"
            nas = nas_root / "dossiers" / "SYN-3.md"
            self.assertTrue(nas.exists())
            self.assertIn("## Job order", nas.read_text())
            # shared repo must NOT contain the body — only the stub
            self.assertIn("CONFIDENTIAL", shared.read_text())
            self.assertNotIn("pump work", shared.read_text())

    def test_confidential_nas_unavailable_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            out_root = Path(tmp) / "wiki" / "wp-records" / "WP-X"
            (out_root / "dossiers").mkdir(parents=True)
            nas_root = Path(tmp) / "nas-unwritable" / "wprec" / "WP-X"
            card = {
                "id": "c3",
                "identifier": "SYN-3",
                "title": "[WP-X] bơm",
                "status": "in_progress",
                "created_at": "2026-08-11 05:00:00+00",
                "completed_at": "",
                "_dossier": "## Job order\npump work.",
            }
            wce.write_dossier_file(out_root, nas_root, card, "confidential", nas_unavailable=True)
            # No file at all in the shared repo for this card — fail closed.
            self.assertFalse((out_root / "dossiers" / "SYN-3.md").exists())
            self.assertFalse(nas_root.exists())


class TestSlugify(unittest.TestCase):
    def test_vietnamese_stripped(self):
        self.assertEqual(wce.slugify("Hồ sơ kỹ thuật 1.md"), "Ho-so-ky-thuat-1.md")
        self.assertEqual(wce.slugify("T-107"), "T-107")


if __name__ == "__main__":
    unittest.main(verbosity=2)