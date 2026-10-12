import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { assets, issueAttachments, issues } from "@paperclipai/db";
import { HttpError, notFound } from "../errors.js";
import { isUniqueViolation } from "../db-errors.js";
import { countEvidenceForIssue, issueEvidenceLinkService, type IssueEvidenceCounts } from "./issue-evidence-links.js";
import {
  issueDossierService,
  parseScopeChanges,
  renderDossierMarkdown,
  toDossierTimestamp,
  type DossierActor,
  type DossierScopeChangeLine,
} from "./issue-dossier.js";
import { evidenceProvenanceService, type EvidenceWedgeMetricRow } from "./evidence-provenance.js";
import { documentService } from "./documents.js";

/**
 * PC-006 AC1: the markdown bundle a closed WP produces. Stored as a normal
 * (non-system) `issue_documents` row on the WP issue itself, key
 * `wp-close-export` -- the same generic keyed-document CRUD the dossier
 * (F-002-1) uses, no new persistence layer. Kept out of
 * `SYSTEM_ISSUE_DOCUMENT_KEYS` for the same reason as `dossier`: PC-502's
 * CTO retrieval test reads it back through ordinary document listing/search.
 */
export const WP_CLOSE_EXPORT_DOCUMENT_KEY = "wp-close-export" as const;
export const WP_CLOSE_EXPORT_TITLE = "WP-close export";

const MAX_PERSIST_ATTEMPTS = 3;

export interface WpCloseChildEvidenceRow {
  kind: "link" | "attachment";
  source: string;
  providerKey: string | null;
  externalId: string | null;
  displayTitle: string | null;
  sanitizedCanonicalUrl: string | null;
  originalFilename: string | null;
  sha256: string | null;
  createdAt: Date;
}

export interface WpCloseChildSummary {
  issueId: string;
  identifier: string | null;
  title: string;
  status: string;
  evidenceCounts: IssueEvidenceCounts;
  evidence: WpCloseChildEvidenceRow[];
  scopeChanges: DossierScopeChangeLine[];
  dossierMarkdown: string | null;
}

export interface WpCloseBundle {
  workPackageIssueId: string;
  workPackageIdentifier: string | null;
  workPackageTitle: string;
  generatedAt: string;
  children: WpCloseChildSummary[];
  wedge: EvidenceWedgeMetricRow;
  markdown: string;
}

interface ChildIssueRow {
  id: string;
  identifier: string | null;
  title: string;
  status: string;
}

/**
 * Every direct child of `parentId` (a WP's cards, `issues.parent_id`), company
 * scoped. Shared by the close gate (which only needs `status`) and the bundle
 * generator (which needs the full row) so the two can never disagree about
 * which cards belong to the WP.
 */
export async function listWorkPackageChildren(
  dbOrTx: Pick<Db, "select">,
  companyId: string,
  parentId: string,
): Promise<ChildIssueRow[]> {
  return dbOrTx
    .select({ id: issues.id, identifier: issues.identifier, title: issues.title, status: issues.status })
    .from(issues)
    .where(and(eq(issues.companyId, companyId), eq(issues.parentId, parentId)))
    .orderBy(asc(issues.sortOrder), asc(issues.createdAt)) as unknown as Promise<ChildIssueRow[]>;
}

/** Children whose status is neither `done` nor `cancelled` -- PC-006 AC1's close gate. */
export function incompleteWorkPackageChildren(children: ChildIssueRow[]): ChildIssueRow[] {
  return children.filter((child) => child.status !== "done" && child.status !== "cancelled");
}

function renderEvidenceRow(row: WpCloseChildEvidenceRow): string {
  if (row.kind === "link") {
    const ref = row.sanitizedCanonicalUrl ?? row.externalId ?? "";
    return `  - [${row.source}] ${row.providerKey ?? "external"}: ${row.displayTitle ?? ref} (\`${ref}\`)`;
  }
  const hash = row.sha256 ? row.sha256.slice(0, 12) : "unknown";
  return `  - [${row.source}] attachment: ${row.originalFilename ?? "(unnamed file)"} (sha256 \`${hash}\`)`;
}

function renderChildSection(child: WpCloseChildSummary): string {
  const lines: string[] = [];
  lines.push(`### ${child.identifier ?? child.issueId} — ${child.title}`);
  lines.push("");
  lines.push(`Status: \`${child.status}\``);
  lines.push(
    `Evidence: ${child.evidenceCounts.total} total (` +
      `${child.evidenceCounts.evidenceLinkCount} link(s), ${child.evidenceCounts.attachmentCount} attachment(s))`,
  );
  lines.push("");
  lines.push("Evidence index:");
  if (child.evidence.length === 0) {
    lines.push("  - (none)");
  } else {
    for (const row of child.evidence) lines.push(renderEvidenceRow(row));
  }
  lines.push("");
  lines.push("Scope changes:");
  if (child.scopeChanges.length === 0) {
    lines.push("  - (none)");
  } else {
    for (const change of child.scopeChanges) lines.push(`  - ${change.at} — ${change.note}`);
  }
  if (child.dossierMarkdown) {
    lines.push("");
    lines.push("<details>");
    lines.push("<summary>Dossier</summary>");
    lines.push("");
    lines.push(child.dossierMarkdown);
    lines.push("");
    lines.push("</details>");
  }
  return lines.join("\n");
}

function renderBundleMarkdown(input: {
  workPackageIssueId: string;
  workPackageIdentifier: string | null;
  workPackageTitle: string;
  generatedAt: string;
  children: WpCloseChildSummary[];
  wedge: EvidenceWedgeMetricRow;
}): string {
  const header = `# WP-close export — ${input.workPackageIdentifier ?? input.workPackageIssueId}`;
  const lines: string[] = [
    header,
    "",
    `## ${input.workPackageTitle}`,
    "",
    `Generated: ${input.generatedAt}`,
    "",
    "## Bot/manual evidence ratio",
    "",
    `- Sample size: ${input.wedge.sampleSize} (bot ${input.wedge.botCount}, manual ${input.wedge.manualCount}, ` +
      `system ${input.wedge.systemCount}, other ${input.wedge.otherCount})`,
    `- Ratio: ${input.wedge.ratio === null ? "n/a" : `${Math.round(input.wedge.ratio * 100)}%`}`,
    `- Band: \`${input.wedge.band}\``,
    "",
    "## Scope-change timeline",
    "",
  ];

  const timeline = input.children
    .flatMap((child) =>
      child.scopeChanges.map((change) => ({ ...change, issue: child.identifier ?? child.issueId })),
    )
    .sort((a, b) => a.at.localeCompare(b.at));
  if (timeline.length === 0) {
    lines.push("- (none)");
  } else {
    for (const entry of timeline) lines.push(`- ${entry.at} — ${entry.issue}: ${entry.note}`);
  }
  lines.push("");
  lines.push("## Cards");
  lines.push("");
  for (const child of input.children) {
    lines.push(renderChildSection(child));
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function wpCloseExportService(db: Db) {
  const dossierSvc = issueDossierService(db);
  const evidenceLinkSvc = issueEvidenceLinkService(db);
  const provenanceSvc = evidenceProvenanceService(db);
  const documentsSvc = documentService(db);

  async function collectChildSummary(companyId: string, child: ChildIssueRow): Promise<WpCloseChildSummary> {
    const [links, attachmentRows, counts, dossier] = await Promise.all([
      evidenceLinkSvc.listForIssue(child.id),
      db
        .select({
          source: issueAttachments.source,
          createdAt: issueAttachments.createdAt,
          originalFilename: assets.originalFilename,
          sha256: assets.sha256,
        })
        .from(issueAttachments)
        .innerJoin(assets, eq(issueAttachments.assetId, assets.id))
        .where(and(eq(issueAttachments.companyId, companyId), eq(issueAttachments.issueId, child.id))),
      countEvidenceForIssue(db, { companyId, issueId: child.id }),
      dossierSvc.get(child.id),
    ]);

    const evidence: WpCloseChildEvidenceRow[] = [
      ...links.map((link) => ({
        kind: "link" as const,
        source: link.source,
        providerKey: link.providerKey,
        externalId: link.externalId,
        displayTitle: link.displayTitle,
        sanitizedCanonicalUrl: link.sanitizedCanonicalUrl,
        originalFilename: null,
        sha256: null,
        createdAt: link.createdAt,
      })),
      ...attachmentRows.map((attachment) => ({
        kind: "attachment" as const,
        source: attachment.source,
        providerKey: null,
        externalId: null,
        displayTitle: null,
        sanitizedCanonicalUrl: null,
        originalFilename: attachment.originalFilename,
        sha256: attachment.sha256,
        createdAt: attachment.createdAt,
      })),
    ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    return {
      issueId: child.id,
      identifier: child.identifier,
      title: child.title,
      status: child.status,
      evidenceCounts: counts,
      evidence,
      scopeChanges: dossier ? parseScopeChanges(dossier.document) : [],
      dossierMarkdown: dossier ? renderDossierMarkdown(dossier.document) : null,
    };
  }

  /**
   * Pure read: assembles the bundle without writing anything. Used both by
   * the persist path below and by a manual preview/regenerate call.
   */
  async function generateBundle(companyId: string, workPackageIssueId: string): Promise<WpCloseBundle> {
    const [workPackage] = await db
      .select({ id: issues.id, identifier: issues.identifier, title: issues.title })
      .from(issues)
      .where(and(eq(issues.companyId, companyId), eq(issues.id, workPackageIssueId)));
    if (!workPackage) throw notFound("Issue not found");

    const childRows = await listWorkPackageChildren(db, companyId, workPackageIssueId);
    const children = await Promise.all(childRows.map((child) => collectChildSummary(companyId, child)));
    const [wedge] = await provenanceSvc.getWedgeMetric({
      companyId,
      groupBy: "work_package",
      workPackageIssueId,
    });

    const generatedAt = toDossierTimestamp(new Date());
    const resolvedWedge: EvidenceWedgeMetricRow = wedge ?? {
      groupBy: "work_package",
      groupKey: workPackageIssueId,
      sampleSize: 0,
      ratio: null,
      band: "extend_window",
      botCount: 0,
      manualCount: 0,
      systemCount: 0,
      otherCount: 0,
    };
    const markdown = renderBundleMarkdown({
      workPackageIssueId,
      workPackageIdentifier: workPackage.identifier,
      workPackageTitle: workPackage.title,
      generatedAt,
      children,
      wedge: resolvedWedge,
    });

    return {
      workPackageIssueId,
      workPackageIdentifier: workPackage.identifier,
      workPackageTitle: workPackage.title,
      generatedAt,
      children,
      wedge: resolvedWedge,
      markdown,
    };
  }

  return {
    generate: generateBundle,

    /**
     * Generates the bundle and persists it as the WP issue's
     * `wp-close-export` document. Re-reads the current revision before each
     * write attempt (mirroring `issueDossierService`'s `appendLines`
     * retry), so a regenerate after a fix never 409s on a stale
     * `baseRevisionId` and two concurrent regenerations both survive as two
     * revisions rather than one throwing.
     */
    generateAndPersist: async (
      companyId: string,
      workPackageIssueId: string,
      actor: DossierActor,
    ): Promise<WpCloseBundle> => {
      const bundle = await generateBundle(companyId, workPackageIssueId);
      let lastConflict: unknown;
      for (let attempt = 0; attempt < MAX_PERSIST_ATTEMPTS; attempt += 1) {
        const current = await documentsSvc.getIssueDocumentByKey(workPackageIssueId, WP_CLOSE_EXPORT_DOCUMENT_KEY);
        try {
          await documentsSvc.upsertIssueDocument({
            issueId: workPackageIssueId,
            key: WP_CLOSE_EXPORT_DOCUMENT_KEY,
            title: WP_CLOSE_EXPORT_TITLE,
            format: "markdown",
            body: bundle.markdown,
            baseRevisionId: current?.latestRevisionId ?? null,
            changeSummary: "WP-close export generated",
            createdByAgentId: actor.agentId ?? null,
            createdByUserId: actor.userId ?? null,
            createdByRunId: actor.runId ?? null,
          });
          return bundle;
        } catch (err) {
          const isConflict = (err instanceof HttpError && err.status === 409) || isUniqueViolation(err);
          if (!isConflict) throw err;
          lastConflict = err;
        }
      }
      throw lastConflict;
    },
  };
}
