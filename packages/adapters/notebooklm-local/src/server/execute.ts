import type {
  AdapterExecutionContext,
  AdapterExecutionResult,
} from "@paperclipai/adapter-utils";
import {
  asString,
  asNumber,
  buildInvocationEnvForLogs,
  buildPaperclipEnv,
  ensurePathInEnv,
  parseObject,
  resolveCommandForLogs,
  runChildProcess,
} from "@paperclipai/adapter-utils/server-utils";
import {
  boundNotebookLmLocalText,
  buildNotebookLmLocalArgv,
  classifyNotebookLmLocalAuthFailure,
  isNotebookLmLocalCommandNotFoundError,
  parseNotebookLmLocalStdout,
  resolveNotebookLmLocalArgs,
} from "./parse.js";

// NLM-A04: real execute() for the notebooklm_local adapter, per the
// canonical plan (2026-08-28-notebooklm-adapter-action-plan-review.md,
// "Phase 1"). Structurally mirrors the built-in `process` adapter
// (server/src/adapters/process/execute.ts) — the plan's explicit reference
// point — trimmed to notebooklm_local's narrower, allowlisted surface:
// - argv is [subcommand, ...args] spawned as a literal array (never a
//   shell string); the subcommand is checked against the live-captured nlm
//   v0.9.14 CLI surface before anything is spawned (see parse.ts).
// - env only ever gets the configured cookieStorePath (mapped to
//   NOTEBOOKLM_MCP_CLI_PATH, matching NLM-A01/A02's verified env shape) plus
//   Paperclip's own runtime identity vars. No Google credential/cookie
//   value is ever accepted from adapterConfig or written to logs.
// - `--json` stdout is parsed only when the caller explicitly requested it
//   (a literal "--json" arg); every other invocation returns raw stdout,
//   exactly like `process`. NotebookLM output — JSON or raw — is always
//   treated as untrusted data, never executable instructions.
export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, agent, config, onLog, onMeta, authToken } = ctx;

  const command = asString(config.command, "nlm");
  if (!command) throw new Error("notebooklm_local adapter missing command");

  const subcommand = asString(config.subcommand, "");
  const profile = asString(config.profile, "default");
  const cookieStorePath = asString(config.cookieStorePath, "");
  const args = resolveNotebookLmLocalArgs(config.args);

  // Throws for structural misconfiguration (missing/disallowed subcommand),
  // before any process is spawned — mirrors the process adapter's
  // "missing command" throw for the same class of error.
  const argv = buildNotebookLmLocalArgv({ subcommand, args, profile });
  const jsonRequested = argv.includes("--json");

  const cwd = asString(config.cwd, process.cwd());

  const env: Record<string, string> = {
    ...buildPaperclipEnv(agent),
  };
  if (cookieStorePath) {
    env.NOTEBOOKLM_MCP_CLI_PATH = cookieStorePath;
  }
  env.PAPERCLIP_RUN_ID = runId;
  if (authToken) env.PAPERCLIP_API_KEY = authToken;

  const runtimeEnv = ensurePathInEnv({ ...process.env, ...env });
  const resolvedCommand = await resolveCommandForLogs(command, cwd, runtimeEnv);
  const loggedEnv = buildInvocationEnvForLogs(env, {
    runtimeEnv,
    includeRuntimeKeys: ["HOME"],
    resolvedCommand,
  });

  const timeoutSec = asNumber(config.timeoutSec, 60);
  const graceSec = asNumber(config.graceSec, 15);

  if (onMeta) {
    await onMeta({
      adapterType: "notebooklm_local",
      command: resolvedCommand,
      cwd,
      commandArgs: argv,
      env: loggedEnv,
    });
  }

  let proc: Awaited<ReturnType<typeof runChildProcess>>;
  try {
    proc = await runChildProcess(runId, command, argv, {
      cwd,
      env,
      timeoutSec,
      graceSec,
      onLog,
      onSpawn: ctx.onSpawn,
    });
  } catch (err) {
    if (isNotebookLmLocalCommandNotFoundError(err)) {
      return {
        exitCode: null,
        signal: null,
        timedOut: false,
        errorCode: "notebooklm_local_command_not_found",
        errorMessage: err instanceof Error ? err.message : "notebooklm_local: command not found",
      };
    }
    throw err;
  }

  const boundedStderr = boundNotebookLmLocalText(proc.stderr);

  if (proc.timedOut) {
    return {
      exitCode: proc.exitCode,
      signal: proc.signal,
      timedOut: true,
      errorCode: "notebooklm_local_timeout",
      errorMessage: `notebooklm_local: timed out after ${timeoutSec}s`,
      resultJson: {
        stdout: boundNotebookLmLocalText(proc.stdout).text,
        stderr: boundedStderr.text,
      },
    };
  }

  const parsedStdout = parseNotebookLmLocalStdout(proc.stdout, { jsonRequested });
  const resultJson: Record<string, unknown> = {
    stdout: parsedStdout.raw,
    stderr: boundedStderr.text,
  };
  if (jsonRequested) {
    resultJson.json = parsedStdout.json;
    if (parsedStdout.jsonParseError) resultJson.jsonParseError = parsedStdout.jsonParseError;
    if (parsedStdout.jsonTruncated) resultJson.jsonTruncated = true;
  }
  if (parsedStdout.rawTruncated) resultJson.stdoutTruncated = true;
  if (boundedStderr.truncated) resultJson.stderrTruncated = true;

  if ((proc.exitCode ?? 0) !== 0) {
    const combinedOutput = `${proc.stdout}\n${proc.stderr}`;
    const isAuthFailure = classifyNotebookLmLocalAuthFailure(combinedOutput);
    return {
      exitCode: proc.exitCode,
      signal: proc.signal,
      timedOut: false,
      errorCode: isAuthFailure ? "notebooklm_local_auth_failed" : "notebooklm_local_nonzero_exit",
      errorMessage: isAuthFailure
        ? "notebooklm_local: nlm reported an authentication failure; run `nlm login` out of band (this adapter never performs automatic login)"
        : `notebooklm_local: nlm exited with code ${proc.exitCode ?? -1}`,
      resultJson,
    };
  }

  return {
    exitCode: proc.exitCode,
    signal: proc.signal,
    timedOut: false,
    resultJson,
  };
}
