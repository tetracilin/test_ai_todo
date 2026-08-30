import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Agent, Issue } from "@paperclipai/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@/lib/router";
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

function formatRunDate(value: string | Date | null | undefined) {
  if (!value) return "unknown start";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "unknown start" : date.toLocaleString();
}

function runLabel(run: WorkerLogRun, agentMap: ReadonlyMap<string, Pick<Agent, "name">>) {
  const agent = agentMap.get(run.agentId)?.name ?? run.agentId.slice(0, 8);
  const retry = run.retryOfRunId ? " retry" : "";
  return `${run.runId.slice(0, 8)} · ${agent} · ${run.status}${retry} · ${formatRunDate(run.startedAt ?? run.createdAt)}`;
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
    if (!selectedRunId) return;
    setLoading(true);
    setError(null);
    try {
      const page = await loadLog(selectedRunId, offset, LOG_CHUNK_BYTES);
      setPages((current) => {
        const loadedPage = { ...page, content: page.content ?? "", offset };
        if (replace) return [loadedPage];
        if (current.some((item) => item.offset === offset)) {
          return current.map((item) => item.offset === offset ? loadedPage : item);
        }
        return [...current, loadedPage].slice(-MAX_LOADED_CHUNKS);
      });
    } catch (cause) {
      setError(logErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [loadLog, selectedRunId]);

  useEffect(() => {
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
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">Worker Log</h3>
          <p className="text-xs text-muted-foreground">Redacted execution evidence. Raw output is shown as plain text.</p>
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

      <pre
        ref={viewportRef}
        onScroll={handleScroll}
        aria-live={isSelectedRunLive && autoFollow ? "polite" : "off"}
        aria-label="Worker log output"
        className={cn("max-h-96 overflow-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-xs leading-5 text-foreground", wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre")}
      >
        {loading && pages.length === 0 ? "Loading worker log…" : displayContent || (isSelectedRunLive ? "No output yet. This run is still active." : "No output was recorded for this run.")}
      </pre>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{new TextEncoder().encode(loadedContent).length.toLocaleString()} bytes loaded{pages.length >= MAX_LOADED_CHUNKS ? " (loading limit reached)" : ""}</span>
        {canLoadMore ? <button type="button" disabled={loading} onClick={() => void fetchPage(nextOffset!, false)} className="rounded-md border border-border px-2 py-1 disabled:opacity-50">Load more</button> : null}
      </div>
    </section>
  );
}
