CREATE TABLE "discord_guild_integrations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "guild_id" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "discord_guild_integrations_company_guild_uq" ON "discord_guild_integrations" ("company_id", "guild_id");
--> statement-breakpoint
CREATE TABLE "discord_project_channel_mappings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "guild_id" text NOT NULL,
  "channel_id" text NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "enabled" boolean DEFAULT true NOT NULL,
  "allow_task_create" boolean DEFAULT false NOT NULL,
  "notification_events" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "discord_project_channel_mappings_guild_channel_uq" ON "discord_project_channel_mappings" ("guild_id", "channel_id");
--> statement-breakpoint
CREATE INDEX "discord_project_channel_mappings_project_idx" ON "discord_project_channel_mappings" ("company_id", "project_id");
--> statement-breakpoint
CREATE TABLE "discord_user_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "user_id" text NOT NULL,
  "discord_user_id" text NOT NULL,
  "is_primary" boolean DEFAULT true NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "linked_at" timestamp with time zone DEFAULT now() NOT NULL,
  "unlinked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "discord_user_links_company_discord_user_uq" ON "discord_user_links" ("company_id", "discord_user_id");
--> statement-breakpoint
CREATE INDEX "discord_user_links_company_user_idx" ON "discord_user_links" ("company_id", "user_id");
--> statement-breakpoint
CREATE TABLE "discord_link_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "user_id" text NOT NULL,
  "code_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "discord_link_codes_hash_uq" ON "discord_link_codes" ("code_hash");
--> statement-breakpoint
CREATE INDEX "discord_link_codes_user_idx" ON "discord_link_codes" ("company_id", "user_id");
--> statement-breakpoint
CREATE TABLE "discord_notification_preferences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "user_id" text NOT NULL,
  "event_type" text NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "delivery_mode" text DEFAULT 'dm' NOT NULL,
  "channel_id" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "discord_notification_preferences_user_event_uq" ON "discord_notification_preferences" ("company_id", "user_id", "event_type");
--> statement-breakpoint
CREATE TABLE "discord_inbound_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "discord_interaction_id" text NOT NULL,
  "discord_user_id" text NOT NULL,
  "guild_id" text,
  "channel_id" text NOT NULL,
  "command_name" text NOT NULL,
  "company_id" uuid,
  "issue_id" uuid REFERENCES "issues"("id") ON DELETE set null,
  "status" text DEFAULT 'processing' NOT NULL,
  "error_code" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "discord_inbound_requests_interaction_uq" ON "discord_inbound_requests" ("discord_interaction_id");
--> statement-breakpoint
CREATE TABLE "integration_event_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "idempotency_key" text NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "project_id" uuid REFERENCES "projects"("id") ON DELETE set null,
  "issue_id" uuid REFERENCES "issues"("id") ON DELETE set null,
  "event_type" text NOT NULL,
  "origin" text NOT NULL,
  "origin_discord_channel_id" text,
  "payload" jsonb NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "integration_event_outbox_idempotency_uq" ON "integration_event_outbox" ("idempotency_key");
--> statement-breakpoint
CREATE INDEX "integration_event_outbox_project_idx" ON "integration_event_outbox" ("company_id", "project_id", "created_at");
--> statement-breakpoint
CREATE TABLE "discord_delivery_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL REFERENCES "integration_event_outbox"("id") ON DELETE cascade,
  "recipient_type" text NOT NULL,
  "recipient_id" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "discord_message_id" text,
  "error_code" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "discord_delivery_attempts_event_recipient_uq" ON "discord_delivery_attempts" ("event_id", "recipient_type", "recipient_id");
--> statement-breakpoint
CREATE INDEX "discord_delivery_attempts_pending_idx" ON "discord_delivery_attempts" ("status", "next_attempt_at");