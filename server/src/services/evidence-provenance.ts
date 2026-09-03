import { sql, type SQL } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { issueAttachments, issueEvidenceLinks, issues } from "@paperclipai/db";

// PC-011 (design-record OV-5): the wedge metric `wp0_evidence_via_bot` is the
// ratio of evidence filed by the chat bot over all evidence a PERSON was
// involved in filing, read from real columns rather than hand-tallied.
// Provenance is recorded per FILING ACT (see `EvidenceSource` in
// packages/db/src/schema/issue_evidence_links.ts), so the ratio counts rows
// across BOTH filing tables: `issue_evidence_links` (a link to an external
// object) and `issue_attachments` (an uploaded file).

// The union is declared once in the schema layer; derive it here so the service
// and the DB column can never drift. Exported because provenance is decided by
// the WRITERS (the evidence-link service, `issueService().createAttachment`)
// and this module is the reader that gives the value its meaning -- one type,
// one home, no second copy to drift.
export type EvidenceSource = (typeof issueEvidenceLinks.$inferSelect)["source"];

const BOT_SOURCE: EvidenceSource = "bot";
const MANUAL_SOURCE: EvidenceSource = "manual";
const SYSTEM_SOURCE: EvidenceSource = "system";

/**
 * PC-011 AC3 pilot bands, as a mechanical call — no judgment at read time.
 *   >=80% bot  -> pass
 *   50-79%     -> iterate
 *   <50%       -> abort
 * Below the minimum sample the band is not called at all; the answer is
 * "extend the window", and the caller reports the n it actually has.
 */
export const EVIDENCE_WEDGE_MINIMUM_SAMPLE = 15;
export const EVIDENCE_WEDGE_PASS_PERCENT = 80;
export const EVIDENCE_WEDGE_ITERATE_PERCENT = 50;

export type EvidenceWedgeBand = "pass" | "iterate" | "abort" | "extend_window";

export type EvidenceWedgeGroupBy = "company" | "engineer" | "work_package";

export interface EvidenceWedgeBandCall {
  /**
   * Denominator of the ratio, and the n the minimum-sample rule is applied to:
   * every filing act in the window EXCEPT `system` ones (see `systemCount`),
   * including any whose `source` is outside the known union (see `otherCount`).
   */
  sampleSize: number;
  /** bot / sampleSize, or null when nothing ratio-bearing was filed. */
  ratio: number | null;
  band: EvidenceWedgeBand;
}

export interface EvidenceWedgeMetricRow extends EvidenceWedgeBandCall {
  groupBy: EvidenceWedgeGroupBy;
  /**
   * `company` -> the company id; `engineer` -> `issues.assignee_user_id`;
   * `work_package` -> `issues.parent_id`, the parent card a WP is closed on
   * (PC-006 AC1). Null when the grouped issues carry no assignee / no parent.
   */
  groupKey: string | null;
  botCount: number;
  manualCount: number;
  /**
   * Filing acts nobody authored: auto-linked git commits and other
   * system-generated filings (gate decision UC-1, 2026-09-03). They are neither
   * a bot capture nor a human re-entry, so they are excluded from BOTH sides of
   * the ratio AND from `sampleSize`. The minimum-n rule asks "have enough
   * bot-vs-manual filings happened to judge the bot yet?"; a system row answers
   * that question neither way, so counting it toward n would call a band on a
   * sample that never held 15 human-or-bot filings. The pilot's own card type
   * files most of its evidence as auto-linked commits, and counting those as
   * `manual` would suppress the ratio however well the bot performed.
   *
   * Counted and returned rather than filtered away in SQL: the exclusion has to
   * be visible, so a reader can always see how much of the window was
   * system-filed and why n is smaller than the row count.
   */
  systemCount: number;
  /**
   * Filing acts whose `source` is none of 'bot', 'manual' or 'system'. Both
   * evidence tables now carry a CHECK constraint, so a writer going through
   * Postgres cannot produce one -- but `source` is a plain `text` column, and
   * rows written before the constraint, or restored from an older dump, still
   * can. Those rows stay in `sampleSize` (they really were filing acts, and
   * nothing says a human was not behind them) and are surfaced here rather than
   * silently dropped: an unexpected non-zero value means a writer is out of
   * contract, and the ratio it produces under-counts `bot`, which is the safe
   * direction.
   */
  otherCount: number;
}

export interface EvidenceWedgeMetricInput {
  companyId: string;
  /** Inclusive lower bound on the filing act's `created_at`. */
  from?: Date;
  /** Inclusive upper bound on the filing act's `created_at`. */
  to?: Date;
  groupBy?: EvidenceWedgeGroupBy;
  /** Restrict to one engineer (`issues.assignee_user_id`). */
  engineerUserId?: string;
  /** Restrict to one work package (`issues.parent_id`). */
  workPackageIssueId?: string;
}

/**
 * Turn a filing-act tally into the PC-011 AC3 band call. Comparisons are
 * integer so a boundary (exactly 80%, exactly 50%) never depends on float
 * rounding.
 *
 * `system` filings are not a parameter here at all: the ratio is
 * `bot / (bot + manual)`, the caller has already left them out, and with no
 * argument to pass them through they cannot reach the arithmetic by mistake.
 *
 * `otherCount` is filing acts whose `source` fell outside the known union. They
 * belong in the denominator: they are real filings that may well have been
 * hand-entered, and dropping them would shrink n (possibly under the minimum
 * sample, silently withholding a band that should have been called) while
 * inflating the bot ratio. Counted this way an out-of-contract writer can only
 * drag the ratio DOWN, which is the safe failure direction for a pilot gate.
 */
export function callEvidenceWedgeBand(
  botCount: number,
  manualCount: number,
  otherCount = 0,
): EvidenceWedgeBandCall {
  const sampleSize = botCount + manualCount + otherCount;
  if (sampleSize === 0) return { sampleSize: 0, ratio: null, band: "extend_window" };
  const ratio = botCount / sampleSize;
  if (sampleSize < EVIDENCE_WEDGE_MINIMUM_SAMPLE) return { sampleSize, ratio, band: "extend_window" };
  if (botCount * 100 >= sampleSize * EVIDENCE_WEDGE_PASS_PERCENT) return { sampleSize, ratio, band: "pass" };
  if (botCount * 100 >= sampleSize * EVIDENCE_WEDGE_ITERATE_PERCENT) return { sampleSize, ratio, band: "iterate" };
  return { sampleSize, ratio, band: "abort" };
}

interface RawWedgeRow {
  group_key: string | null;
  total_count: number | string;
  bot_count: number | string;
  manual_count: number | string;
  system_count: number | string;
}

export function evidenceProvenanceService(db: Db) {
  function groupKeyExpression(groupBy: EvidenceWedgeGroupBy): SQL {
    if (groupBy === "engineer") return sql`i.assignee_user_id`;
    if (groupBy === "work_package") return sql`i.parent_id::text`;
    return sql`i.company_id::text`;
  }

  return {
    /**
     * PC-011 AC3: the bot/(bot+manual) ratio over a date range, grouped per
     * engineer or per work package, counting both evidence tables. `system`
     * filings are counted and returned but excluded from the ratio and from n
     * (see `systemCount`). Each row carries its own band call and the n behind
     * it.
     */
    async getWedgeMetric(input: EvidenceWedgeMetricInput): Promise<EvidenceWedgeMetricRow[]> {
      const groupBy: EvidenceWedgeGroupBy = input.groupBy ?? "company";
      const conditions: SQL[] = [];
      // Both bounds are INCLUSIVE: a filing act stamped exactly at `from`, or
      // exactly at `to`, is inside the window.
      if (input.from) conditions.push(sql`f.created_at >= ${input.from.toISOString()}::timestamptz`);
      if (input.to) conditions.push(sql`f.created_at <= ${input.to.toISOString()}::timestamptz`);
      if (input.engineerUserId) conditions.push(sql`i.assignee_user_id = ${input.engineerUserId}`);
      if (input.workPackageIssueId) conditions.push(sql`i.parent_id = ${input.workPackageIssueId}::uuid`);
      const filter = conditions.length > 0 ? sql` AND ${sql.join(conditions, sql` AND `)}` : sql``;

      // One filing act per row, whichever table it landed in. The company scope
      // is applied on each arm so both indexed company columns are usable.
      const rows = (await db.execute(sql`
        WITH filings AS (
          SELECT link.issue_id, link.source, link.created_at
          FROM ${issueEvidenceLinks} AS link
          WHERE link.company_id = ${input.companyId}::uuid
          UNION ALL
          SELECT attachment.issue_id, attachment.source, attachment.created_at
          FROM ${issueAttachments} AS attachment
          WHERE attachment.company_id = ${input.companyId}::uuid
        )
        SELECT
          ${groupKeyExpression(groupBy)} AS group_key,
          -- count(*) is EVERY filing act, 'system' and off-contract sources
          -- included. It is NOT the ratio denominator; it is what lets the
          -- reader derive otherCount without a second pass, so no row can be
          -- present in the table and absent from the answer.
          count(*)::int AS total_count,
          count(*) FILTER (WHERE f.source = ${BOT_SOURCE})::int AS bot_count,
          count(*) FILTER (WHERE f.source = ${MANUAL_SOURCE})::int AS manual_count,
          count(*) FILTER (WHERE f.source = ${SYSTEM_SOURCE})::int AS system_count
        FROM filings f
        JOIN ${issues} AS i ON i.id = f.issue_id
        WHERE i.company_id = ${input.companyId}::uuid${filter}
        GROUP BY 1
        ORDER BY 1 NULLS LAST
      `)) as unknown as Iterable<RawWedgeRow>;

      const grouped = Array.from(rows).map((row) => {
        const botCount = Number(row.bot_count ?? 0);
        const manualCount = Number(row.manual_count ?? 0);
        const systemCount = Number(row.system_count ?? 0);
        const otherCount = Math.max(
          0,
          Number(row.total_count ?? 0) - botCount - manualCount - systemCount,
        );
        return {
          groupBy,
          groupKey: row.group_key ?? null,
          botCount,
          manualCount,
          systemCount,
          otherCount,
          ...callEvidenceWedgeBand(botCount, manualCount, otherCount),
        };
      });

      // A company-wide read always answers, even for an empty window: the band
      // call for n=0 is "extend the window", which is the honest answer rather
      // than no row at all. Grouped reads stay sparse -- there is no row to
      // invent for an engineer or a WP that filed nothing.
      if (groupBy === "company" && grouped.length === 0) {
        return [
          {
            groupBy,
            groupKey: input.companyId,
            botCount: 0,
            manualCount: 0,
            systemCount: 0,
            otherCount: 0,
            ...callEvidenceWedgeBand(0, 0),
          },
        ];
      }
      return grouped;
    },
  };
}
