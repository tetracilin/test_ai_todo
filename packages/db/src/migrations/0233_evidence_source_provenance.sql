ALTER TABLE "issue_attachments" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_evidence_links" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;