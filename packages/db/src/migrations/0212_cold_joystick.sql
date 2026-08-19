CREATE TABLE "issue_scheduling" (
	"issue_id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone,
	"defer_until" timestamp with time zone,
	"scheduled_duration_minutes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduling_routines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"assignee_agent_id" uuid,
	"assignee_user_id" text,
	"priority" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"recurrence_rule" jsonb NOT NULL,
	"scheduled_time" text,
	"estimate_minutes" integer,
	"last_generated_for_date" text,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "issue_scheduling" ADD CONSTRAINT "issue_scheduling_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_scheduling" ADD CONSTRAINT "issue_scheduling_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling_routines" ADD CONSTRAINT "scheduling_routines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling_routines" ADD CONSTRAINT "scheduling_routines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling_routines" ADD CONSTRAINT "scheduling_routines_assignee_agent_id_agents_id_fk" FOREIGN KEY ("assignee_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling_routines" ADD CONSTRAINT "scheduling_routines_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_scheduling_company_scheduled_at_idx" ON "issue_scheduling" USING btree ("company_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "issue_scheduling_company_defer_until_idx" ON "issue_scheduling" USING btree ("company_id","defer_until");--> statement-breakpoint
CREATE INDEX "scheduling_routines_company_status_idx" ON "scheduling_routines" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "scheduling_routines_company_assignee_idx" ON "scheduling_routines" USING btree ("company_id","assignee_agent_id");--> statement-breakpoint
CREATE INDEX "scheduling_routines_company_project_idx" ON "scheduling_routines" USING btree ("company_id","project_id");