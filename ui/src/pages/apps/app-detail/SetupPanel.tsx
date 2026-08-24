import { useState } from "react";
import type { ToolCatalogEntry, ToolConnection } from "@paperclipai/shared";
import { Button } from "@/components/ui/button";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { appDefinitionSlug } from "../app-definition-display";
import type { AppDetailSectionProps } from "./types";


export function SetupPanel({
  connection,
  galleryEntry,
  onToggleApp,
  appToggleDisabled,
  onUpdateConfig,
  configUpdateDisabled,
  onStartOAuth,
  oauthStartDisabled,
}: Pick<
  AppDetailSectionProps,
  "connection" | "galleryEntry"
> & {
  onToggleApp: () => void;
  appToggleDisabled: boolean;
  onUpdateConfig: (config: Record<string, unknown>) => void;
  configUpdateDisabled: boolean;
  onStartOAuth: () => void;
  oauthStartDisabled: boolean;
}) {
  const description = galleryEntry?.description ?? null;
  const oauth = connection.config?.oauth;
  const hasOAuthSignIn = Boolean(oauth && typeof oauth === "object" && !Array.isArray(oauth));
  const isSmokeLabFixture = connection.config?.smokeLabFixture === "oauth-http";
  return (
    <div className="space-y-6">
      {description && (
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
      )}

      {hasOAuthSignIn && (
        <OAuthConnectionSection
          connected={Boolean((oauth as Record<string, unknown>).connectedAt)}
          providerName={appDefinitionSlug(galleryEntry) === "notion" ? "Notion" : isSmokeLabFixture ? "Smoke OAuth" : "OAuth"}
          disabled={oauthStartDisabled}
          onStart={onStartOAuth}
        />
      )}
      <AppLifecycleSection connection={connection} disabled={appToggleDisabled} onToggle={onToggleApp} />
    </div>
  );
}

function OAuthConnectionSection({
  connected,
  providerName,
  disabled,
  onStart,
}: {
  connected: boolean;
  providerName: string;
  disabled: boolean;
  onStart: () => void;
}) {
  return (
    <section className="rounded-xl border border-border bg-card px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-bold text-foreground">
            {connected ? `${providerName} connected` : `Connect with ${providerName}`}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {connected
              ? "Your workspace authorization is active. Reconnect any time to replace it."
              : "Open the provider's consent page to finish connecting this app."}
          </p>
        </div>
        <Button type="button" disabled={disabled} onClick={onStart}>
          {connected ? "Reconnect" : `Connect with ${providerName}`}
        </Button>
      </div>
    </section>
  );
}

export function AppLifecycleSection({
  connection,
  disabled,
  onToggle,
}: {
  connection: ToolConnection;
  disabled: boolean;
  onToggle: () => void;
}) {
  const enabled = connection.enabled !== false && connection.status !== "disabled";
  return (
    <section className="rounded-xl border border-border bg-card px-5 py-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-bold text-foreground">
            {enabled ? "Agents can use this app" : "This app is paused"}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {enabled
              ? "Pause it to stop every agent from using its actions."
              : "Resume it when agents should be able to use its actions again."}
          </p>
        </div>
        <ToggleSwitch
          aria-label={enabled ? "Pause this app" : "Resume this app"}
          checked={enabled}
          disabled={disabled}
          onCheckedChange={onToggle}
          size="lg"
        />
      </div>
    </section>
  );
}

export function QuarantinedActionsReview({
  entries,
  disabled,
  onSubmit,
}: {
  entries: ToolCatalogEntry[];
  disabled: boolean;
  onSubmit: (enabledIds: string[]) => void;
}) {
  const [enabledIds, setEnabledIds] = useState<Set<string>>(new Set());
  const count = entries.length;
  const selectedIds = entries.filter((entry) => enabledIds.has(entry.id)).map((entry) => entry.id);
  return (
    <section className="overflow-hidden rounded-xl border border-amber-500/40 bg-amber-500/[0.08]">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-amber-800 dark:text-amber-200">
            Review {count} new {count === 1 ? "action" : "actions"}
          </div>
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
            Turn on the actions agents may use. Anything left off stays blocked when you save.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="text-xs font-medium text-amber-800 hover:text-amber-950 dark:text-amber-200 dark:hover:text-amber-50"
            disabled={disabled}
            onClick={() => setEnabledIds(new Set(entries.map((entry) => entry.id)))}
          >
            Turn all on
          </button>
          <button
            type="button"
            className="text-xs font-medium text-amber-800 hover:text-amber-950 dark:text-amber-200 dark:hover:text-amber-50"
            disabled={disabled}
            onClick={() => setEnabledIds(new Set())}
          >
            Turn all off
          </button>
        </div>
      </div>
      <div className="divide-y divide-amber-500/25 border-y border-amber-500/25 bg-background">
        {entries.map((entry) => {
          const enabled = enabledIds.has(entry.id);
          const label = entry.title ?? entry.toolName;
          return (
            <div key={entry.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">{label}</div>
                {entry.description && (
                  <div className="truncate text-xs text-muted-foreground">{entry.description}</div>
                )}
              </div>
              <ToggleSwitch
                aria-label={`${label} allowed`}
                checked={enabled}
                disabled={disabled}
                onCheckedChange={(next) => {
                  setEnabledIds((current) => {
                    const updated = new Set(current);
                    if (next) updated.add(entry.id);
                    else updated.delete(entry.id);
                    return updated;
                  });
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <span className="text-xs text-amber-700 dark:text-amber-300">
          {selectedIds.length} of {count} will be on
        </span>
        <Button size="sm" disabled={disabled} onClick={() => onSubmit(selectedIds)}>
          {disabled ? "Saving…" : "Save choices"}
        </Button>
      </div>
    </section>
  );
}
