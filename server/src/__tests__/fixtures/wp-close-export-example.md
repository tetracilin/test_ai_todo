# WP-close export — T3-140

## WWTP Bình Dương — pump replacement work package

Generated: 2026-09-04T05:10:22Z

## Bot/manual evidence ratio

- Sample size: 3 (bot 1, manual 2, system 0, other 0)
- Ratio: 33%
- Band: `extend_window`

## Scope-change timeline

- 2026-09-01T07:22:19Z — T3-142: Thêm hạng mục thay chân đế và ống hút PVC do phát hiện ăn mòn khi khảo sát; khách duyệt qua điện thoại lúc 14:05.
- 2026-09-02T03:48:05Z — T3-142: Bỏ hạng mục hiệu chuẩn cảm biến pH khỏi phạm vi đơn này; chuyển sang gói bảo trì định kỳ tháng 10.
- 2026-09-02T03:48:05Z — T3-143: Moved to the October maintenance package; out of this WP's scope.

## Cards

### T3-142 — Replace NaOH dosing pump #2, Bình Dương wastewater plant

Status: `done`
Evidence: 2 total (2 link(s), 0 attachment(s))

Evidence index:
  - [bot] git: https://github.com/tecotec/plant-configs/commit/9a41c7f5b8c2e0d6a3f19b47ce8025d1a7f36b40 (`https://github.com/tecotec/plant-configs/commit/9a41c7f5b8c2e0d6a3f19b47ce8025d1a7f36b40`)
  - [manual] minio: evidence/T3-142/bao-gia-bom-NaOH-v2.pdf (`evidence/T3-142/bao-gia-bom-NaOH-v2.pdf`)

Scope changes:
  - 2026-09-01T07:22:19Z — Thêm hạng mục thay chân đế và ống hút PVC do phát hiện ăn mòn khi khảo sát; khách duyệt qua điện thoại lúc 14:05.
  - 2026-09-02T03:48:05Z — Bỏ hạng mục hiệu chuẩn cảm biến pH khỏi phạm vi đơn này; chuyển sang gói bảo trì định kỳ tháng 10.

<details>
<summary>Dossier</summary>

# T3-142 — Replace NaOH dosing pump #2, Bình Dương wastewater plant

## Job order
- Source: chat message `1279344401920000512` -> card `T3-142` (origin_kind=`discord`)
- Received: 2026-09-01T02:14:33Z
- Engineer: Nguyễn Văn Hải (field)
- Contract: HD-2026-041 — WWTP Bình Dương

Forwarded verbatim by the engineer:

> Bơm định lượng NaOH số 2 ở trạm Bình Dương bị rò trục, hoá chất chảy ra sàn. Khách yêu cầu
> thay bơm mới trong tuần này. Model cũ là Prominent CONC0223. Gửi báo giá và lịch thay
> trước thứ Sáu nhé em.

(Gloss: NaOH dosing pump #2 at the Bình Dương plant is leaking at the shaft. The customer
wants it replaced this week; the old unit is a Prominent CONC0223. Quote and swap schedule
are due before Friday.)

## Clarifications
- 2026-09-01T02:31:10Z — Agent: "Bơm số 2 là bơm chạy chính hay bơm dự phòng?"
  Hải: "Chạy chính. Bơm số 1 đang chạy tạm, chỉ tải được 60%."
- 2026-09-01T03:05:44Z — Agent: "Khách có nhận model tương đương không, hay bắt buộc đúng CONC0223?"
  Hải: "Tương đương được, miễn đầu bơm PVDF và lưu lượng >= 22 l/h."
- 2026-09-01T03:07:02Z — Agent: "Bản vẽ P&ID của trạm có thuộc tài liệu mật không?"
  Hải: "Có. Để trên NAS thôi, đừng upload lên đâu hết."
- 2026-09-01T05:02:41Z — Khách gửi lại đầu trang báo giá cũ, agent lưu nguyên văn:
\## Báo giá thiết bị — Công ty TNHH Cấp Thoát Nước Bình Dương

## Evidence log
- 2026-09-01T04:12:08Z · teable · `tblEquipment/recCONC0223` — Bản ghi thiết bị bơm cũ, serial 2019-CONC-0442
- 2026-09-01T06:40:21Z · nas · `//nas-t3/plant-binhduong/confidential/pid/WWTP-BD-PID-rev4.pdf` — P&ID rev4, chỉ ghi đường dẫn tham chiếu, không tải bytes ra khỏi NAS
- 2026-09-02T01:55:00Z · minio · `evidence/T3-142/bao-gia-bom-NaOH-v2.pdf` — Báo giá bơm thay thế đã gửi khách, sha256 3f8ad41c9e2b7a06c5f1d38e94b0c7621fa5d0e83b47c9126ad5ef30b8c1d9aa
- 2026-09-02T02:10:47Z · git · `paperclipai/plant-configs@9a41c7f5b8c2e0d6a3f19b47ce8025d1a7f36b40` — Cập nhật thông số liều NaOH trong config trạm Bình Dương

## Scope changes
- 2026-09-01T07:22:19Z — Thêm hạng mục thay chân đế và ống hút PVC do phát hiện ăn mòn khi khảo sát; khách duyệt qua điện thoại lúc 14:05.
- 2026-09-02T03:48:05Z — Bỏ hạng mục hiệu chuẩn cảm biến pH khỏi phạm vi đơn này; chuyển sang gói bảo trì định kỳ tháng 10.

## Related Teable rows
- `https://teable.paperclip.local/table/tblEquipment/recCONC0223` — Thiết bị: bơm định lượng NaOH #2
- `https://teable.paperclip.local/table/tblContracts/recHD2026041` — Hợp đồng HD-2026-041
- `https://teable.paperclip.local/table/tblSites/recBinhDuongWWTP` — Trạm: WWTP Bình Dương


</details>

### T3-143 — Calibrate pH sensor, Bình Dương wastewater plant

Status: `cancelled`
Evidence: 1 total (0 link(s), 1 attachment(s))

Evidence index:
  - [manual] attachment: test-report.pdf (sha256 `bbbbbbbbbbbb`)

Scope changes:
  - 2026-09-02T03:48:05Z — Moved to the October maintenance package; out of this WP's scope.

<details>
<summary>Dossier</summary>

# Calibrate pH sensor, Bình Dương wastewater plant

## Job order
Calibrate pH sensor, Bình Dương wastewater plant

## Clarifications

## Evidence log

## Scope changes
- 2026-09-02T03:48:05Z — Moved to the October maintenance package; out of this WP's scope.

## Related Teable rows


</details>
