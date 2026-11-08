CREATE TABLE "calendar_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid,
	"title" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_by_user_id" text,
	"created_by_agent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_events_valid_range_check" CHECK ("calendar_events"."ends_at" > "calendar_events"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_company_issue_fk" FOREIGN KEY ("company_id","issue_id") REFERENCES "public"."issues"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_events_company_starts_at_idx" ON "calendar_events" USING btree ("company_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_events_issue_unique_idx" ON "calendar_events" USING btree ("issue_id") WHERE "calendar_events"."issue_id" is not null;
--> statement-breakpoint
-- backfill: one pinned event per already-scheduled issue (30 minutes when no duration was set)
INSERT INTO "calendar_events" ("company_id", "issue_id", "title", "starts_at", "ends_at")
SELECT s."company_id", s."issue_id", i."title", s."scheduled_at",
       s."scheduled_at" + (COALESCE(s."scheduled_duration_minutes", 30) * interval '1 minute')
FROM "issue_scheduling" s
JOIN "issues" i ON i."id" = s."issue_id" AND i."company_id" = s."company_id"
WHERE s."scheduled_at" IS NOT NULL
ON CONFLICT DO NOTHING;
