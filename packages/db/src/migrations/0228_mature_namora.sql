ALTER TABLE "issue_scheduling" DROP CONSTRAINT "issue_scheduling_issue_id_issues_id_fk";
--> statement-breakpoint
ALTER TABLE "scheduling_routines" DROP CONSTRAINT "scheduling_routines_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "scheduling_routines" ALTER COLUMN "last_generated_for_date" SET DATA TYPE date USING "last_generated_for_date"::date;--> statement-breakpoint
ALTER TABLE "scheduling_routines" ADD COLUMN "timezone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "agents_company_id_unique_idx" ON "agents" USING btree ("company_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "issues_company_id_unique_idx" ON "issues" USING btree ("company_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_company_id_unique_idx" ON "projects" USING btree ("company_id","id");--> statement-breakpoint
ALTER TABLE "issue_scheduling" ADD CONSTRAINT "issue_scheduling_company_issue_fk" FOREIGN KEY ("company_id","issue_id") REFERENCES "public"."issues"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling_routines" ADD CONSTRAINT "scheduling_routines_company_project_fk" FOREIGN KEY ("company_id","project_id") REFERENCES "public"."projects"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling_routines" ADD CONSTRAINT "scheduling_routines_company_assignee_agent_fk" FOREIGN KEY ("company_id","assignee_agent_id") REFERENCES "public"."agents"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling_routines" ADD CONSTRAINT "scheduling_routines_company_created_by_agent_fk" FOREIGN KEY ("company_id","created_by_agent_id") REFERENCES "public"."agents"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_scheduling" ADD CONSTRAINT "issue_scheduling_positive_duration_check" CHECK ("issue_scheduling"."scheduled_duration_minutes" is null or "issue_scheduling"."scheduled_duration_minutes" > 0);--> statement-breakpoint
ALTER TABLE "scheduling_routines" ADD CONSTRAINT "scheduling_routines_positive_estimate_check" CHECK ("scheduling_routines"."estimate_minutes" is null or "scheduling_routines"."estimate_minutes" > 0);--> statement-breakpoint
ALTER TABLE "scheduling_routines" ADD CONSTRAINT "scheduling_routines_non_empty_timezone_check" CHECK (btrim("scheduling_routines"."timezone") <> '');