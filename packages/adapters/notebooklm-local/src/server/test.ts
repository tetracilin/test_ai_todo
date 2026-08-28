import { randomUUID } from "node:crypto";
import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@paperclipai/adapter-utils";
import {
  asString,
  ensureAbsoluteDirectory,
  ensurePathInEnv,
  parseObject,
  runChildProcess,
} from "@paperclipai/adapter-utils/server-utils";
import {
  buildNotebookLmLocalArgv,
  classifyNotebookLmLocalAuthFailure,
  isNotebookLmLocalCommandNotFoundError,
} from "./parse.js";

// NLM-A05: real testEnvironment() for the notebooklm_local adapter, per the
// canonical plan's Phase 1 requirement ("`testEnvironment()` runs the exact
// live-supported login check with configured profile and classifies valid
// auth, invalid auth, command-not-found, wrong binary, and profile-store
// access. It must run in the same execution target as real commands.").
//
// Runs three independent probes, in this order, and folds them into one
// AdapterEnvironmentTestResult:
//   1. profile-store accessibility (cookieStorePath) -- a filesystem stat
//      only; the store's *contents* (cookies/session material) are never
//      read or logged, matching NLM-A02/A04's no-profile-content-leak
//      precedent.
//   2. binary identity (`<command> --version`) -- classifies command-not-found
//      and "wrong binary" (resolves to something, but it doesn't self-report
//      as the `nlm` CLI).
//   3. live auth probe (`nlm login --check --profile <profile>`, the exact
//      live-captured syntax from NLM-C01/A02) -- classifies valid auth vs.
//      invalid/expired auth, reusing execute.ts's own
//      classifyNotebookLmLocalAuthFailure/isNotebookLmLocalCommandNotFoundError
//      so the probe reflects exactly what a real run would see, per A04's
//      "next card needs" note. Skipped when the binary-identity probe
//      already failed, since there is nothing meaningful left to probe.
//
// Both probes spawn through the shared runChildProcess() helper -- the same
// execution primitive execute.ts uses -- with argv arrays only (never shell
// interpolation) and the same NOTEBOOKLM_MCP_CLI_PATH env-injection shape as
// a real run, so "same execution target as real commands" holds structurally,
// not just in spirit. No Google credential field is read from config; only
// the plain `command`/`profile`/`cookieStorePath`/`cwd` fields already on the
// A04 config schema are used.

const VERSION_PROBE_TIMEOUT_SEC = 10;
const VERSION_PROBE_GRACE_SEC = 5;
const NLM_VERSION_OUTPUT_PATTERN = /^nlm version \d+\.\d+\.\d+/im;

// Only the boolean "did this look like an nlm login --check success" and the
// configured profile name are ever surfaced in check messages -- never the
// raw stdout, which for a real profile includes an `Account: <email>` line
// (see NLM-A02 evidence). That keeps this probe's checks free of profile
// contents/PII even though the underlying probe process necessarily reads
// them.
const NLM_AUTH_VALID_PATTERN = /authentication valid/i;

function summarizeStatus(checks: AdapterEnvironmentCheck[]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((check) => check.level === "error")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "warn";
  return "pass";
}

function finalize(ctx: AdapterEnvironmentTestContext, checks: AdapterEnvironmentCheck[]): AdapterEnvironmentTestResult {
  return {
    adapterType: ctx.adapterType,
    status: summarizeStatus(checks),
    checks,
    testedAt: new Date().toISOString(),
  };
}

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const config = parseObject(ctx.config);
  const command = asString(config.command, "nlm");
  const profile = asString(config.profile, "default");
  const cookieStorePath = asString(config.cookieStorePath, "");
  const cwd = asString(config.cwd, process.cwd());

  if (!command) {
    checks.push({
      code: "notebooklm_local_command_missing",
      level: "error",
      message: "notebooklm_local adapter requires a command.",
      hint: 'Set adapterConfig.command to "nlm" or an absolute path to the notebooklm-mcp-cli binary.',
    });
    return finalize(ctx, checks);
  }

  // --- 1. profile-store accessibility ---------------------------------
  // Plain filesystem stat only -- directory existence/readability, never
  // file contents. cookieStorePath is optional (nlm falls back to its own
  // default profile-store location when unset), so an empty value is a
  // warning, not an error.
  if (cookieStorePath) {
    try {
      await ensureAbsoluteDirectory(cookieStorePath);
      checks.push({
        code: "notebooklm_local_profile_store_accessible",
        level: "info",
        message: `Profile store directory is accessible: ${cookieStorePath}`,
      });
    } catch (err) {
      checks.push({
        code: "notebooklm_local_profile_store_inaccessible",
        level: "error",
        message: err instanceof Error ? err.message : "Profile store directory is not accessible",
        detail: cookieStorePath,
        hint:
          "Verify cookieStorePath points to a readable directory on this runtime (e.g. /paperclip/notebooklm), " +
          "matching NOTEBOOKLM_MCP_CLI_PATH.",
      });
    }
  } else {
    checks.push({
      code: "notebooklm_local_profile_store_not_configured",
      level: "warn",
      message: "No cookieStorePath configured; nlm will use its own default profile-store location.",
      hint: "Set cookieStorePath to this runtime's NOTEBOOKLM_MCP_CLI_PATH (e.g. /paperclip/notebooklm) for a deterministic, verifiable profile store.",
    });
  }

  const env: Record<string, string> = {};
  if (cookieStorePath) env.NOTEBOOKLM_MCP_CLI_PATH = cookieStorePath;
  const runtimeEnv = ensurePathInEnv({ ...process.env, ...env });
  void runtimeEnv; // resolved for parity with execute.ts's env construction; runChildProcess resolves PATH itself.

  // --- 2. binary identity (`<command> --version`) ----------------------
  let binaryIdentityOk = false;
  try {
    const versionResult = await runChildProcess(`testenv-version-${randomUUID()}`, command, ["--version"], {
      cwd,
      env,
      timeoutSec: VERSION_PROBE_TIMEOUT_SEC,
      graceSec: VERSION_PROBE_GRACE_SEC,
      onLog: async () => {},
    });

    if (versionResult.timedOut) {
      checks.push({
        code: "notebooklm_local_version_probe_timeout",
        level: "error",
        message: `"${command} --version" did not complete within ${VERSION_PROBE_TIMEOUT_SEC}s.`,
        detail: command,
        hint: "The configured command may be hung or unresponsive; verify it is the notebooklm-mcp-cli binary.",
      });
    } else if ((versionResult.exitCode ?? 1) !== 0) {
      checks.push({
        code: "notebooklm_local_wrong_binary",
        level: "error",
        message: `"${command} --version" exited with code ${versionResult.exitCode ?? -1}; this does not look like the nlm CLI.`,
        detail: command,
        hint: "Verify adapterConfig.command resolves to the notebooklm-mcp-cli (nlm) binary, not an unrelated executable.",
      });
    } else if (!NLM_VERSION_OUTPUT_PATTERN.test(versionResult.stdout)) {
      checks.push({
        code: "notebooklm_local_wrong_binary",
        level: "error",
        message: `"${command} --version" succeeded but did not report an nlm version string.`,
        detail: command,
        hint: "Verify adapterConfig.command resolves to the notebooklm-mcp-cli (nlm) binary, not an unrelated executable with the same name.",
      });
    } else {
      const versionLine = versionResult.stdout.trim().split(/\r?\n/)[0] ?? "";
      binaryIdentityOk = true;
      checks.push({
        code: "notebooklm_local_binary_identity_verified",
        level: "info",
        message: `Verified nlm binary identity: ${versionLine}`,
        detail: command,
      });
    }
  } catch (err) {
    if (isNotebookLmLocalCommandNotFoundError(err)) {
      checks.push({
        code: "notebooklm_local_command_not_found",
        level: "error",
        message: err instanceof Error ? err.message : `notebooklm_local: command not found: "${command}"`,
        detail: command,
        hint: 'Install notebooklm-mcp-cli and verify PATH, or set adapterConfig.command to its absolute path.',
      });
    } else {
      throw err;
    }
  }

  // --- 3. live auth probe (`nlm login --check --profile <profile>`) ----
  // Skipped when the binary-identity probe already failed (command-not-found
  // or wrong-binary/timeout) -- there is no meaningful auth signal to read
  // from a binary that isn't nlm, and re-running the same broken command
  // would only duplicate the check above.
  if (binaryIdentityOk) {
    let authArgv: string[];
    try {
      authArgv = buildNotebookLmLocalArgv({ subcommand: "login", args: ["--check"], profile });
    } catch (err) {
      checks.push({
        code: "notebooklm_local_auth_probe_misconfigured",
        level: "error",
        message: err instanceof Error ? err.message : "notebooklm_local: could not build the login --check probe",
      });
      return finalize(ctx, checks);
    }

    try {
      const authResult = await runChildProcess(`testenv-auth-${randomUUID()}`, command, authArgv, {
        cwd,
        env,
        timeoutSec: VERSION_PROBE_TIMEOUT_SEC,
        graceSec: VERSION_PROBE_GRACE_SEC,
        onLog: async () => {},
      });

      if (authResult.timedOut) {
        checks.push({
          code: "notebooklm_local_auth_probe_timeout",
          level: "error",
          message: `"nlm login --check --profile ${profile}" did not complete within ${VERSION_PROBE_TIMEOUT_SEC}s.`,
          hint: "The profile-store filesystem or an interactive auth prompt may be blocking; verify no automatic browser/login flow is triggered.",
        });
      } else if ((authResult.exitCode ?? 1) === 0 && NLM_AUTH_VALID_PATTERN.test(authResult.stdout)) {
        checks.push({
          code: "notebooklm_local_auth_valid",
          level: "info",
          message: `nlm profile "${profile}" reports valid authentication.`,
        });
      } else {
        const combinedOutput = `${authResult.stdout}\n${authResult.stderr}`;
        const isAuthFailure = classifyNotebookLmLocalAuthFailure(combinedOutput);
        checks.push({
          code: isAuthFailure ? "notebooklm_local_auth_invalid" : "notebooklm_local_auth_probe_failed",
          level: "error",
          message: isAuthFailure
            ? `nlm profile "${profile}" authentication is invalid or expired.`
            : `"nlm login --check --profile ${profile}" exited with code ${authResult.exitCode ?? -1} without a recognized auth-failure signal.`,
          hint: "Run `nlm login --profile " + profile + "` out of band (this adapter never performs automatic login).",
        });
      }
    } catch (err) {
      if (isNotebookLmLocalCommandNotFoundError(err)) {
        checks.push({
          code: "notebooklm_local_command_not_found",
          level: "error",
          message: err instanceof Error ? err.message : `notebooklm_local: command not found: "${command}"`,
          detail: command,
        });
      } else {
        throw err;
      }
    }
  }

  return finalize(ctx, checks);
}
