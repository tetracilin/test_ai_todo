import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Link2, LoaderCircle, MessageCircle, RefreshCw, Save } from "lucide-react";
import {
  DISCORD_NOTIFICATION_EVENTS,
  discordIntegrationsApi,
  type DiscordNotificationEvent,
  type DiscordNotificationPreference,
} from "@/api/discord-integrations";
import { ApiError } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { queryKeys } from "@/lib/queryKeys";

const EVENT_LABELS: Record<DiscordNotificationEvent, string> = {
  "issue.created": "Task created",
  "issue.status_changed": "Task status changed",
  "issue.assignee_changed": "Task assignee changed",
  "issue.priority_changed": "Task priority changed",
  "issue.comment_created": "Task comment added",
  "issue.blocked": "Task blocked",
  "issue.unblocked": "Task unblocked",
  "issue.completed": "Task completed",
};

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    const body = error.body as { code?: string; error?: string } | null;
    if (body?.code === "notification_channel_not_mapped") {
      return "That Discord channel is not enabled for this company. Choose a mapped channel or use direct messages.";
    }
  }
  return error instanceof Error ? error.message : fallback;
}

function formatExpiry(expiresAt: string) {
  const parsed = new Date(expiresAt);
  return Number.isNaN(parsed.getTime()) ? expiresAt : parsed.toLocaleString();
}

export function DiscordIntegrationSettings({ companyId }: { companyId: string | null | undefined }) {
  const queryClient = useQueryClient();
  const [preferences, setPreferences] = useState<DiscordNotificationPreference[] | null>(null);
  const [linkCode, setLinkCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const settingsQuery = useQuery({
    queryKey: companyId ? queryKeys.discordIntegration.settings(companyId) : ["discord-integration", "none"],
    queryFn: () => discordIntegrationsApi.getSettings(companyId!),
    enabled: Boolean(companyId),
  });
  const settings = settingsQuery.data;
  const draft = preferences ?? settings?.preferences ?? [];
  const isDirty = Boolean(preferences && settings && JSON.stringify(preferences) !== JSON.stringify(settings.preferences));
  const isLinked = settings?.link.status === "linked";

  const savePreferences = useMutation({
    mutationFn: () => discordIntegrationsApi.updatePreferences(companyId!, draft),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.discordIntegration.settings(companyId!), saved);
      setPreferences(saved.preferences);
    },
  });
  const createLinkCode = useMutation({
    mutationFn: () => discordIntegrationsApi.createLinkCode(companyId!),
    onSuccess: (code) => {
      setLinkCode(code);
      setCopied(false);
    },
  });
  const disconnect = useMutation({
    mutationFn: () => discordIntegrationsApi.disconnect(companyId!),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.discordIntegration.settings(companyId!), saved);
      setPreferences(saved.preferences);
      setLinkCode(null);
    },
  });

  const enabledCount = useMemo(() => draft.filter((preference) => preference.enabled).length, [draft]);

  function updatePreference(eventType: DiscordNotificationEvent, update: Partial<DiscordNotificationPreference>) {
    setPreferences((current) => (current ?? settings?.preferences ?? []).map((preference) =>
      preference.eventType === eventType ? { ...preference, ...update } : preference,
    ));
  }

  async function copyCode() {
    if (!linkCode) return;
    try {
      await navigator.clipboard.writeText(linkCode.code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (!companyId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Discord</CardTitle>
          <CardDescription>Select a company to manage Discord notifications.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (settingsQuery.isLoading) {
    return <div className="text-sm text-muted-foreground">Loading Discord settings...</div>;
  }

  if (settingsQuery.error || !settings) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
        {errorMessage(settingsQuery.error, "Failed to load Discord settings.")}
      </div>
    );
  }

  return (
    <section className="space-y-4" aria-labelledby="discord-settings-heading">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <MessageCircle className="size-5 text-muted-foreground" />
          <h2 id="discord-settings-heading" className="text-base font-semibold">Discord</h2>
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Connect your account to receive personal task alerts. All notification events start off.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>Connection</CardTitle>
              <CardDescription>Link this Paperclip account to a Discord account.</CardDescription>
            </div>
            <Badge variant={isLinked ? "default" : "outline"}>{isLinked ? "Connected" : "Not connected"}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLinked ? (
            <>
              <p className="text-sm text-muted-foreground">Your Discord account is connected.</p>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="outline" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>
                  {disconnect.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <Link2 className="size-4" />}
                  {disconnect.isPending ? "Disconnecting..." : "Disconnect Discord"}
                </Button>
                <span className="text-xs text-muted-foreground">Disconnecting also disables personal Discord notifications.</span>
              </div>
              {disconnect.error ? (
                <p className="text-sm text-destructive" role="alert">{errorMessage(disconnect.error, "Failed to disconnect Discord.")}</p>
              ) : null}
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Generate a one-time code, then run <code>/paperclip link code:&lt;code&gt;</code> in Discord. Codes expire in 10 minutes.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" onClick={() => createLinkCode.mutate()} disabled={createLinkCode.isPending}>
                  {createLinkCode.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <Link2 className="size-4" />}
                  {createLinkCode.isPending ? "Creating code..." : "Generate link code"}
                </Button>
                {linkCode ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                    <code className="font-medium">{linkCode.code}</code>
                    <Button type="button" size="xs" variant="ghost" onClick={() => void copyCode()}>
                      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                      {copied ? "Copied" : "Copy"}
                    </Button>
                    <span className="text-xs text-muted-foreground">Expires {formatExpiry(linkCode.expiresAt)}</span>
                  </div>
                ) : null}
              </div>
              {createLinkCode.error ? (
                <p className="text-sm text-destructive" role="alert">{errorMessage(createLinkCode.error, "Failed to create a link code.")}</p>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Personal notifications</CardTitle>
          <CardDescription>
            {isLinked
              ? `${enabledCount} ${enabledCount === 1 ? "event" : "events"} enabled. Deliver alerts by direct message or a mapped channel.`
              : "Connect Discord before enabling personal notifications."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <fieldset disabled={!isLinked || savePreferences.isPending} className="space-y-3">
            <legend className="sr-only">Discord notification preferences</legend>
            {draft.map((preference) => (
              <div key={preference.eventType} className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3">
                <div className="min-w-48 flex-1">
                  <div className="text-sm font-medium">{EVENT_LABELS[preference.eventType]}</div>
                  <div className="text-xs text-muted-foreground">Personal alert</div>
                </div>
                <Select
                  value={preference.deliveryMode}
                  onValueChange={(deliveryMode) => updatePreference(preference.eventType, {
                    deliveryMode: deliveryMode as DiscordNotificationPreference["deliveryMode"],
                    channelId: deliveryMode === "dm" ? null : preference.channelId,
                  })}
                >
                  <SelectTrigger aria-label={`${EVENT_LABELS[preference.eventType]} delivery`} className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dm">Discord direct message</SelectItem>
                    <SelectItem value="channel">Mapped Discord channel</SelectItem>
                  </SelectContent>
                </Select>
                <ToggleSwitch
                  aria-label={`Enable ${EVENT_LABELS[preference.eventType]} notification`}
                  checked={preference.enabled}
                  onCheckedChange={(enabled) => updatePreference(preference.eventType, { enabled })}
                />
              </div>
            ))}
          </fieldset>
          {savePreferences.error ? (
            <p className="text-sm text-destructive" role="alert">{errorMessage(savePreferences.error, "Failed to save notification preferences.")}</p>
          ) : null}
          <div className="flex items-center justify-end gap-3">
            {savePreferences.isSuccess && !isDirty ? <span className="text-xs text-muted-foreground" role="status">Saved</span> : null}
            <Button type="button" variant="outline" onClick={() => settingsQuery.refetch()} disabled={settingsQuery.isFetching}>
              <RefreshCw className="size-4" />
              Refresh status
            </Button>
            <Button type="button" onClick={() => savePreferences.mutate()} disabled={!isLinked || !isDirty || savePreferences.isPending}>
              {savePreferences.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
              {savePreferences.isPending ? "Saving..." : "Save notifications"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
