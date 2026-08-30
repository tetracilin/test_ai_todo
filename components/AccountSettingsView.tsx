import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
    DISCORD_NOTIFICATION_EVENTS,
    DiscordChannel,
    DiscordNotificationPreference,
    DiscordSettings,
    getDiscordSettings,
    issueDiscordLinkCode,
    saveDiscordNotificationPreferences,
} from '../services/discordSettings';

const eventLabels: Record<(typeof DISCORD_NOTIFICATION_EVENTS)[number], string> = {
    'issue.created': 'Issue created',
    'issue.status_changed': 'Issue status changed',
    'issue.assignee_changed': 'Issue assignee changed',
    'issue.priority_changed': 'Issue priority changed',
    'issue.comment_created': 'Issue comment created',
    'issue.blocked': 'Issue blocked',
    'issue.unblocked': 'Issue unblocked',
    'issue.completed': 'Issue completed',
};

const defaultPreferences = (): DiscordNotificationPreference[] =>
    DISCORD_NOTIFICATION_EVENTS.map(eventType => ({
        eventType,
        enabled: false,
        deliveryMode: 'dm',
        channelId: null,
    }));

const normalizePreferences = (preferences: DiscordNotificationPreference[]) => {
    const byEvent = new Map(preferences.map(preference => [preference.eventType, preference]));
    return defaultPreferences().map(preference => byEvent.get(preference.eventType) ?? preference);
};

const formatChannel = (channel: DiscordChannel) => channel.guildName ? `#${channel.name} — ${channel.guildName}` : `#${channel.name}`;

export const AccountSettingsView: React.FC = () => {
    const { currentUser, showMainApp, changePassword, firebaseUser } = useAuth();
    const [newPassword, setNewPassword] = useState('');
    const [confirmNewPassword, setConfirmNewPassword] = useState('');
    const [passwordChangeFeedback, setPasswordChangeFeedback] = useState<{ type: 'success' | 'error', message: string } | null>(null);
    const [isPasswordLoading, setIsPasswordLoading] = useState(false);
    const [discordSettings, setDiscordSettings] = useState<DiscordSettings | null>(null);
    const [preferences, setPreferences] = useState<DiscordNotificationPreference[]>(defaultPreferences);
    const [discordFeedback, setDiscordFeedback] = useState<{ type: 'success' | 'error', message: string } | null>(null);
    const [linkCode, setLinkCode] = useState<{ code: string; expiresAt: string } | null>(null);
    const [isDiscordLoading, setIsDiscordLoading] = useState(true);
    const [isLinkCodeLoading, setIsLinkCodeLoading] = useState(false);
    const [isPreferenceSaving, setIsPreferenceSaving] = useState(false);

    const getToken = useCallback(async () => {
        if (!firebaseUser) throw new Error('Sign in again to manage Discord settings.');
        return firebaseUser.getIdToken();
    }, [firebaseUser]);

    const loadDiscordSettings = useCallback(async () => {
        setIsDiscordLoading(true);
        setDiscordFeedback(null);
        try {
            const settings = await getDiscordSettings(await getToken());
            setDiscordSettings(settings);
            setPreferences(normalizePreferences(settings.preferences));
        } catch (err) {
            setDiscordSettings(null);
            setDiscordFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Could not load Discord settings.' });
        } finally {
            setIsDiscordLoading(false);
        }
    }, [getToken]);

    useEffect(() => {
        if (!currentUser || !firebaseUser) {
            setIsDiscordLoading(false);
            return;
        }
        void loadDiscordSettings();
    }, [currentUser, firebaseUser, loadDiscordSettings]);

    const updatePreference = (eventType: DiscordNotificationPreference['eventType'], update: Partial<DiscordNotificationPreference>) => {
        setPreferences(current => current.map(preference => preference.eventType === eventType ? { ...preference, ...update } : preference));
    };

    const hasInvalidChannelDelivery = useMemo(() => preferences.some(preference =>
        preference.enabled && preference.deliveryMode === 'channel' && !preference.channelId,
    ), [preferences]);

    const handleLinkCode = async () => {
        setDiscordFeedback(null);
        setIsLinkCodeLoading(true);
        try {
            setLinkCode(await issueDiscordLinkCode(await getToken()));
        } catch (err) {
            setDiscordFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Could not create link code.' });
        } finally {
            setIsLinkCodeLoading(false);
        }
    };

    const handlePreferencesSave = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!discordSettings || hasInvalidChannelDelivery) return;
        setDiscordFeedback(null);
        setIsPreferenceSaving(true);
        try {
            const settings = await saveDiscordNotificationPreferences(await getToken(), preferences);
            setDiscordSettings(settings);
            setPreferences(normalizePreferences(settings.preferences));
            setDiscordFeedback({ type: 'success', message: 'Notification preferences saved.' });
        } catch (err) {
            setDiscordFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Could not save notification preferences.' });
        } finally {
            setIsPreferenceSaving(false);
        }
    };

    const handlePasswordChange = async (event: React.FormEvent) => {
        event.preventDefault();
        setPasswordChangeFeedback(null);
        if (newPassword !== confirmNewPassword) {
            setPasswordChangeFeedback({ type: 'error', message: 'New passwords do not match.' });
            return;
        }
        if (!currentUser) return;

        setIsPasswordLoading(true);
        try {
            await changePassword(newPassword);
            setPasswordChangeFeedback({ type: 'success', message: 'Password updated successfully!' });
            setNewPassword('');
            setConfirmNewPassword('');
        } catch (err) {
            setPasswordChangeFeedback({ type: 'error', message: err instanceof Error ? err.message : 'An unknown error occurred.' });
        } finally {
            setIsPasswordLoading(false);
        }
    };

    if (!currentUser) {
        return (
            <div className="h-screen w-screen flex flex-col items-center justify-center bg-background dark:bg-background-dark p-4">
                <p className="text-text-secondary dark:text-text-secondary-dark mb-4">You must be logged in to view account settings.</p>
                <button onClick={showMainApp} className="px-4 py-2 text-sm font-medium rounded-md text-white bg-primary hover:bg-primary/90">Go to Login</button>
            </div>
        );
    }

    return (
        <div className="h-screen w-screen flex flex-col bg-background dark:bg-background-dark">
            <header className="p-4 border-b border-border-light dark:border-border-dark flex justify-between items-center flex-shrink-0">
                <h1 className="text-xl font-bold">Account Settings for {currentUser.name}</h1>
                <button onClick={showMainApp} className="px-4 py-2 text-sm font-medium rounded-md text-text-primary dark:text-text-primary-dark hover:bg-gray-200 dark:hover:bg-gray-700">Back to App</button>
            </header>
            <main className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8 max-w-4xl mx-auto w-full">
                <section className="bg-surface dark:bg-surface-dark p-6 rounded-lg border border-border-light dark:border-border-dark">
                    <h2 className="text-lg font-semibold mb-4">Change Password</h2>
                    <form onSubmit={handlePasswordChange} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium">New Password</label>
                            <input type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} required className="mt-1 block w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium">Confirm New Password</label>
                            <input type="password" value={confirmNewPassword} onChange={event => setConfirmNewPassword(event.target.value)} required className="mt-1 block w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary" />
                        </div>
                        {passwordChangeFeedback && <p className={`text-sm ${passwordChangeFeedback.type === 'error' ? 'text-red-500' : 'text-green-500'}`}>{passwordChangeFeedback.message}</p>}
                        <div className="text-right">
                            <button type="submit" disabled={isPasswordLoading} className="px-4 py-2 text-sm font-medium rounded-md text-white bg-primary hover:bg-primary/90 disabled:opacity-50">
                                {isPasswordLoading ? 'Saving...' : 'Save Password'}
                            </button>
                        </div>
                    </form>
                </section>

                <section className="bg-surface dark:bg-surface-dark p-6 rounded-lg border border-border-light dark:border-border-dark" aria-labelledby="discord-settings-heading">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <h2 id="discord-settings-heading" className="text-lg font-semibold">Discord notifications</h2>
                            <p className="mt-1 text-sm text-text-secondary dark:text-text-secondary-dark">Choose personal Paperclip alerts. All alerts are off until enabled.</p>
                        </div>
                        <button type="button" onClick={() => void loadDiscordSettings()} disabled={isDiscordLoading} className="px-3 py-2 text-sm font-medium rounded-md border border-border-light dark:border-border-dark disabled:opacity-50">Refresh</button>
                    </div>

                    {discordFeedback && <p role="alert" className={`mt-4 text-sm ${discordFeedback.type === 'error' ? 'text-red-500' : 'text-green-500'}`}>{discordFeedback.message}</p>}

                    {isDiscordLoading ? <p className="mt-4 text-sm text-text-secondary dark:text-text-secondary-dark" role="status">Loading Discord settings...</p> : discordSettings ? <>
                        <div className="mt-5 rounded-md border border-border-light dark:border-border-dark p-4">
                            {discordSettings.link.status === 'linked' ? <>
                                <p className="font-medium">Connected as {discordSettings.link.discordUsername ?? 'Discord account'}</p>
                                <p className="mt-1 text-sm text-text-secondary dark:text-text-secondary-dark">Run <code>/paperclip unlink</code> in Discord to disconnect.</p>
                            </> : <>
                                <p className="font-medium">Discord is not connected.</p>
                                <p className="mt-1 text-sm text-text-secondary dark:text-text-secondary-dark">Create a one-time code, then run <code>/paperclip link code:&lt;code&gt;</code> in Discord. Codes expire after 10 minutes.</p>
                                <button type="button" onClick={() => void handleLinkCode()} disabled={isLinkCodeLoading} className="mt-3 px-4 py-2 text-sm font-medium rounded-md text-white bg-primary hover:bg-primary/90 disabled:opacity-50">
                                    {isLinkCodeLoading ? 'Creating code...' : 'Get link code'}
                                </button>
                                {linkCode && <p className="mt-3 text-sm">One-time code: <code className="font-semibold">{linkCode.code}</code> <span className="text-text-secondary dark:text-text-secondary-dark">expires {new Date(linkCode.expiresAt).toLocaleString()}</span></p>}
                            </>}
                            {discordSettings.link.warning && <p role="alert" className="mt-3 text-sm text-amber-600 dark:text-amber-400">{discordSettings.link.warning}</p>}
                        </div>

                        <form onSubmit={handlePreferencesSave} className="mt-6">
                            <fieldset disabled={discordSettings.link.status !== 'linked' || isPreferenceSaving}>
                                <legend className="font-medium">Personal notification events</legend>
                                {discordSettings.link.status !== 'linked' && <p className="mt-1 text-sm text-text-secondary dark:text-text-secondary-dark">Connect Discord before enabling personal alerts.</p>}
                                <div className="mt-3 space-y-3">
                                    {preferences.map(preference => <div key={preference.eventType} className="rounded-md border border-border-light dark:border-border-dark p-3">
                                        <div className="flex flex-wrap items-center gap-3">
                                            <label className="flex items-center gap-2 text-sm font-medium">
                                                <input type="checkbox" checked={preference.enabled} onChange={event => updatePreference(preference.eventType, { enabled: event.target.checked })} />
                                                {eventLabels[preference.eventType]}
                                            </label>
                                            <label className="ml-auto flex items-center gap-2 text-sm">
                                                Delivery
                                                <select aria-label={`${eventLabels[preference.eventType]} delivery`} value={preference.deliveryMode} onChange={event => updatePreference(preference.eventType, { deliveryMode: event.target.value as DiscordNotificationPreference['deliveryMode'], channelId: event.target.value === 'dm' ? null : preference.channelId })} className="p-1 bg-gray-100 dark:bg-gray-800 rounded-md">
                                                    <option value="dm">Discord DM</option>
                                                    <option value="channel">Discord channel</option>
                                                </select>
                                            </label>
                                        </div>
                                        {preference.enabled && preference.deliveryMode === 'channel' && <label className="mt-3 block text-sm">Channel
                                            <select aria-label={`${eventLabels[preference.eventType]} channel`} value={preference.channelId ?? ''} onChange={event => updatePreference(preference.eventType, { channelId: event.target.value || null })} className="mt-1 block w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md">
                                                <option value="">Select a channel</option>
                                                {discordSettings.channels.map(channel => <option key={channel.id} value={channel.id}>{formatChannel(channel)}</option>)}
                                            </select>
                                        </label>}
                                    </div>)}
                                </div>
                            </fieldset>
                            {hasInvalidChannelDelivery && <p className="mt-3 text-sm text-red-500">Select a channel for every enabled channel delivery.</p>}
                            <div className="mt-4 text-right">
                                <button type="submit" disabled={discordSettings.link.status !== 'linked' || isPreferenceSaving || hasInvalidChannelDelivery} className="px-4 py-2 text-sm font-medium rounded-md text-white bg-primary hover:bg-primary/90 disabled:opacity-50">
                                    {isPreferenceSaving ? 'Saving...' : 'Save notification preferences'}
                                </button>
                            </div>
                        </form>
                    </> : null}
                </section>
            </main>
        </div>
    );
};