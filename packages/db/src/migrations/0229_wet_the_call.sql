ALTER TABLE "issues" ADD COLUMN "progress" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;