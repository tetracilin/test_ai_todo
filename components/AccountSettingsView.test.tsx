import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccountSettingsView } from './AccountSettingsView';

const mocks = vi.hoisted(() => ({
  auth: {
    currentUser: { id: 'user-1', name: 'Taylor', email: 'taylor@example.test', mobile: '' },
    showMainApp: vi.fn(),
    changePassword: vi.fn(),
    firebaseUser: { getIdToken: vi.fn().mockResolvedValue('firebase-token') },
  },
  getDiscordSettings: vi.fn(),
  issueDiscordLinkCode: vi.fn(),
  saveDiscordNotificationPreferences: vi.fn(),
}));

vi.mock('../context/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('../services/discordSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/discordSettings')>();
  return {
    ...actual,
    getDiscordSettings: mocks.getDiscordSettings,
    issueDiscordLinkCode: mocks.issueDiscordLinkCode,
    saveDiscordNotificationPreferences: mocks.saveDiscordNotificationPreferences,
  };
});

const disconnectedSettings = {
  link: { status: 'unlinked' as const },
  channels: [],
  preferences: [],
};

const linkedSettings = {
  link: { status: 'linked' as const, discordUsername: 'taylor_discord', warning: 'Discord cannot send DMs to this account.' },
  channels: [{ id: 'channel-1', name: 'alerts', guildName: 'Engineering' }],
  preferences: [{ eventType: 'issue.created' as const, enabled: false, deliveryMode: 'dm' as const, channelId: null }],
};

describe('AccountSettingsView Discord settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDiscordSettings.mockResolvedValue(disconnectedSettings);
  });

  it('shows disconnected state, issues a one-time code, and keeps preferences unavailable', async () => {
    mocks.issueDiscordLinkCode.mockResolvedValue({ code: 'ALPHA-123', expiresAt: '2026-08-30T10:10:00.000Z' });
    render(<AccountSettingsView />);

    expect(await screen.findByText('Discord is not connected.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save notification preferences' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Get link code' }));

    expect(await screen.findByText('ALPHA-123')).toBeVisible();
    expect(mocks.issueDiscordLinkCode).toHaveBeenCalledWith('firebase-token');
  });

  it('saves disabled preferences and surfaces delivery permission warnings', async () => {
    mocks.getDiscordSettings.mockResolvedValue(linkedSettings);
    mocks.saveDiscordNotificationPreferences.mockResolvedValue(linkedSettings);
    render(<AccountSettingsView />);

    expect(await screen.findByText('Connected as taylor_discord')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('Discord cannot send DMs to this account.');

    await userEvent.click(screen.getByRole('button', { name: 'Save notification preferences' }));

    await waitFor(() => {
      expect(mocks.saveDiscordNotificationPreferences).toHaveBeenCalledOnce();
    });
    const [token, savedPreferences] = mocks.saveDiscordNotificationPreferences.mock.calls[0];
    expect(token).toBe('firebase-token');
    expect(savedPreferences).toHaveLength(8);
    expect(savedPreferences).toContainEqual({ eventType: 'issue.created', enabled: false, deliveryMode: 'dm', channelId: null });
    expect(savedPreferences.every(preference => !preference.enabled)).toBe(true);
    expect(await screen.findByText('Notification preferences saved.')).toBeVisible();
  });

  it('requires a channel before saving enabled channel delivery', async () => {
    mocks.getDiscordSettings.mockResolvedValue({
      ...linkedSettings,
      preferences: [{ eventType: 'issue.created', enabled: true, deliveryMode: 'channel', channelId: null }],
    });
    render(<AccountSettingsView />);

    expect(await screen.findByText('Select a channel for every enabled channel delivery.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save notification preferences' })).toBeDisabled();
  });
});
