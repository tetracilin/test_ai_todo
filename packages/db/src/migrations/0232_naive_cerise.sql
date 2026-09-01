CREATE TABLE "issue_evidence_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"external_object_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "evidence_gate_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_evidence_links" ADD CONSTRAINT "issue_evidence_links_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_evidence_links" ADD CONSTRAINT "issue_evidence_links_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_evidence_links" ADD CONSTRAINT "issue_evidence_links_external_object_id_external_objects_id_fk" FOREIGN KEY ("external_object_id") REFERENCES "public"."external_objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_evidence_links_company_issue_idx" ON "issue_evidence_links" USING btree ("company_id","issue_id");
