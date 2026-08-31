import { api } from "./client";

export const DISCORD_NOTIFICATION_EVENTS = [
  "issue.created",
  "issue.status_changed",
  "issue.assignee_changed",
  "issue.priority_changed",
  "issue.comment_created",
  "issue.blocked",
  "issue.unblocked",
  "issue.completed",
] as const;

export type DiscordNotificationEvent = (typeof DISCORD_NOTIFICATION_EVENTS)[number];
export type DiscordDeliveryMode = "dm" | "channel";

export interface DiscordNotificationPreference {
  eventType: DiscordNotificationEvent;
  enabled: boolean;
  deliveryMode: DiscordDeliveryMode;
  channelId: string | null;
}

export interface DiscordSettings {
  link: {
    status: "linked" | "unlinked";
    discordUserId: string | null;
  };
  preferences: DiscordNotificationPreference[];
}

export interface DiscordLinkCode {
  code: string;
  expiresAt: string;
}

export const discordIntegrationsApi = {
  getSettings: (companyId: string) =>
    api.get<DiscordSettings>(`/integrations/discord/settings?companyId=${encodeURIComponent(companyId)}`),

  createLinkCode: (companyId: string) =>
    api.post<DiscordLinkCode>("/integrations/discord/link-codes", { companyId }),

  disconnect: (companyId: string) =>
    api.post<DiscordSettings>("/integrations/discord/disconnect", { companyId }),

  updatePreferences: (companyId: string, preferences: DiscordNotificationPreference[]) =>
    api.patch<DiscordSettings>("/integrations/discord/preferences", { companyId, preferences }),
};
