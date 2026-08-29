CREATE TABLE "artifact_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"artifact_id" uuid NOT NULL,
	"body" text NOT NULL,
	"author_agent_id" uuid,
	"author_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifact_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"artifact_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"version_name" text,
	"source" text DEFAULT 'internal' NOT NULL,
	"provider" text NOT NULL,
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"change_summary" text,
	"is_automatic" boolean DEFAULT false NOT NULL,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"kind" text DEFAULT 'attachment' NOT NULL,
	"format" text,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"current_version_id" uuid,
	"current_version_number" integer DEFAULT 0 NOT NULL,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifact_comments" ADD CONSTRAINT "artifact_comments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_comments" ADD CONSTRAINT "artifact_comments_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_comments" ADD CONSTRAINT "artifact_comments_author_agent_id_agents_id_fk" FOREIGN KEY ("author_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifact_comments_company_artifact_created_idx" ON "artifact_comments" USING btree ("company_id","artifact_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_versions_artifact_version_uq" ON "artifact_versions" USING btree ("artifact_id","version_number");--> statement-breakpoint
CREATE INDEX "artifact_versions_company_artifact_created_idx" ON "artifact_versions" USING btree ("company_id","artifact_id","created_at");--> statement-breakpoint
CREATE INDEX "artifact_versions_artifact_object_key_idx" ON "artifact_versions" USING btree ("artifact_id","object_key");--> statement-breakpoint
CREATE INDEX "artifacts_company_issue_idx" ON "artifacts" USING btree ("company_id","issue_id");--> statement-breakpoint
CREATE INDEX "artifacts_company_created_idx" ON "artifacts" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "artifacts_current_version_idx" ON "artifacts" USING btree ("current_version_id");