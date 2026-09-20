// spawnSync wrapper that never lets a shell interpret argument values.
//
// On POSIX and for real executables on Windows (git.exe, gh.exe, node.exe) the command is
// spawned directly with no shell. On Windows, pnpm/npm/npx are .cmd shims, which Node cannot
// spawn without cmd.exe; those go through an explicit `cmd.exe /d /s /c "<line>"` where every
// argument is double-quoted (so & | < > ^ ( ) are literal) and any value that could still
// break out of the quotes (", %, CR, LF, NUL) is rejected instead of escaped.
import { spawnSync } from "node:child_process";

const CMD_SHIMS = new Set(["pnpm", "npm", "npx", "yarn"]);
const CMD_UNSAFE_ARG = /["%\r\n\0]/;

export function needsCmdShim(cmd, platform = process.platform) {
  return platform === "win32" && CMD_SHIMS.has(String(cmd).toLowerCase());
}

export function buildCmdShimInvocation(cmd, args) {
  for (const arg of [cmd, ...args]) {
    if (CMD_UNSAFE_ARG.test(String(arg))) {
      throw new Error(`refusing to pass an argument containing a quote, %, or newline through cmd.exe: ${JSON.stringify(String(arg))}`);
    }
  }
  const line = [cmd, ...args].map((arg) => `"${arg}"`).join(" ");
  return { file: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", `"${line}"`] };
}

export function spawnNoShell(cmd, args, options = {}) {
  if (needsCmdShim(cmd)) {
    const { file, args: shimArgs } = buildCmdShimInvocation(cmd, args);
    return spawnSync(file, shimArgs, { ...options, shell: false, windowsVerbatimArguments: true });
  }
  return spawnSync(cmd, args, { ...options, shell: false });
}
