import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Link2, LoaderCircle, RefreshCw, Unlink } from "lucide-react";
import { discordApi, type DiscordNotificationPreference, type DiscordSettings } from "@/api/discord";
import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { queryKeys } from "@/lib/queryKeys";

const EVENT_LABELS: Record<DiscordNotificationPreference["eventType"], string> = {
  "issue.created": "Task created",
  "issue.status_changed": "Task status changed",
  "issue.assignee_changed": "Task assignee changed",
  "issue.priority_changed": "Task priority changed",
  "issue.comment_created": "Task comment added",
  "issue.mentioned": "Task mentioned",
  "issue.blocked": "Task blocked",
  "issue.unblocked": "Task unblocked",
  "issue.completed": "Task completed",
};

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    const code = (error.body as { code?: string } | null)?.code;
    if (error.status === 403) return "You do not have permission to manage Discord settings for this company.";
    if (code === "expired_link_code") return "This Discord link code expired. Create a new code and try again.";
    if (code === "invalid_link_code" || code === "link_code_used") return "This Discord link code is no longer valid. Create a new code.";
    if (code === "notification_channel_not_mapped") return "Choose a channel mapped to this Purpose Robot company.";
    if (error.status === 404) return "Discord integration is not configured for this company.";
  }
  return error instanceof Error ? error.message : fallback;
}

function formatChannel(channel: NonNullable<DiscordSettings["channels"]>[number]) {
  return `Channel ${channel.channelId}`;
}

export function DiscordSettingsPanel({ companyId }: { companyId: string | null }) {
  const queryClient = useQueryClient();
  const [draftPreferences, setDraftPreferences] = useState<DiscordNotificationPreference[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [linkCode, setLinkCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const settingsQuery = useQuery({
    queryKey: ["discord", "settings", companyId],
    queryFn: () => discordApi.getSettings(companyId!),
    enabled: !!companyId,
    retry: false,
  });

  useEffect(() => {
    if (settingsQuery.data) setDraftPreferences(settingsQuery.data.preferences);
  }, [settingsQuery.data]);

  const refreshSettings = async (settings?: DiscordSettings) => {
    if (settings) {
      queryClient.setQueryData(["discord", "settings", companyId], settings);
      return settings;
    }
    return queryClient.invalidateQueries({ queryKey: ["discord", "settings", companyId] });
  };

  const linkCodeMutation = useMutation({
    mutationFn: () => discordApi.createLinkCode(companyId!),
    onSuccess: (code) => {
      setLinkCode(code);
      setNotice("One-time code created. Enter it in Discord within 10 minutes.");
    },
  });
  const preferencesMutation = useMutation({
    mutationFn: () => discordApi.updatePreferences(companyId!, draftPreferences),
    onSuccess: async (settings) => {
      await refreshSettings(settings);
      setNotice("Discord notification preferences saved.");
    },
  });
  const disconnectMutation = useMutation({
    mutationFn: () => discordApi.disconnect(companyId!),
    onSuccess: async (settings) => {
      await refreshSettings(settings);
      setLinkCode(null);
      setNotice("Discord account disconnected. Personal notifications were turned off.");
    },
  });

  const settings = settingsQuery.data;
  const channels = settings?.channels ?? [];
  const linked = settings?.link.status === "linked";
  const invalidChannelSelection = useMemo(
    () => draftPreferences.some((preference) =>
      preference.enabled && preference.deliveryMode === "channel" && !preference.channelId,
    ),
    [draftPreferences],
  );
  const busy = linkCodeMutation.isPending || preferencesMutation.isPending || disconnectMutation.isPending;
  const mutationError = linkCodeMutation.error ?? preferencesMutation.error ?? disconnectMutation.error;

  function updatePreference(eventType: DiscordNotificationPreference["eventType"], update: Partial<DiscordNotificationPreference>) {
    setNotice(null);
    setDraftPreferences((current) => current.map((preference) =>
      preference.eventType === eventType ? { ...preference, ...update } : preference,
    ));
  }

  if (!companyId) return null;

  return (
    <Card className="space-y-5 p-6" data-testid="discord-settings-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Bell className="size-5 text-muted-foreground" aria-hidden="true" />
            <h2 className="text-lg font-semibold">Discord notifications</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Link your Discord identity, then choose personal task notifications.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void settingsQuery.refetch()}
          disabled={settingsQuery.isFetching}
        >
          <RefreshCw className={settingsQuery.isFetching ? "size-4 animate-spin" : "size-4"} />
          Refresh
        </Button>
      </div>

      {settingsQuery.isLoading ? <p role="status" className="text-sm text-muted-foreground">Loading Discord settings...</p> : null}
      {settingsQuery.error ? <p role="alert" className="text-sm text-destructive">{errorMessage(settingsQuery.error, "Could not load Discord settings.")}</p> : null}
      {mutationError ? <p role="alert" className="text-sm text-destructive">{errorMessage(mutationError, "Could not update Discord settings.")}</p> : null}
      {notice ? <p role="status" className="text-sm text-muted-foreground">{notice}</p> : null}

      {settings ? (
        <>
          <section className="space-y-3 border-t border-border pt-5" aria-labelledby="discord-identity-heading">
            <div className="space-y-1">
              <h3 id="discord-identity-heading" className="font-medium">Discord identity</h3>
              {linked ? (
                <p className="text-sm text-muted-foreground">Connected to Discord user {settings.link.discordUserId}.</p>
              ) : (
                <p className="text-sm text-muted-foreground">Not connected. Create a one-time code, then use `/paperclip link code:&lt;code&gt;` in Discord.</p>
              )}
            </div>

            {linked ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="outline" disabled={busy}>
                    <Unlink className="size-4" />
                    Disconnect Discord
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Disconnect Discord account?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This turns off your personal Discord notifications. You can link this account again later.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={disconnectMutation.isPending}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      disabled={disconnectMutation.isPending}
                      onClick={(event) => {
                        event.preventDefault();
                        disconnectMutation.mutate();
                      }}
                    >
                      {disconnectMutation.isPending ? <LoaderCircle className="size-4 animate-spin" /> : null}
                      Disconnect
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : (
              <div className="space-y-3">
                <Button type="button" onClick={() => linkCodeMutation.mutate()} disabled={busy}>
                  {linkCodeMutation.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <Link2 className="size-4" />}
                  Create link code
                </Button>
                {linkCode ? (
                  <div className="rounded-md border border-border bg-muted/40 p-3">
                    <p className="text-xs font-medium text-muted-foreground">ONE-TIME DISCORD LINK CODE</p>
                    <code className="mt-1 block break-all text-sm text-foreground">{linkCode.code}</code>
                    <p className="mt-1 text-xs text-muted-foreground">Expires {new Date(linkCode.expiresAt).toLocaleString()}.</p>
                  </div>
                ) : null}
              </div>
            )}
          </section>

          <form
            className="space-y-4 border-t border-border pt-5"
            onSubmit={(event) => {
              event.preventDefault();
              preferencesMutation.mutate();
            }}
          >
            <div className="space-y-1">
              <h3 className="font-medium">Personal notifications</h3>
              <p className="text-sm text-muted-foreground">Enable individual task and issue event notifications. Discord DMs remain off until enabled below.</p>
            </div>

            {!linked ? <p className="text-sm text-muted-foreground">Connect Discord before enabling personal notifications.</p> : null}
            {channels.length === 0 ? <p className="text-sm text-muted-foreground">No mapped Discord channels are available. Ask an administrator to configure channel mapping before choosing channel delivery.</p> : null}

            <fieldset className="space-y-3" disabled={!linked || busy}>
              <legend className="sr-only">Discord notification preferences</legend>
              {draftPreferences.map((preference) => (
                <div key={preference.eventType} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={preference.enabled}
                        onChange={(event) => updatePreference(preference.eventType, { enabled: event.target.checked })}
                      />
                      {EVENT_LABELS[preference.eventType]}
                    </label>
                    <label className="flex items-center gap-2 text-sm text-muted-foreground">
                      Delivery
                      <select
                        value={preference.deliveryMode}
                        onChange={(event) => updatePreference(preference.eventType, {
                          deliveryMode: event.target.value as DiscordNotificationPreference["deliveryMode"],
                          channelId: event.target.value === "dm" ? null : preference.channelId,
                        })}
                        className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
                        aria-label={`${EVENT_LABELS[preference.eventType]} delivery`}
                      >
                        <option value="dm">Discord DM</option>
                        <option value="channel" disabled={channels.length === 0}>Discord channel</option>
                      </select>
                    </label>
                  </div>
                  {preference.enabled && preference.deliveryMode === "channel" ? (
                    <label className="mt-3 block text-sm">
                      <span className="font-medium">Channel</span>
                      <select
                        value={preference.channelId ?? ""}
                        onChange={(event) => updatePreference(preference.eventType, { channelId: event.target.value || null })}
                        className="mt-1 block w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground"
                        aria-label={`${EVENT_LABELS[preference.eventType]} channel`}
                      >
                        <option value="">Select a mapped channel</option>
                        {channels.map((channel) => <option key={`${channel.guildId}:${channel.channelId}`} value={channel.channelId}>{formatChannel(channel)}</option>)}
                      </select>
                    </label>
                  ) : null}
                </div>
              ))}
            </fieldset>
            {invalidChannelSelection ? <p role="alert" className="text-sm text-destructive">Select a mapped channel for each enabled channel notification.</p> : null}
            <Button type="submit" disabled={!linked || busy || invalidChannelSelection}>
              {preferencesMutation.isPending ? <LoaderCircle className="size-4 animate-spin" /> : null}
              Save notification preferences
            </Button>
          </form>
        </>
      ) : null}
    </Card>
  );
}
