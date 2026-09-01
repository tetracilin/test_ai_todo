CREATE TABLE "work_queue_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"queue_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"source_label" text,
	"status" text DEFAULT 'open' NOT NULL,
	"promoted_issue_id" uuid,
	"promoted_at" timestamp with time zone,
	"promoted_by_agent_id" uuid,
	"promoted_by_user_id" text,
	"dismissed_at" timestamp with time zone,
	"dismissed_by_agent_id" uuid,
	"dismissed_by_user_id" text,
	"dismiss_reason" text,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_queues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_queue_items" ADD CONSTRAINT "work_queue_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_queue_items" ADD CONSTRAINT "work_queue_items_queue_id_work_queues_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."work_queues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_queue_items" ADD CONSTRAINT "work_queue_items_promoted_issue_id_issues_id_fk" FOREIGN KEY ("promoted_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_queue_items" ADD CONSTRAINT "work_queue_items_promoted_by_agent_id_agents_id_fk" FOREIGN KEY ("promoted_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_queue_items" ADD CONSTRAINT "work_queue_items_dismissed_by_agent_id_agents_id_fk" FOREIGN KEY ("dismissed_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_queue_items" ADD CONSTRAINT "work_queue_items_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_queues" ADD CONSTRAINT "work_queues_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_queues" ADD CONSTRAINT "work_queues_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_queue_items_company_queue_status_idx" ON "work_queue_items" USING btree ("company_id","queue_id","status","created_at");--> statement-breakpoint
CREATE INDEX "work_queue_items_company_status_idx" ON "work_queue_items" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "work_queue_items_promoted_issue_idx" ON "work_queue_items" USING btree ("promoted_issue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_queues_company_slug_uq" ON "work_queues" USING btree ("company_id","slug");--> statement-breakpoint
CREATE INDEX "work_queues_company_updated_idx" ON "work_queues" USING btree ("company_id","updated_at");
