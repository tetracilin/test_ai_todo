import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Agent, Issue } from "@paperclipai/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { Skeleton } from "@/components/ui/skeleton";
import { activityApi, type RunForIssue } from "../api/activity";
import { ApiError } from "../api/client";
import { heartbeatsApi, type ActiveRunForIssue } from "../api/heartbeats";
import { copyTextToClipboard } from "../lib/clipboard";
import { cn } from "../lib/utils";
import { queryKeys } from "../lib/queryKeys";
import { keepPreviousDataForSameQueryTail } from "../lib/query-placeholder-data";

const LOG_CHUNK_BYTES = 64_000;
const MAX_LOADED_CHUNKS = 8;
const ACTIVE_RUN_STATUSES = new Set(["queued", "running"]);
const TERMINAL_STATUS_LABELS: Record<string, string> = {
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
  timed_out: "Timed out",
  scheduled_retry: "Scheduled retry",
};

type WorkerLogRun = Pick<RunForIssue, "runId" | "status" | "agentId" | "startedAt" | "finishedAt" | "createdAt" | "retryOfRunId">;

type LogPage = {
  runId: string;
  content: string;
  nextOffset?: number;
};

type LoadedLogPage = LogPage & { offset: number };

type IssueWorkerLogProps = {
  issueId: string;
  issueStatus: Issue["status"];
  agentMap: ReadonlyMap<string, Pick<Agent, "name">>;
  hasLiveRuns: boolean;
};

type IssueWorkerLogContentProps = {
  runs: WorkerLogRun[];
  activeRun?: Pick<ActiveRunForIssue, "id" | "status" | "agentId" | "agentName" | "startedAt" | "finishedAt" | "createdAt"> | null;
  agentMap: ReadonlyMap<string, Pick<Agent, "name">>;
  loadLog?: (runId: string, offset: number, limitBytes: number) => Promise<LogPage>;
};

function isActiveRun(run: Pick<WorkerLogRun, "status">) {
  return ACTIVE_RUN_STATUSES.has(run.status);
}

function runStatusLabel(status: string) {
  return TERMINAL_STATUS_LABELS[status] ?? status.replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatRunDate(value: string | Date | null | undefined) {
  if (!value) return "unknown start";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "unknown start" : date.toLocaleString();
}

/**
 * Human-readable run duration from startedAt → finishedAt. Returns null when
 * either bound is missing/invalid or the interval is negative (TVR-W02).
 */
function formatRunDuration(startedAt: string | Date | null | undefined, finishedAt: string | Date | null | undefined): string | null {
  if (!startedAt || !finishedAt) return null;
  const start = new Date(startedAt).getTime();
  const finish = new Date(finishedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(finish)) return null;
  const totalSeconds = Math.max(0, Math.round((finish - start) / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes > 0 ? `${hours}h ${restMinutes}m` : `${hours}h`;
}

/**
 * Attempt/retry relation for a run selector entry: the original run's short ID
 * when the run is a retry, so the chain stays visible in the dropdown (TVR-W02).
 */
function retryRelationLabel(run: Pick<WorkerLogRun, "retryOfRunId">): string | null {
  if (!run.retryOfRunId) return null;
  const target = run.retryOfRunId.length > 8 ? run.retryOfRunId.slice(0, 8) : run.retryOfRunId;
  return `retry of ${target}`;
}

function runLabel(run: WorkerLogRun, agentMap: ReadonlyMap<string, Pick<Agent, "name">>) {
  const agent = agentMap.get(run.agentId)?.name ?? run.agentId.slice(0, 8);
  const duration = formatRunDuration(run.startedAt, run.finishedAt);
  // Live runs have no finishedAt yet: surface "active" in the duration slot
  // instead of dropping it (a terminal run missing finishedAt gets no slot).
  const durationSlot = duration ?? (isActiveRun(run) ? "active" : null);
  const retry = retryRelationLabel(run);
  return [
    run.runId.slice(0, 8),
    agent,
    runStatusLabel(run.status),
    durationSlot,
    retry,
    formatRunDate(run.startedAt ?? run.createdAt),
  ].filter((part): part is string => Boolean(part)).join(" · ");
}

function logErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 403) return "You do not have permission to view this worker log.";
    if (error.status === 404) return "Worker log is unavailable or has been rotated.";
  }
  return error instanceof Error && error.message ? error.message : "Worker log could not be loaded.";
}

function stripAnsi(value: string) {
  return value.replace(/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PRZcf-nq-uy=><~]))/g, "");
}

function redactFilesystemPaths(value: string) {
  const urls: string[] = [];
  const withUrlTokens = value.replace(/https?:\/\/[^\s'"`<>]+/gi, (url) => {
    const index = urls.push(url) - 1;
    return `\u0000url-${index}\u0000`;
  });
  return withUrlTokens
    .replace(/file:\/\/\/[^\s'"`<>]*/gi, "[redacted filesystem path]")
    .replace(/(?:[A-Za-z]:\\|\\\\[^\s'"`<>]+\\)[^\s'"`<>]*/g, "[redacted filesystem path]")
    // Logs may contain project-specific absolute paths, not only known host
    // roots. Restore HTTP(S) URLs after redacting every other slash token.
    .replace(/\/(?:[^\s'"`<>])*/g, "[redacted filesystem path]")
    .replace(/\u0000url-(\d+)\u0000/g, (_token, index: string) => urls[Number(index)] ?? "");
}

export function IssueWorkerLog({ issueId, issueStatus, agentMap, hasLiveRuns }: IssueWorkerLogProps) {
  const { data: runs = [] } = useQuery({
    queryKey: queryKeys.issues.runs(issueId),
    queryFn: () => activityApi.runsForIssue(issueId),
    refetchInterval: hasLiveRuns || issueStatus === "in_progress" ? 5000 : false,
    placeholderData: keepPreviousDataForSameQueryTail<RunForIssue[]>(issueId),
  });
  const { data: activeRun = null } = useQuery({
    queryKey: queryKeys.issues.activeRun(issueId),
    queryFn: () => heartbeatsApi.activeRunForIssue(issueId),
    enabled: hasLiveRuns || issueStatus === "in_progress",
    refetchInterval: hasLiveRuns ? false : 3000,
    placeholderData: keepPreviousDataForSameQueryTail<ActiveRunForIssue | null>(issueId),
  });

  return <IssueWorkerLogContent runs={runs} activeRun={activeRun} agentMap={agentMap} />;
}

export function IssueWorkerLogContent({
  runs,
  activeRun = null,
  agentMap,
  loadLog = heartbeatsApi.log,
}: IssueWorkerLogContentProps) {
  const allRuns = useMemo<WorkerLogRun[]>(() => {
    const merged = new Map<string, WorkerLogRun>();
    for (const run of runs) merged.set(run.runId, run);
    if (activeRun && !merged.has(activeRun.id)) {
      merged.set(activeRun.id, {
        runId: activeRun.id,
        status: activeRun.status,
        agentId: activeRun.agentId,
        startedAt: activeRun.startedAt instanceof Date ? activeRun.startedAt.toISOString() : activeRun.startedAt,
        finishedAt: activeRun.finishedAt instanceof Date ? activeRun.finishedAt.toISOString() : activeRun.finishedAt,
        createdAt: activeRun.createdAt instanceof Date ? activeRun.createdAt.toISOString() : activeRun.createdAt,
      });
    }
    return [...merged.values()].sort((left, right) => {
      const activeDelta = Number(isActiveRun(right)) - Number(isActiveRun(left));
      if (activeDelta !== 0) return activeDelta;
      return new Date(right.startedAt ?? right.createdAt).getTime() - new Date(left.startedAt ?? left.createdAt).getTime();
    });
  }, [activeRun, runs]);
  const preferredRunId = allRuns.find(isActiveRun)?.runId ?? allRuns[0]?.runId ?? null;
  const [selectedRunId, setSelectedRunId] = useState<string | null>(preferredRunId);
  const [pages, setPages] = useState<LoadedLogPage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawView, setRawView] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [autoFollow, setAutoFollow] = useState(Boolean(preferredRunId && allRuns.find((run) => run.runId === preferredRunId && isActiveRun(run))));
  const [search, setSearch] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const viewportRef = useRef<HTMLPreElement>(null);
  // Guards against a stale in-flight log read resolving after the user switched
  // runs: pages/results from a deselected run are dropped instead of applied.
  const activeRunIdRef = useRef<string | null>(selectedRunId);
  const selectedRun = allRuns.find((run) => run.runId === selectedRunId) ?? null;
  const isSelectedRunLive = Boolean(selectedRun && isActiveRun(selectedRun));
  const loadedContent = redactFilesystemPaths(pages.map((page) => page.content).join(""));
  const displayContent = rawView ? loadedContent : stripAnsi(loadedContent);
  const nextOffset = pages.at(-1)?.nextOffset;
  const canLoadMore = nextOffset !== undefined && pages.length < MAX_LOADED_CHUNKS;
  const searchMatches = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return 0;
    return displayContent.toLocaleLowerCase().split(needle).length - 1;
  }, [displayContent, search]);

  useEffect(() => {
    if (selectedRunId && allRuns.some((run) => run.runId === selectedRunId)) return;
    setSelectedRunId(preferredRunId);
  }, [allRuns, preferredRunId, selectedRunId]);

  const fetchPage = useCallback(async (offset: number, replace: boolean) => {
    const runId = selectedRunId;
    if (!runId) return;
    setLoading(true);
    setError(null);
    try {
      const page = await loadLog(runId, offset, LOG_CHUNK_BYTES);
      const loadedPage = { ...page, content: page.content ?? "", offset };
      setPages((current) => {
        if (activeRunIdRef.current !== runId) return current;
        if (replace) return [loadedPage];
        if (current.some((item) => item.offset === offset)) {
          return current.map((item) => (item.offset === offset ? loadedPage : item));
        }
        return [...current, loadedPage].slice(-MAX_LOADED_CHUNKS);
      });
    } catch (cause) {
      if (activeRunIdRef.current === runId) setError(logErrorMessage(cause));
    } finally {
      if (activeRunIdRef.current === runId) setLoading(false);
    }
  }, [loadLog, selectedRunId]);

  useEffect(() => {
    activeRunIdRef.current = selectedRunId;
    setPages([]);
    setError(null);
    setSearch("");
    setCopyState("idle");
    if (selectedRunId) void fetchPage(0, true);
  }, [fetchPage, selectedRunId]);

  useEffect(() => {
    if (!selectedRunId || !isSelectedRunLive || !autoFollow) return;
    const timer = window.setInterval(() => {
      // Consume known pages first. Once caught up, poll the final page because
      // live output can make it grow or add a next page.
      const offset = nextOffset ?? pages.at(-1)?.offset ?? 0;
      void fetchPage(offset, pages.length === 0);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [autoFollow, fetchPage, isSelectedRunLive, nextOffset, pages.length, selectedRunId]);

  useEffect(() => {
    if (!autoFollow) return;
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [autoFollow, displayContent]);

  const handleScroll = () => {
    const viewport = viewportRef.current;
    if (!viewport || !isSelectedRunLive) return;
    const atBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 12;
    if (!atBottom) setAutoFollow(false);
  };

  const handleCopy = async () => {
    try {
      await copyTextToClipboard(displayContent);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  if (allRuns.length === 0) {
    return (
      <section aria-label="Worker log" className="rounded-lg border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
        No worker runs linked to this task.
      </section>
    );
  }

  return (
    <section aria-label="Worker log" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-medium">Worker Log</h3>
          {selectedRun ? (
            <span
              role={isSelectedRunLive ? "status" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs",
                isSelectedRunLive
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "border-border bg-muted/40 text-muted-foreground",
              )}
            >
              {isSelectedRunLive ? (
                <>
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current motion-safe:animate-pulse" />
                  {runStatusLabel(selectedRun.status)} · live
                </>
              ) : (
                <>Terminal · {runStatusLabel(selectedRun.status)}</>
              )}
            </span>
          ) : null}
        </div>
        {selectedRun ? (
          <Link
            to={`/agents/${selectedRun.agentId}/runs/${selectedRun.runId}`}
            className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Full Run Detail
          </Link>
        ) : null}
      </div>

      <label className="block text-xs font-medium text-muted-foreground">
        Task run
        <select
          aria-label="Task run"
          value={selectedRunId ?? ""}
          onChange={(event) => setSelectedRunId(event.target.value || null)}
          className="mt-1 block w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground"
        >
          {allRuns.map((run) => <option key={run.runId} value={run.runId}>{runLabel(run, agentMap)}</option>)}
        </select>
      </label>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <div role="group" aria-label="Log view" className="inline-flex rounded-md border border-border">
          <button type="button" aria-pressed={!rawView} onClick={() => setRawView(false)} className={cn("px-2 py-1", !rawView && "bg-accent text-foreground")}>Parsed</button>
          <button type="button" aria-pressed={rawView} onClick={() => setRawView(true)} className={cn("border-l border-border px-2 py-1", rawView && "bg-accent text-foreground")}>Raw log</button>
        </div>
        <label className="flex items-center gap-1"><input type="checkbox" checked={wrap} onChange={(event) => setWrap(event.target.checked)} /> Wrap lines</label>
        {isSelectedRunLive ? <label className="flex items-center gap-1"><input type="checkbox" checked={autoFollow} onChange={(event) => setAutoFollow(event.target.checked)} /> Auto-follow</label> : null}
        <button type="button" onClick={() => void handleCopy()} disabled={!displayContent} className="rounded-md border border-border px-2 py-1 disabled:opacity-50">{copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy"}</button>
      </div>

      <label className="block text-xs font-medium text-muted-foreground">
        Search loaded log
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="mt-1 block w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground"
          placeholder="Find text in loaded output"
        />
        {search.trim() ? <span className="mt-1 block font-normal">{searchMatches} match{searchMatches === 1 ? "" : "es"} in loaded output</span> : null}
      </label>

      {error ? (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <p>{error}</p>
          <button type="button" className="mt-2 rounded-md border border-current px-2 py-1 text-xs" onClick={() => void fetchPage(pages.length ? (nextOffset ?? 0) : 0, pages.length === 0)}>Retry</button>
        </div>
      ) : null}

      {loading && pages.length === 0 ? (
        <div role="status" aria-label="Loading worker log" className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ) : (
        <pre
          ref={viewportRef}
          onScroll={handleScroll}
          aria-live={isSelectedRunLive && autoFollow ? "polite" : "off"}
          aria-busy={loading}
          aria-label="Worker log output"
          className={cn("max-h-96 overflow-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-xs leading-5 text-foreground", wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre")}
        >
          {displayContent || (isSelectedRunLive ? "No output yet. This run is still active." : "No output was recorded for this run.")}
        </pre>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {new TextEncoder().encode(loadedContent).length.toLocaleString()} bytes loaded{pages.length >= MAX_LOADED_CHUNKS ? " (loading limit reached)" : ""}
          {loading && pages.length > 0 ? <span role="status" className="ml-2">Loading more…</span> : null}
        </span>
        {canLoadMore ? <button type="button" disabled={loading} onClick={() => void fetchPage(nextOffset!, false)} className="rounded-md border border-border px-2 py-1 disabled:opacity-50">Load more</button> : null}
      </div>
    </section>
  );
}
