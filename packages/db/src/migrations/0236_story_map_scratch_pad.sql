CREATE TABLE "scratch_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"author_user_id" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"promoted_story_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_map_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"map_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_map_epics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"map_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_map_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"map_id" uuid NOT NULL,
	"name" text NOT NULL,
	"target_date" date,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_map_stories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"map_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"epic_id" uuid,
	"release_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"acceptance_criteria" text,
	"size" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_map_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"map_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_maps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scratch_notes" ADD CONSTRAINT "scratch_notes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scratch_notes" ADD CONSTRAINT "scratch_notes_promoted_story_id_story_map_stories_id_fk" FOREIGN KEY ("promoted_story_id") REFERENCES "public"."story_map_stories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_map_activities" ADD CONSTRAINT "story_map_activities_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_map_activities" ADD CONSTRAINT "story_map_activities_map_id_story_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."story_maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_map_epics" ADD CONSTRAINT "story_map_epics_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_map_epics" ADD CONSTRAINT "story_map_epics_map_id_story_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."story_maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_map_epics" ADD CONSTRAINT "story_map_epics_task_id_story_map_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."story_map_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_map_releases" ADD CONSTRAINT "story_map_releases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_map_releases" ADD CONSTRAINT "story_map_releases_map_id_story_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."story_maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_map_stories" ADD CONSTRAINT "story_map_stories_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_map_stories" ADD CONSTRAINT "story_map_stories_map_id_story_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."story_maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_map_stories" ADD CONSTRAINT "story_map_stories_task_id_story_map_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."story_map_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_map_stories" ADD CONSTRAINT "story_map_stories_epic_id_story_map_epics_id_fk" FOREIGN KEY ("epic_id") REFERENCES "public"."story_map_epics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_map_stories" ADD CONSTRAINT "story_map_stories_release_id_story_map_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."story_map_releases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_map_tasks" ADD CONSTRAINT "story_map_tasks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_map_tasks" ADD CONSTRAINT "story_map_tasks_map_id_story_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."story_maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_map_tasks" ADD CONSTRAINT "story_map_tasks_activity_id_story_map_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."story_map_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_maps" ADD CONSTRAINT "story_maps_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scratch_notes_company_created_idx" ON "scratch_notes" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "story_map_activities_map_position_idx" ON "story_map_activities" USING btree ("map_id","position");--> statement-breakpoint
CREATE INDEX "story_map_epics_task_position_idx" ON "story_map_epics" USING btree ("task_id","position");--> statement-breakpoint
CREATE INDEX "story_map_epics_map_idx" ON "story_map_epics" USING btree ("map_id");--> statement-breakpoint
CREATE INDEX "story_map_releases_map_position_idx" ON "story_map_releases" USING btree ("map_id","position");--> statement-breakpoint
CREATE INDEX "story_map_stories_task_position_idx" ON "story_map_stories" USING btree ("task_id","position");--> statement-breakpoint
CREATE INDEX "story_map_stories_release_idx" ON "story_map_stories" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "story_map_stories_epic_idx" ON "story_map_stories" USING btree ("epic_id");--> statement-breakpoint
CREATE INDEX "story_map_stories_map_idx" ON "story_map_stories" USING btree ("map_id");--> statement-breakpoint
CREATE INDEX "story_map_tasks_activity_position_idx" ON "story_map_tasks" USING btree ("activity_id","position");--> statement-breakpoint
CREATE INDEX "story_map_tasks_map_idx" ON "story_map_tasks" USING btree ("map_id");--> statement-breakpoint
CREATE UNIQUE INDEX "story_maps_company_uq" ON "story_maps" USING btree ("company_id");