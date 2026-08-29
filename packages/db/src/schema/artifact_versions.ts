import { pgTable, uuid, text, integer, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { artifacts } from "./artifacts.js";

/**
 * One immutable snapshot of an artifact's content. `versionNumber` increments
 * monotonically per artifact. `versionName` is user-supplied (required for
 * manual docx/xlsx versions, auto-generated for markdown auto-versions).
 * `provider` + `objectKey` reference the stored bytes in the version's source
 * storage; `isAutomatic` marks markdown auto-versions.
 */
export const artifactVersions = pgTable(
  "artifact_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    artifactId: uuid("artifact_id").notNull().references(() => artifacts.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    versionName: text("version_name"),
    source: text("source").notNull().default("internal"),
    provider: text("provider").notNull(),
    objectKey: text("object_key").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256").notNull(),
    changeSummary: text("change_summary"),
    isAutomatic: boolean("is_automatic").notNull().default(false),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    artifactVersionUq: uniqueIndex("artifact_versions_artifact_version_uq").on(
      table.artifactId,
      table.versionNumber,
    ),
    companyArtifactCreatedIdx: index("artifact_versions_company_artifact_created_idx").on(
      table.companyId,
      table.artifactId,
      table.createdAt,
    ),
    artifactObjectKeyIdx: index("artifact_versions_artifact_object_key_idx").on(
      table.artifactId,
      table.objectKey,
    ),
  }),
);
