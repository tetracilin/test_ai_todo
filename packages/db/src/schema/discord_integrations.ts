import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";
import { projects } from "./projects.js";

export const discordGuildIntegrations = pgTable(
  "discord_guild_integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    guildId: text("guild_id").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyGuildUq: uniqueIndex("discord_guild_integrations_company_guild_uq").on(table.companyId, table.guildId),
  }),
);

export const discordProjectChannelMappings = pgTable(
  "discord_project_channel_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    guildId: text("guild_id").notNull(),
    channelId: text("channel_id").notNull(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(true),
    allowTaskCreate: boolean("allow_task_create").notNull().default(false),
    notificationEvents: jsonb("notification_events").$type<string[]>().notNull().default([]),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    activeChannelUq: uniqueIndex("discord_project_channel_mappings_guild_channel_uq").on(table.guildId, table.channelId),
    projectIdx: index("discord_project_channel_mappings_project_idx").on(table.companyId, table.projectId),
  }),
);

export const discordUserLinks = pgTable(
  "discord_user_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    discordUserId: text("discord_user_id").notNull(),
    primary: boolean("is_primary").notNull().default(true),
    active: boolean("active").notNull().default(true),
    linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
    unlinkedAt: timestamp("unlinked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyDiscordUserUq: uniqueIndex("discord_user_links_company_discord_user_uq").on(table.companyId, table.discordUserId),
    userIdx: index("discord_user_links_company_user_idx").on(table.companyId, table.userId),
  }),
);

export const discordLinkCodes = pgTable(
  "discord_link_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    codeHashUq: uniqueIndex("discord_link_codes_hash_uq").on(table.codeHash),
    userIdx: index("discord_link_codes_user_idx").on(table.companyId, table.userId),
  }),
);

export const discordNotificationPreferences = pgTable(
  "discord_notification_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    eventType: text("event_type").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    deliveryMode: text("delivery_mode").notNull().default("dm"),
    channelId: text("channel_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userEventUq: uniqueIndex("discord_notification_preferences_user_event_uq").on(table.companyId, table.userId, table.eventType),
  }),
);

export const discordInboundRequests = pgTable(
  "discord_inbound_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    discordInteractionId: text("discord_interaction_id").notNull(),
    discordUserId: text("discord_user_id").notNull(),
    guildId: text("guild_id"),
    channelId: text("channel_id").notNull(),
    commandName: text("command_name").notNull(),
    companyId: uuid("company_id"),
    issueId: uuid("issue_id").references(() => issues.id, { onDelete: "set null" }),
    status: text("status").notNull().default("processing"),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    interactionUq: uniqueIndex("discord_inbound_requests_interaction_uq").on(table.discordInteractionId),
  }),
);

export const integrationEventOutbox = pgTable(
  "integration_event_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    idempotencyKey: text("idempotency_key").notNull(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    issueId: uuid("issue_id").references(() => issues.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    origin: text("origin").notNull(),
    originDiscordChannelId: text("origin_discord_channel_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    idempotencyUq: uniqueIndex("integration_event_outbox_idempotency_uq").on(table.idempotencyKey),
    projectIdx: index("integration_event_outbox_project_idx").on(table.companyId, table.projectId, table.createdAt),
  }),
);

export const discordDeliveryAttempts = pgTable(
  "discord_delivery_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id").notNull().references(() => integrationEventOutbox.id, { onDelete: "cascade" }),
    recipientType: text("recipient_type").notNull(),
    recipientId: text("recipient_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    discordMessageId: text("discord_message_id"),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    eventRecipientUq: uniqueIndex("discord_delivery_attempts_event_recipient_uq").on(table.eventId, table.recipientType, table.recipientId),
    pendingIdx: index("discord_delivery_attempts_pending_idx").on(table.status, table.nextAttemptAt),
  }),
);
