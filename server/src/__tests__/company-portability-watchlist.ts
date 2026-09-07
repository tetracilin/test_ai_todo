/**
 * The portability watchlist (PC-012).
 *
 * # What this is
 *
 * The curated list of tables a company export is EXPECTED to carry, and the
 * manifest field each one travels in. `company-portability-registration.test.ts`
 * reads it and fails the build when an entry claims to be carried but the
 * bundle format cannot actually express it.
 *
 * # Why it is curated and not exhaustive
 *
 * There are ~122 schema files in `packages/db/src/schema`, ~108 of them
 * company-scoped, against a manifest that covers roughly fifteen entities. A
 * guard that demanded day-one classification of all the rest would make
 * "append an exclusion line" the cheapest way to turn a new table green --
 * which is precisely the habit this check exists to replace. So the watchlist
 * is a deliberate, human-maintained list: adding a table here is a statement
 * that a company export is supposed to carry it, and the test then holds that
 * statement to account.
 *
 * # Adding an entry
 *
 * Carried entry: give it a `manifestPath`, and extend `WATCHLIST_FIXTURE_FILES`
 * below so the fixture bundle actually exercises the field. The test parses that
 * bundle through the real manifest builder, so an entry whose implementation is
 * missing resolves to nothing and fails.
 *
 * Excluded entry: give it a `reason` from `WATCHLIST_EXCLUSION_REASONS` and a
 * one-line `note` saying why. A reason code is required so exclusions stay
 * reviewable as a set rather than accumulating as free text.
 */

import {
  activityLog,
  agents,
  approvals,
  assets,
  companies,
  companySecrets,
  companySkills,
  costEvents,
  externalObjectMentions,
  externalObjects,
  heartbeatRuns,
  issueAttachments,
  issueComments,
  issueDocuments,
  issueEvidenceLinks,
  issueLabels,
  issueRelations,
  issueWorkProducts,
  issues,
  labels,
  projectWorkspaces,
  projects,
} from "@paperclipai/db";
import type { PgTable } from "drizzle-orm/pg-core";

/** Why a watched table deliberately does not travel in a company bundle. */
export const WATCHLIST_EXCLUSION_REASONS = {
  /** Rebuilt on import from data the bundle already carries. */
  derived: "derived",
  /** Only meaningful inside the instance that produced it (runtime ids, leases, sessions). */
  instance_local: "instance_local",
  /** Operational history rather than company definition; the fidelity report warns on it. */
  operational_history: "operational_history",
  /** Secret material that must not leave the instance. */
  security_boundary: "security_boundary",
} as const;

export type WatchlistExclusionReason = keyof typeof WATCHLIST_EXCLUSION_REASONS;

export interface CarriedWatchlistEntry {
  /** The drizzle table, so a rename cannot leave a stale string behind. */
  table: PgTable;
  /**
   * Where the entity lands in `CompanyPortabilityManifest`, in dotted form.
   * `[]` marks an array the path descends into, e.g. `issues[].evidenceLinks`.
   */
  manifestPath: string;
}

export interface ExcludedWatchlistEntry {
  table: PgTable;
  reason: WatchlistExclusionReason;
  note: string;
}

export const PORTABILITY_WATCHLIST_CARRIED: CarriedWatchlistEntry[] = [
  { table: companies, manifestPath: "company" },
  { table: agents, manifestPath: "agents" },
  { table: companySkills, manifestPath: "skills" },
  { table: projects, manifestPath: "projects" },
  { table: projectWorkspaces, manifestPath: "projects[].workspaces" },
  { table: issues, manifestPath: "issues" },
  { table: issueComments, manifestPath: "issues[].comments" },
  { table: issueDocuments, manifestPath: "issues[].documents" },
  { table: issueWorkProducts, manifestPath: "issues[].workProducts" },
  { table: issueRelations, manifestPath: "issues[].blockedBy" },
  { table: labels, manifestPath: "labels" },
  { table: issueLabels, manifestPath: "issues[].labelNames" },
  { table: assets, manifestPath: "blobs" },
  { table: issueAttachments, manifestPath: "issues[].attachments" },
  // PC-012: the evidence substrate. `external_objects` is listed first because
  // every `issue_evidence_links` row is a NOT NULL foreign key onto it --
  // registering the link table alone imports as an FK violation, not as a
  // restored link.
  { table: externalObjects, manifestPath: "externalObjects" },
  { table: issueEvidenceLinks, manifestPath: "issues[].evidenceLinks" },
];

export const PORTABILITY_WATCHLIST_EXCLUDED: ExcludedWatchlistEntry[] = [
  {
    table: approvals,
    reason: "operational_history",
    note: "Governance decisions belong to the instance that made them; the fidelity report counts what is left behind.",
  },
  {
    table: costEvents,
    reason: "operational_history",
    note: "Spend history is tied to this instance's billing, not to the company definition.",
  },
  {
    table: activityLog,
    reason: "operational_history",
    note: "An audit trail of actions taken here; re-homing it would misattribute them to the destination board.",
  },
  {
    table: heartbeatRuns,
    reason: "instance_local",
    note: "Run rows point at workspaces, adapters, and sessions that do not exist on the destination.",
  },
  {
    table: externalObjectMentions,
    reason: "derived",
    note: "Wholesale deleted and re-inserted by text sync, so the destination rebuilds them from the imported text.",
  },
  {
    table: companySecrets,
    reason: "security_boundary",
    note: "Secret material never leaves the instance; the bundle carries env INPUT declarations for the operator to refill.",
  },
];

const FIXTURE_BLOB_SHA = "0000000000000000000000000000000000000000000000000000000000000000";

/**
 * One bundle that exercises every carried entry above.
 *
 * Parsed through the real manifest builder by the registration test, so it is
 * what gives `manifestPath` its teeth: a path with no implementation behind it
 * resolves to nothing here.
 */
export const WATCHLIST_FIXTURE_FILES: Record<string, string> = {
  "COMPANY.md": [
    "---",
    'schema: "agentcompanies/v1"',
    'name: "Watchlist Fixture Co"',
    'description: "Every entity a company export is expected to carry."',
    "---",
    "",
  ].join("\n"),
  "agents/scribe/AGENTS.md": [
    "---",
    'name: "Scribe"',
    'role: "agent"',
    "---",
    "",
    "Fixture agent.",
    "",
  ].join("\n"),
  "skills/filing/SKILL.md": [
    "---",
    'name: "Filing"',
    'description: "Fixture skill."',
    "---",
    "",
    "Fixture skill body.",
    "",
  ].join("\n"),
  "projects/pilot/PROJECT.md": [
    "---",
    'name: "Pilot"',
    "kind: project",
    "---",
    "",
    "Fixture project.",
    "",
  ].join("\n"),
  "tasks/blocker-card/TASK.md": [
    "---",
    'name: "Blocker card"',
    "kind: task",
    "---",
    "",
    "Blocks the evidence card.",
    "",
  ].join("\n"),
  "tasks/evidence-card/TASK.md": [
    "---",
    'name: "Evidence card"',
    "kind: task",
    'project: "pilot"',
    "---",
    "",
    "Carries one of everything.",
    "",
  ].join("\n"),
  "tasks/evidence-card/documents/dossier.md": "Dossier body.\n",
  ".paperclip.yaml": [
    'schema: "paperclip/v1"',
    "schemaVersion: 8",
    "labels:",
    "  -",
    '    name: "evidence"',
    '    color: "#ff0000"',
    "blobs:",
    "  -",
    `    sha256: "${FIXTURE_BLOB_SHA}"`,
    "    byteSize: 9",
    '    contentType: "application/octet-stream"',
    "externalObjects:",
    "  -",
    '    ref: "teable:row:tbl-1/rec-1"',
    '    providerKey: "teable"',
    '    objectType: "row"',
    '    externalId: "tbl-1/rec-1"',
    '    sanitizedCanonicalUrl: "https://teable.example.com/tbl-1/rec-1"',
    '    displayTitle: "Intake row"',
    "projects:",
    "  pilot:",
    '    status: "active"',
    "    workspaces:",
    "      main:",
    '        name: "Main"',
    "        isPrimary: true",
    "tasks:",
    "  blocker-card:",
    '    status: "done"',
    '    priority: "medium"',
    "  evidence-card:",
    '    status: "todo"',
    '    priority: "medium"',
    "    labels:",
    '      - "evidence"',
    "    blockedBy:",
    '      - "blocker-card"',
    "    comments:",
    "      -",
    '        body: "Filed the dossier."',
    '        authorType: "system"',
    "    documents:",
    "      -",
    '        key: "dossier"',
    '        title: "Dossier"',
    '        format: "markdown"',
    '        path: "tasks/evidence-card/documents/dossier.md"',
    "    workProducts:",
    "      -",
    '        type: "document"',
    '        provider: "paperclip"',
    '        title: "Handover"',
    '        status: "open"',
    "    attachments:",
    "      -",
    `        sha256: "${FIXTURE_BLOB_SHA}"`,
    '        contentType: "application/octet-stream"',
    '        originalFilename: "notes.bin"',
    "        byteSize: 9",
    '        source: "bot"',
    "    evidenceLinks:",
    "      -",
    '        objectRef: "teable:row:tbl-1/rec-1"',
    '        source: "bot"',
    '        createdAt: "2026-09-01T00:00:00.000Z"',
    "",
  ].join("\n"),
};
