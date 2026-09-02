-- F-007-1: `issue_evidence_links` shipped empty in 0232, so this index cannot
-- fail on any existing deployment. If a fork DID accumulate duplicate
-- (issue_id, external_object_id) rows, CREATE UNIQUE INDEX aborts the whole
-- migration and the container will not start -- dedup by hand (keep the oldest
-- row per pair, as 0102 does) before re-running, rather than dropping the index.
CREATE UNIQUE INDEX "issue_evidence_links_issue_object_uq" ON "issue_evidence_links" USING btree ("issue_id","external_object_id");--> statement-breakpoint
-- F-011-1: forward-only and backward-compatible -- every row written before this
-- migration reads 'manual' (the 0233 default), so both CHECKs are satisfiable at
-- ADD CONSTRAINT time and the previous release keeps writing only values the
-- constraint accepts.
ALTER TABLE "issue_attachments" ADD CONSTRAINT "issue_attachments_source_check" CHECK ("issue_attachments"."source" in ('bot', 'manual', 'system'));--> statement-breakpoint
ALTER TABLE "issue_evidence_links" ADD CONSTRAINT "issue_evidence_links_source_check" CHECK ("issue_evidence_links"."source" in ('bot', 'manual', 'system'));
