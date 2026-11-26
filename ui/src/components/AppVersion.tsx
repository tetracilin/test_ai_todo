import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { healthApi } from "@/api/health";
import { queryKeys } from "@/lib/queryKeys";
import { Button } from "@/components/ui/button";

/** The public repository the build commit belongs to. */
const COMMIT_URL_BASE = "https://github.com/tetracilin/test_ai_todo/commit/";

/** "v0.3.1 · 2bfb9246" for the screen, and the full text for a bug report. */
export function formatAppVersion(version: string | undefined, commit: string | null | undefined) {
  const shortSha = commit ? commit.slice(0, 8) : null;
  const versionText = version ? `v${version.replace(/^v/i, "")}` : null;
  return {
    shortSha,
    versionText,
    screenText: [versionText, shortSha].filter(Boolean).join(" · "),
    copyText: [versionText, commit ? `commit ${commit}` : null].filter(Boolean).join(" · "),
  };
}

/**
 * The running version and build commit, read from GET /api/health. It shows nothing while
 * loading or if the request fails, so it can never block the page it sits on.
 */
export function AppVersion({ className }: { className?: string }) {
  const [copied, setCopied] = useState(false);
  const { data } = useQuery({
    queryKey: queryKeys.health,
    queryFn: () => healthApi.get(),
    // The version only changes when the server restarts. No polling.
    staleTime: 5 * 60_000,
    retry: false,
  });

  const { shortSha, versionText, screenText, copyText } = formatAppVersion(data?.version, data?.commit);
  if (!screenText) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked. The version stays visible to read by eye.
    }
  }

  return (
    <div className={className} data-testid="app-version">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        {versionText ? <span>{versionText}</span> : null}
        {versionText && shortSha ? <span aria-hidden="true">·</span> : null}
        {shortSha && data?.commit ? (
          <a
            href={`${COMMIT_URL_BASE}${data.commit}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono underline"
            title="Open this build's commit on GitHub"
          >
            {shortSha}
          </a>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Copy version"
          title="Copy version and commit"
          onClick={() => void copy()}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
        <span role="status" className="sr-only">
          {copied ? "Version copied" : ""}
        </span>
      </div>
    </div>
  );
}
