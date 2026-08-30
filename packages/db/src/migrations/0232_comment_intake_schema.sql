CREATE TABLE "comment_intake_checkpoints" (
	"source_id" uuid PRIMARY KEY NOT NULL,
	"cursor" text,
	"high_watermark_occurred_at" timestamp with time zone,
	"high_watermark_id" text,
	"last_success_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"consecutive_failure_count" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_intake_checkpoints_failures_nonnegative" CHECK ("comment_intake_checkpoints"."consecutive_failure_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "comment_intake_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"page_count" integer DEFAULT 0 NOT NULL,
	"candidate_count" integer DEFAULT 0 NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"rejected_count" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_detail" text
);
--> statement-breakpoint
CREATE TABLE "comment_intake_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"provider_key" text NOT NULL,
	"object_type" text NOT NULL,
	"source_scope_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"tag" text DEFAULT '@dev' NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "development_comment_intakes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"source_comment_id" text NOT NULL,
	"source_issue_id" uuid,
	"source_author_user_id" text,
	"source_created_at" timestamp with time zone NOT NULL,
	"source_updated_at" timestamp with time zone NOT NULL,
	"source_url" text,
	"tag" text DEFAULT '@dev' NOT NULL,
	"tag_positions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"request_body" text,
	"content_fingerprint" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"intake_status" text DEFAULT 'new' NOT NULL,
	"backlog_issue_id" uuid,
	"backlog_status_snapshot" text,
	"backlog_updated_at" timestamp with time zone,
	"dismissed_reason_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"redacted_at" timestamp with time zone,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "comment_intake_checkpoints" ADD CONSTRAINT "comment_intake_checkpoints_source_id_comment_intake_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."comment_intake_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_intake_runs" ADD CONSTRAINT "comment_intake_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_intake_runs" ADD CONSTRAINT "comment_intake_runs_source_id_comment_intake_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."comment_intake_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_intake_sources" ADD CONSTRAINT "comment_intake_sources_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_comment_intakes" ADD CONSTRAINT "development_comment_intakes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_comment_intakes" ADD CONSTRAINT "development_comment_intakes_source_id_comment_intake_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."comment_intake_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_comment_intakes" ADD CONSTRAINT "development_comment_intakes_source_issue_id_issues_id_fk" FOREIGN KEY ("source_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_comment_intakes" ADD CONSTRAINT "development_comment_intakes_backlog_issue_id_issues_id_fk" FOREIGN KEY ("backlog_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_intake_runs_source_started_idx" ON "comment_intake_runs" USING btree ("source_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "comment_intake_sources_company_scope_uq" ON "comment_intake_sources" USING btree ("company_id","provider_key","object_type","source_scope_id");--> statement-breakpoint
CREATE UNIQUE INDEX "comment_intake_sources_id_company_uq" ON "comment_intake_sources" USING btree ("id","company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "development_comment_intakes_company_dedupe_uq" ON "development_comment_intakes" USING btree ("company_id","dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "development_comment_intakes_backlog_issue_uq" ON "development_comment_intakes" USING btree ("backlog_issue_id") WHERE "development_comment_intakes"."backlog_issue_id" is not null;--> statement-breakpoint
CREATE INDEX "development_comment_intakes_company_status_created_idx" ON "development_comment_intakes" USING btree ("company_id","intake_status","source_created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "development_comment_intakes_company_kind_created_idx" ON "development_comment_intakes" USING btree ("company_id","kind","source_created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "development_comment_intakes_source_comment_idx" ON "development_comment_intakes" USING btree ("source_id","source_comment_id");--> statement-breakpoint
-- Composite company-integrity FKs are added after the referenced unique
-- indexes exist (drizzle-kit emits FK alters before index creates in the same
-- migration, which PostgreSQL rejects with 42830).
ALTER TABLE "development_comment_intakes" ADD CONSTRAINT "development_comment_intakes_source_company_fk" FOREIGN KEY ("source_id","company_id") REFERENCES "public"."comment_intake_sources"("id","company_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_comment_intakes" ADD CONSTRAINT "development_comment_intakes_backlog_company_fk" FOREIGN KEY ("company_id","backlog_issue_id") REFERENCES "public"."issues"("company_id","id") ON DELETE no action ON UPDATE no action;