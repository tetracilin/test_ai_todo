export const DISCORD_NOTIFICATION_EVENTS = [
  'issue.created',
  'issue.status_changed',
  'issue.assignee_changed',
  'issue.priority_changed',
  'issue.comment_created',
  'issue.blocked',
  'issue.unblocked',
  'issue.completed',
] as const;

export type DiscordNotificationEvent = (typeof DISCORD_NOTIFICATION_EVENTS)[number];
export type DiscordDeliveryMode = 'dm' | 'channel';

export interface DiscordChannel {
  id: string;
  name: string;
  guildName?: string;
}

export interface DiscordLink {
  status: 'linked' | 'unlinked';
  discordUsername?: string;
  warning?: string;
}

export interface DiscordNotificationPreference {
  eventType: DiscordNotificationEvent;
  enabled: boolean;
  deliveryMode: DiscordDeliveryMode;
  channelId: string | null;
}

export interface DiscordSettings {
  link: DiscordLink;
  preferences: DiscordNotificationPreference[];
  channels: DiscordChannel[];
}

export interface DiscordLinkCode {
  code: string;
  expiresAt: string;
}

export class DiscordSettingsApiError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'DiscordSettingsApiError';
  }
}

async function request<T>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });
  } catch {
    throw new DiscordSettingsApiError('Could not reach Discord settings. Try again.');
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Error status still maps to a safe message below.
  }

  if (!response.ok) {
    throw new DiscordSettingsApiError('Discord settings request failed.', response.status);
  }

  return body as T;
}

export function getDiscordSettings(token: string): Promise<DiscordSettings> {
  return request<DiscordSettings>('/api/integrations/discord/settings', token);
}

export function issueDiscordLinkCode(token: string): Promise<DiscordLinkCode> {
  return request<DiscordLinkCode>('/api/integrations/discord/link-codes', token, { method: 'POST' });
}

export function saveDiscordNotificationPreferences(
  token: string,
  preferences: DiscordNotificationPreference[],
): Promise<DiscordSettings> {
  return request<DiscordSettings>('/api/integrations/discord/notification-preferences', token, {
    method: 'PUT',
    body: JSON.stringify({ preferences }),
  });
}
