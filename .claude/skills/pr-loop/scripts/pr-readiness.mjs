#!/usr/bin/env node
// pr-readiness: assess one PR at its CURRENT head (required checks, Greptile
// review, unresolved Greptile threads, commits behind base) and print a verdict.
//
// Usage:
//   node .claude/skills/pr-loop/scripts/pr-readiness.mjs [<pr-number>] [--json] [--wait]
//        [--timeout <minutes, default 30>] [--interval <seconds, default 30>]
//
// Pure logic is exported (assessChecks, assessGreptile, computeVerdict, parseBadge,
// stripHtml, compactFailedLog, extractRunId, splitArgv, parseCli) and unit-tested
// without git/gh. Verdicts: blocked:pr_not_open, blocked:base_not_develop,
// blocked:local_head_not_pushed, blocked:draft, blocked:merge_conflict, wait, fix_ci,
// fix_review, rebase, ready_for_human_merge (plus blocked:timeout_waiting_for_checks
// from --wait).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnNoShell } from "./spawn-safe.mjs";
import { parseArgs } from "../../../../.agents/skills/pr-gardening/scripts/lib.mjs";

export const DEFAULT_REPOSITORY = "tetracilin/test_ai_todo";
export const REQUIRED_CHECKS = ["unit", "build", "build-image"];
export const GREPTILE_CHECK_NAME = "Greptile Review";
export const GREPTILE_APP_SLUG = "greptile-apps";
export const GREPTILE_LOGIN = "greptile-apps";
const GREEN_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);
const GREPTILE_CLEAN_CONCLUSIONS = new Set(["success"]);
const FAILED_LOG_LINE = /FAIL|Error|error TS|×|✕|##\[error\]|Test Files|Tests  |ELIFECYCLE/;
const FAILED_LOG_MAX_LINES = 200;
const THREAD_TEXT_LIMIT = 300;
const MAX_BUFFER_BYTES = 50 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Process helpers (every external command goes through spawnNoShell: no shell ever
// parses an argument value; see spawn-safe.mjs for the Windows .cmd shim handling).
// ---------------------------------------------------------------------------

export function runCommand(cmd, args, { input } = {}) {
  const result = spawnNoShell(cmd, args, {
    encoding: "utf8",
    maxBuffer: MAX_BUFFER_BYTES,
    input,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function gh(args, { input } = {}) {
  const result = runCommand("gh", args, { input });
  if (result.status !== 0) {
    const error = new Error(`gh ${args.join(" ")} exited with status ${result.status}\n${result.stderr.trim()}`);
    error.status = result.status;
    error.stderr = result.stderr;
    throw error;
  }
  return result.stdout;
}

function ghJsonSafe(args, { input } = {}) {
  return JSON.parse(gh(args, { input }));
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function normalizeLogin(login) {
  return String(login ?? "").replace(/\[bot\]$/i, "").trim().toLowerCase();
}

export function parseBadge(body) {
  const match = String(body ?? "").match(/<img\b[^>]*\balt="(P1|P2|P3|security)"/i);
  return match ? match[1] : null;
}

export function stripHtml(body) {
  return String(body ?? "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function threadText(body) {
  return stripHtml(body).slice(0, THREAD_TEXT_LIMIT);
}

export function stripAnsi(text) {
  return String(text ?? "")
    .replace(/\x1b\][^\x07]*\x07/g, "")
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

export function compactFailedLog(text) {
  const seen = new Set();
  const kept = [];
  for (const raw of stripAnsi(text).split(/\r?\n/)) {
    // gh run view --log-failed prefixes "job\tstep\t<ISO timestamp> "; the timestamp is
    // dropped so repeated identical failures collapse into one line.
    const line = raw.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z ?/, "").trimEnd();
    if (!line || !FAILED_LOG_LINE.test(line)) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    kept.push(line);
    if (kept.length >= FAILED_LOG_MAX_LINES) break;
  }
  return kept;
}

export function extractRunId(detailsUrl) {
  const match = String(detailsUrl ?? "").match(/\/actions\/runs\/(\d+)(?:\/jobs?\/(\d+))?/);
  if (!match) return null;
  return { runId: match[1], jobId: match[2] ?? null };
}

function latestRunNamed(checkRuns, predicate) {
  let best = null;
  for (const run of checkRuns) {
    if (!predicate(run)) continue;
    if (!best) {
      best = run;
      continue;
    }
    const bestKey = Number(best.id ?? 0);
    const runKey = Number(run.id ?? 0);
    if (runKey > bestKey) best = run;
    else if (runKey === bestKey && String(run.started_at ?? "") > String(best.started_at ?? "")) best = run;
  }
  return best;
}

function describeRun(name, run) {
  if (!run) {
    return { name, present: false, status: "missing", conclusion: null, completed: false, green: false, detailsUrl: null };
  }
  const status = String(run.status ?? "").toLowerCase();
  const conclusion = run.conclusion == null ? null : String(run.conclusion).toLowerCase();
  const completed = status === "completed";
  return {
    name,
    present: true,
    status,
    conclusion,
    completed,
    green: completed && GREEN_CONCLUSIONS.has(conclusion),
    detailsUrl: run.details_url ?? run.detailsUrl ?? null,
  };
}

export function assessChecks(checkRuns) {
  const runs = Array.isArray(checkRuns) ? checkRuns : [];
  return REQUIRED_CHECKS.map((name) => describeRun(name, latestRunNamed(runs, (run) => run.name === name)));
}

export function isGreptileRun(run) {
  return run?.name === GREPTILE_CHECK_NAME || normalizeLogin(run?.app?.slug) === GREPTILE_APP_SLUG;
}

export function isGreptileThread(thread) {
  const first = thread?.comments?.nodes?.[0];
  return normalizeLogin(first?.author?.login) === GREPTILE_LOGIN;
}

export function assessGreptile(checkRuns, threads) {
  const runs = Array.isArray(checkRuns) ? checkRuns : [];
  const run = latestRunNamed(runs, isGreptileRun);
  const check = describeRun(GREPTILE_CHECK_NAME, run);
  check.clean = check.completed && GREPTILE_CLEAN_CONCLUSIONS.has(check.conclusion);

  const greptileThreads = (Array.isArray(threads) ? threads : []).filter(isGreptileThread).map((thread) => {
    const first = thread.comments?.nodes?.[0] ?? {};
    return {
      id: thread.id,
      isResolved: Boolean(thread.isResolved),
      isOutdated: Boolean(thread.isOutdated),
      path: thread.path ?? null,
      line: thread.line ?? null,
      commentId: first.databaseId ?? null,
      author: normalizeLogin(first.author?.login),
      badge: parseBadge(first.body),
      text: threadText(first.body),
    };
  });
  const unresolved = greptileThreads.filter((thread) => !thread.isResolved);
  return {
    check,
    threads: { total: greptileThreads.length, unresolved: unresolved.length, items: greptileThreads, unresolvedItems: unresolved },
  };
}

export const REQUIRED_BASE_BRANCH = "develop";

// localHeadSha is the checkout's HEAD when the checkout is on the PR branch (null
// otherwise). A local commit that is not the PR head means every check below would
// grade the wrong commit, so it blocks before anything else is looked at.
export function computeVerdict({ pr, checks, greptile, behindBy, localHeadSha = null }) {
  const state = String(pr?.state ?? "").toUpperCase();
  if (state !== "OPEN") return "blocked:pr_not_open";
  if (String(pr?.baseRefName ?? "") !== REQUIRED_BASE_BRANCH) return "blocked:base_not_develop";
  if (localHeadSha && String(localHeadSha) !== String(pr?.headSha ?? "")) return "blocked:local_head_not_pushed";
  if (pr?.isDraft) return "blocked:draft";
  if (String(pr?.mergeable ?? "").toUpperCase() === "CONFLICTING") return "blocked:merge_conflict";

  const required = Array.isArray(checks) ? checks : [];
  const greptileCheck = greptile?.check ?? { present: false, completed: false };
  // A completed red required check wins before waiting on Greptile: Greptile does
  // not run on every PR, so a missing Greptile run must not hide a CI failure.
  if (required.some((check) => !check.present || !check.completed)) return "wait";
  if (required.some((check) => !GREEN_CONCLUSIONS.has(check.conclusion))) return "fix_ci";
  if (!greptileCheck.present || !greptileCheck.completed) return "wait";
  const unresolved = greptile?.threads?.unresolved ?? 0;
  if (!GREPTILE_CLEAN_CONCLUSIONS.has(greptileCheck.conclusion) || unresolved > 0) return "fix_review";
  if ((behindBy ?? 0) > 0 || String(pr?.mergeStateStatus ?? "").toUpperCase() === "BEHIND") return "rebase";
  return "ready_for_human_merge";
}

export function shortSha(sha) {
  return String(sha ?? "").slice(0, 8);
}

export function formatAssessment(assessment) {
  const { pr, checks, greptile, behindBy, verdict } = assessment;
  const lines = [];
  lines.push(`PR #${pr.number} ${pr.url}`);
  lines.push(`head ${shortSha(pr.headSha)} on ${pr.headRefName} -> ${pr.baseRefName}`);
  if (assessment.localHeadSha && assessment.localHeadSha !== pr.headSha) {
    lines.push(`local HEAD ${shortSha(assessment.localHeadSha)} != PR head ${shortSha(pr.headSha)} (push before assessing)`);
  }
  for (const check of [...checks, greptile.check]) {
    lines.push(check.present ? `${check.name} | ${check.status} | ${check.conclusion ?? "-"}` : `${check.name} | missing | -`);
  }
  lines.push(`greptile threads: ${greptile.threads.unresolved}/${greptile.threads.total} unresolved`);
  for (const thread of greptile.threads.unresolvedItems) {
    lines.push(`  ${thread.path ?? "?"}:${thread.line ?? "-"} [${thread.badge ?? "-"}] ${thread.text}`);
  }
  lines.push(`behind develop: ${behindBy}`);
  lines.push(`mergeable: ${pr.mergeable ?? "UNKNOWN"}/${pr.mergeStateStatus ?? "UNKNOWN"}`);
  lines.push(`review decision: ${pr.reviewDecision || "none"}`);
  if (assessment.failedLogPath) {
    lines.push(`failed log: ${assessment.failedLogPath}`);
    for (const line of (assessment.failedLogHead ?? [])) lines.push(line);
  }
  lines.push(`verdict: ${verdict}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// GitHub data collection
// ---------------------------------------------------------------------------

const PR_FIELDS = "number,url,state,isDraft,headRefOid,headRefName,baseRefName,mergeable,mergeStateStatus,reviewDecision";

const REVIEW_THREADS_QUERY = `query($owner:String!,$name:String!,$number:Int!,$cursor:String){
  repository(owner:$owner,name:$name){
    pullRequest(number:$number){
      reviewThreads(first:100,after:$cursor){
        pageInfo{ hasNextPage endCursor }
        nodes{ id isResolved isOutdated path line comments(first:1){ nodes{ author{ login } body databaseId } } }
      }
    }
  }
}`;

function resolveRepository() {
  try {
    const name = ghJsonSafe(["repo", "view", "--json", "nameWithOwner"]).nameWithOwner;
    if (name && /^[^/\s]+\/[^/\s]+$/.test(name)) return name;
  } catch {
    // fall through to the default
  }
  return DEFAULT_REPOSITORY;
}

function currentBranch() {
  try {
    const result = runCommand("git", ["branch", "--show-current"]);
    return result.status === 0 ? result.stdout.trim() : "";
  } catch {
    return "";
  }
}

function localHeadFor(headRefName) {
  // Only meaningful when the checkout is on the PR branch; null otherwise.
  if (!headRefName || currentBranch() !== headRefName) return null;
  try {
    const result = runCommand("git", ["rev-parse", "HEAD"]);
    return result.status === 0 ? result.stdout.trim() || null : null;
  } catch {
    return null;
  }
}

function resolvePrNumber(explicit, repository) {
  if (explicit) return Number(explicit);
  // `gh pr view --repo <repo>` refuses to infer the PR from the checkout ("argument
  // required when using the --repo flag") and `gh pr view <branch>` falls back to
  // merged/closed PRs, so list the OPEN PRs for the current branch explicitly.
  const branch = currentBranch();
  if (!branch) throw new Error("not on a branch (detached HEAD); pass a PR number");
  const list = ghJsonSafe(["pr", "list", "--repo", repository, "--head", branch, "--state", "open", "--json", "number"]);
  const number = Array.isArray(list) ? list[0]?.number : null;
  if (!number) throw new Error(`no open PR found for branch ${branch}; pass a PR number`);
  return Number(number);
}

function fetchPr(repository, number) {
  const raw = ghJsonSafe(["pr", "view", String(number), "--repo", repository, "--json", PR_FIELDS]);
  return {
    number: raw.number,
    url: raw.url,
    state: raw.state,
    isDraft: Boolean(raw.isDraft),
    headSha: raw.headRefOid,
    headRefName: raw.headRefName,
    baseRefName: raw.baseRefName,
    mergeable: raw.mergeable || "UNKNOWN",
    mergeStateStatus: raw.mergeStateStatus || "UNKNOWN",
    reviewDecision: raw.reviewDecision || "",
  };
}

function fetchCheckRuns(repository, headSha) {
  const runs = [];
  for (let page = 1; page <= 20; page += 1) {
    // Query params go through -F so the URL never contains "&" (cmd.exe would split on it).
    const response = ghJsonSafe([
      "api", "-X", "GET", `repos/${repository}/commits/${headSha}/check-runs`, "-F", "per_page=100", "-F", `page=${page}`,
    ]);
    const pageRuns = response.check_runs ?? [];
    runs.push(...pageRuns);
    if (pageRuns.length < 100) break;
  }
  return runs;
}

function fetchBehindBy(repository, baseRefName, headSha) {
  const response = ghJsonSafe(["api", `repos/${repository}/compare/${baseRefName}...${headSha}`]);
  return Number(response.behind_by ?? 0);
}

function fetchReviewThreads(repository, number) {
  const [owner, name] = repository.split("/");
  const threads = [];
  let cursor = null;
  // Follow every page: an unresolved thread past the first 100 must not be invisible.
  for (let page = 0; page < 100; page += 1) {
    // The query travels over stdin (-F query=@-) so no shell quoting is needed on Windows.
    const args = ["api", "graphql", "-F", `owner=${owner}`, "-F", `name=${name}`, "-F", `number=${number}`];
    if (cursor) args.push("-F", `cursor=${cursor}`);
    args.push("-F", "query=@-");
    const response = ghJsonSafe(args, { input: REVIEW_THREADS_QUERY });
    if (response.errors?.length) throw new Error(`graphql: ${response.errors.map((entry) => entry.message).join("; ")}`);
    const connection = response.data?.repository?.pullRequest?.reviewThreads;
    threads.push(...(connection?.nodes ?? []));
    if (!connection?.pageInfo?.hasNextPage) return threads;
    cursor = connection.pageInfo.endCursor;
  }
  throw new Error("review threads exceed the pagination limit; refusing to assess a partial list");
}

export function assessPr(repository, number) {
  const pr = fetchPr(repository, number);
  const checkRuns = fetchCheckRuns(repository, pr.headSha);
  const threads = fetchReviewThreads(repository, number);
  const checks = assessChecks(checkRuns);
  const greptile = assessGreptile(checkRuns, threads);
  const behindBy = fetchBehindBy(repository, pr.baseRefName, pr.headSha);
  const localHeadSha = localHeadFor(pr.headRefName);
  const verdict = computeVerdict({ pr, checks, greptile, behindBy, localHeadSha });
  return { repository, pr, checks, greptile, behindBy, localHeadSha, verdict, failedLogPath: null, failedLogHead: [] };
}

function repoRoot() {
  const result = runCommand("git", ["rev-parse", "--show-toplevel"]);
  const top = result.status === 0 ? result.stdout.trim() : "";
  return top || process.cwd();
}

function collectFailedLogs(assessment) {
  const failing = assessment.checks.filter((check) => check.completed && !GREEN_CONCLUSIONS.has(check.conclusion));
  const lines = [];
  const seenRuns = new Set();
  for (const check of failing) {
    const ids = extractRunId(check.detailsUrl);
    if (!ids) {
      lines.push(`# ${check.name}: no run id in details_url ${check.detailsUrl ?? "(none)"}`);
      continue;
    }
    if (seenRuns.has(ids.runId)) continue;
    seenRuns.add(ids.runId);
    const result = runCommand("gh", ["run", "view", ids.runId, "--repo", assessment.repository, "--log-failed"]);
    const compact = compactFailedLog(`${result.stdout}\n${result.stderr}`);
    lines.push(`# ${check.name}: run ${ids.runId}${ids.jobId ? ` job ${ids.jobId}` : ""} (${check.conclusion})`);
    if (compact.length === 0) lines.push("(no matching lines in the failed log)");
    lines.push(...compact);
  }
  const limited = lines.slice(0, FAILED_LOG_MAX_LINES);
  const dir = path.join(repoRoot(), "tmp", "pr-loop");
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${assessment.pr.number}-${shortSha(assessment.pr.headSha)}-failed.log`);
  writeFileSync(filePath, `${limited.join("\n")}\n`);
  assessment.failedLogPath = filePath;
  assessment.failedLogHead = limited.slice(0, 20);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pendingSummary(assessment) {
  const pending = [...assessment.checks, assessment.greptile.check]
    .filter((check) => !check.present || !check.completed)
    .map((check) => `${check.name} ${check.status}`);
  return pending.length ? pending.join(", ") : "-";
}

export function splitArgv(argv) {
  const positional = [];
  const flags = [];
  for (const token of argv) {
    if (!token.startsWith("--") && /^\d+$/.test(token) && flags.length === 0) positional.push(token);
    else flags.push(token);
  }
  return { positional, flags };
}

const BOOLEAN_FLAGS = ["json", "wait"];
const VALUE_FLAGS = ["timeout", "interval"];

// Parses the CLI into { prNumber, json, wait, timeoutMs, intervalMs }. A PR number
// written after a boolean flag (`--json 105`) is recovered as the positional; any
// other value on a boolean flag, or a value flag without a value, is an error.
export function parseCli(argv, defaults = { timeout: "30", interval: "30" }) {
  const { positional, flags } = splitArgv(argv);
  const options = parseArgs(flags, defaults);
  for (const flag of BOOLEAN_FLAGS) {
    if (typeof options[flag] === "string") {
      if (/^\d+$/.test(options[flag]) && positional.length === 0) positional.push(options[flag]);
      else throw new Error(`--${flag} takes no value`);
      options[flag] = true;
    }
  }
  for (const flag of VALUE_FLAGS) {
    if (options[flag] === true) throw new Error(`--${flag} needs a value`);
  }
  if (positional.length > 1) throw new Error(`Unexpected argument: ${positional[1]}`);
  const timeoutMs = Number(options.timeout) * 60 * 1000;
  const intervalMs = Number(options.interval) * 1000;
  if (!Number.isFinite(timeoutMs) || !Number.isFinite(intervalMs) || timeoutMs <= 0 || intervalMs <= 0) {
    throw new Error("--timeout and --interval must be positive numbers");
  }
  return { prNumber: positional[0] ?? null, json: options.json === true, wait: options.wait === true, timeoutMs, intervalMs };
}

async function main() {
  const { prNumber, json: asJson, wait, timeoutMs, intervalMs } = parseCli(process.argv.slice(2));

  const repository = resolveRepository();
  const number = resolvePrNumber(prNumber, repository);

  const startedAt = Date.now();
  let poll = 0;
  let assessment = assessPr(repository, number);
  while (wait && assessment.verdict === "wait") {
    poll += 1;
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    if (Date.now() - startedAt >= timeoutMs) {
      assessment.verdict = "blocked:timeout_waiting_for_checks";
      break;
    }
    if (!asJson) console.log(`poll ${poll} (${elapsed}s): wait — ${pendingSummary(assessment)}`);
    else console.error(`poll ${poll} (${elapsed}s): wait — ${pendingSummary(assessment)}`);
    await sleep(intervalMs);
    assessment = assessPr(repository, number);
  }

  if (assessment.verdict === "fix_ci") collectFailedLogs(assessment);

  if (asJson) {
    process.stdout.write(`${JSON.stringify(assessment, null, 2)}\n`);
  } else {
    console.log(formatAssessment(assessment));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
