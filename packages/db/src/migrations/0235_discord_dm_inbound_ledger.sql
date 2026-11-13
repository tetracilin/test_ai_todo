CREATE TABLE "discord_dm_inbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"discord_user_id" text NOT NULL,
	"discord_message_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"error_code" text,
	"message_created_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "discord_dm_inbound_messages" ADD CONSTRAINT "discord_dm_inbound_messages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "discord_dm_inbound_messages_message_uq" ON "discord_dm_inbound_messages" USING btree ("discord_message_id");--> statement-breakpoint
CREATE INDEX "discord_dm_inbound_messages_user_created_idx" ON "discord_dm_inbound_messages" USING btree ("discord_user_id","message_created_at");