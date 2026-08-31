#!/usr/bin/env python3
"""Seed a synthetic WP (WP-PMIDE-001) in a scratch Paperclip company for the
wp-close-export evidence demo, then clean up after export. Prints the SQL.

Usage: python3 seed_demo.py | docker exec -i t3-prod-db-1 psql -U paperclip -d paperclip
Usage (cleanup): python3 seed_demo.py --cleanup | docker exec -i t3-prod-db-1 psql -U paperclip -d paperclip
"""
import sys

COMPANY_NAME = "T3 PMIDE Demo (synthetic, wp-close-export)"
WP = "WP-PMIDE-001"

DOSSIER_OPEN = """## Job order
Lắp đặt cảm biến nhiệt tại khu vực A và nối dây về tủ điện chính.

## Clarifications
- 2026-08-10T02:15:00Z — Yêu cầu dùng cảm biến PT100 thay vì NTC do nhiệt độ môi trường > 85°C.
- 2026-08-11T09:40:00Z — Vị trí lắp đặt chuẩn theo bản vẽ cập nhật ngày 08/08.

## Evidence
- 2026-08-14T03:20:00Z — anh-hung-photo-01.jpg — evidence: t3-evidence/SYN-1/20260814-anh-hung-photo-01.jpg
- 2026-08-15T02:00:00Z — bản vẽ điện cập nhật — evidence: t3-evidence/SYN-1/20260815-ban-ve-dien.pdf

## Scope changes
- 2026-08-13T07:30:00Z — Out of scope: khảo sát thêm 3 điểm đo nhiệt cho khu B. Requested by Nam Dương. @pm
- 2026-08-18T02:10:00Z — Out of scope: lắp thêm rơ le nhiệt bảo vệ. Requested by Nam Dương. @pm

## Related Teable rows
(empty)
"""

DOSSIER_INTERNAL = """## Job order
Viết FAT report cho PC-17 theo mẫu chuẩn công ty.

## Clarifications
- 2026-08-12T01:00:00Z — Mẫu report lấy từ template trên Drive (bản 2026-08).

## Evidence
- 2026-08-16T06:00:00Z — FAT report bản nháp — evidence: t3-evidence/SYN-2/20260816-fat-report-draft.docx
- 2026-08-16T09:00:00Z — ảnh test rung — PENDING STORAGE: test-rung.jpg (evidence backend unavailable)

## Scope changes
- 2026-08-17T03:00:00Z — Out of scope: viết thêm mục kiểm tra IP55 cho Tacho. Requested by Mai Anh. @pm

## Related Teable rows
(empty)
"""

DOSSIER_CONFIDENTIAL = """## Job order
Xử lý vấn đề rung động bơm chính và chẩn đoán nguyên nhân.

## Clarifications
- 2026-08-11T05:00:00Z — KH yêu cầu không chia sẻ số liệu ra ngoài dự án.

## Evidence
- 2026-08-15T08:00:00Z — số liệu rung động đo đạc — evidence: t3-evidence/SYN-3/20260815-rung-dong-data.xlsx

## Scope changes
- 2026-08-19T01:30:00Z — Out of scope: kiểm tra thêm van an toàn hệ thống. Requested by Viet Ng. @pm

## Related Teable rows
(empty)
"""


def esc(s: str) -> str:
    return s.replace("'", "''")


def main() -> int:
    cleanup = "--cleanup" in sys.argv

    jsonb_dir = "JSON"  # not used; details kept textual
    if cleanup:
        print(f"""
-- cleanup: drop the scratch demo company (cascades issues/comments/assets/activity)
DELETE FROM activity_log WHERE company_id IN (SELECT id FROM companies WHERE name = '{esc(COMPANY_NAME)}');
DELETE FROM companies WHERE name = '{esc(COMPANY_NAME)}';
""")
        return 0

    print(f"""
BEGIN;

INSERT INTO companies (id, name, status, issue_prefix, issue_counter, budget_monthly_cents,
                       spent_monthly_cents, require_board_approval_for_new_agents,
                       feedback_data_sharing_enabled, feedback_data_sharing_terms_version,
                       attachment_max_bytes, interaction_resolver_governance)
VALUES (gen_random_uuid(), '{esc(COMPANY_NAME)}', 'active', 'SYN', 0, 0, 0, false,
        false, 'v1', 10485760, '{{}}'::jsonb)
RETURNING id;
""")

    for ident, title, tier, status, created, completed in [
        ("SYN-1", "[WP-PMIDE-001] Lắp đặt cảm biến nhiệt khu vực A", "open", "done", "2026-08-10T02:00:00Z", "2026-08-20T09:00:00Z"),
        ("SYN-2", "[WP-PMIDE-001] Viết FAT report cho PC-17", "internal", "in_progress", "2026-08-11T01:00:00Z", None),
        ("SYN-3", "[WP-PMIDE-001] Xử lý vấn đề rung động bơm", "confidential", "in_progress", "2026-08-11T05:00:00Z", None),
        ("SYN-4", "[WP-PMIDE-001] Nghiệm thu thiết bị VSAT", "open", "todo", "2026-08-12T02:00:00Z", None),
    ]:
        completed_sql = f"'{completed}'" if completed else "NULL"
        print(f"""
INSERT INTO issues (id, company_id, title, status, priority, request_depth, started_at,
                    completed_at, created_at, updated_at, identifier, origin_kind,
                    origin_fingerprint, monitor_attempt_count, work_mode, issue_number)
VALUES (gen_random_uuid(),
        (SELECT id FROM companies WHERE name = '{esc(COMPANY_NAME)}'),
        '{esc(title)}', '{status}', 'medium', 0, '{created}', {completed_sql}, '{created}', '{created}',
        '{ident}', 'manual', 'default', 0, 'standard', 100)
RETURNING id, identifier;
""")

    # labels (create each once; link per card)
    print(f"""
INSERT INTO labels (id, company_id, name, color) VALUES
(gen_random_uuid(), (SELECT id FROM companies WHERE name = '{esc(COMPANY_NAME)}'), 'tier:open', '#8b8b8b'),
(gen_random_uuid(), (SELECT id FROM companies WHERE name = '{esc(COMPANY_NAME)}'), 'tier:internal', '#8b8b8b'),
(gen_random_uuid(), (SELECT id FROM companies WHERE name = '{esc(COMPANY_NAME)}'), 'tier:confidential', '#8b8b8b'),
(gen_random_uuid(), (SELECT id FROM companies WHERE name = '{esc(COMPANY_NAME)}'), 'owner:demo-engineer', '#3a7bd5');
""")

    for ident, tier in [("SYN-1", "open"), ("SYN-2", "internal"), ("SYN-3", "confidential"), ("SYN-4", "open")]:
        print(f"""
INSERT INTO issue_labels (issue_id, label_id, company_id, created_at)
SELECT i.id, l.id, (SELECT id FROM companies WHERE name = '{esc(COMPANY_NAME)}'), now()
FROM issues i, labels l
WHERE i.identifier = '{ident}'
  AND l.name = 'tier:{tier}'
  AND i.company_id = (SELECT id FROM companies WHERE name = '{esc(COMPANY_NAME)}');
INSERT INTO issue_labels (issue_id, label_id, company_id, created_at)
SELECT i.id, l.id, (SELECT id FROM companies WHERE name = '{esc(COMPANY_NAME)}'), now()
FROM issues i, labels l
WHERE i.identifier = '{ident}'
  AND l.name = 'owner:demo-engineer'
  AND i.company_id = (SELECT id FROM companies WHERE name = '{esc(COMPANY_NAME)}');
""")

    for ident, dossier in [("SYN-1", DOSSIER_OPEN), ("SYN-2", DOSSIER_INTERNAL), ("SYN-3", DOSSIER_CONFIDENTIAL), ("SYN-4", None)]:
        if dossier is None:
            continue
        print(f"""
INSERT INTO issue_comments (id, company_id, issue_id, body, created_at, updated_at, author_type)
VALUES (gen_random_uuid(),
        (SELECT id FROM companies WHERE name = '{esc(COMPANY_NAME)}'),
        (SELECT id FROM issues WHERE identifier = '{ident}' AND company_id = (SELECT id FROM companies WHERE name = '{esc(COMPANY_NAME)}')),
        '{esc(dossier)}', now(), now(), 'agent');
""")

    # assets + attachments for SYN-1 (2) and SYN-3 (1); SYN-2 evidence is link-only
    for ident, key, size, sha, kind in [
        ("SYN-1", "t3-evidence/SYN-1/20260814-anh-hung-photo-01.jpg", 224501, "a" * 64, "image/jpeg"),
        ("SYN-1", "t3-evidence/SYN-1/20260815-ban-ve-dien.pdf", 812034, "b" * 64, "application/pdf"),
        ("SYN-3", "t3-evidence/SYN-3/20260815-rung-dong-data.xlsx", 104856, "c" * 64, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    ]:
        print(f"""
INSERT INTO assets (id, company_id, provider, object_key, content_type, byte_size, sha256, original_filename, created_at, updated_at)
VALUES (gen_random_uuid(),
        (SELECT id FROM companies WHERE name = '{esc(COMPANY_NAME)}'),
        's3', '{key}', '{kind}', {size}, '{sha}', '{key.split('/')[-1]}', now(), now())
RETURNING id;
INSERT INTO issue_attachments (id, company_id, issue_id, asset_id, created_at, updated_at)
SELECT gen_random_uuid(), (SELECT id FROM companies WHERE name = '{esc(COMPANY_NAME)}'),
       (SELECT id FROM issues WHERE identifier = '{ident}' AND company_id = (SELECT id FROM companies WHERE name = '{esc(COMPANY_NAME)}')),
       a.id, now(), now()
FROM assets a WHERE a.object_key = '{key}';
""")

    # activity log rows (issue-scoped) for the demo
    for ident, action, actor, created in [
        ("SYN-1", "issue.created", "system", "2026-08-10T02:00:00Z"),
        ("SYN-1", "issue.comment_added", "agent", "2026-08-11T09:40:00Z"),
        ("SYN-1", "issue.attachment_added", "agent", "2026-08-14T03:20:00Z"),
        ("SYN-1", "issue.scope_change_flagged", "agent", "2026-08-13T07:30:00Z"),
        ("SYN-1", "issue.status_changed", "system", "2026-08-20T09:00:00Z"),
        ("SYN-2", "issue.created", "system", "2026-08-11T01:00:00Z"),
        ("SYN-2", "issue.comment_added", "agent", "2026-08-17T03:00:00Z"),
        ("SYN-3", "issue.created", "system", "2026-08-11T05:00:00Z"),
        ("SYN-3", "issue.attachment_added", "agent", "2026-08-15T08:00:00Z"),
        ("SYN-4", "issue.created", "system", "2026-08-12T02:00:00Z"),
    ]:
        print(f"""
INSERT INTO activity_log (id, company_id, actor_type, actor_id, action, entity_type, entity_id, created_at)
VALUES (gen_random_uuid(),
        (SELECT id FROM companies WHERE name = '{esc(COMPANY_NAME)}'),
        'system', 'demo', '{action}', 'issue',
        (SELECT id::text FROM issues WHERE identifier = '{ident}' AND company_id = (SELECT id FROM companies WHERE name = '{esc(COMPANY_NAME)}')),
        '{created}');
""")

    print("""
COMMIT;
""")
    return 0


if __name__ == "__main__":
    sys.exit(main())