import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { artifacts } from "./artifacts.js";

/**
 * Comments on document artifacts (kind = "document"). Attachment-only artifacts
 * are not commentable; the service enforces that invariant.
 */
export const artifactComments = pgTable(
  "artifact_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    artifactId: uuid("artifact_id").notNull().references(() => artifacts.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    authorAgentId: uuid("author_agent_id").references(() => agents.id, { onDelete: "set null" }),
    authorUserId: text("author_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyArtifactCreatedIdx: index("artifact_comments_company_artifact_created_idx").on(
      table.companyId,
      table.artifactId,
      table.createdAt,
    ),
  }),
);
