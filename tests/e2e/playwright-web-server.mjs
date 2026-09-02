import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const fixture = spawn(process.execPath, ["tests/e2e/hermes-gateway-fixture.mjs"], {
  cwd: repoRoot,
  env: process.env,
  stdio: "inherit",
});
const paperclip = spawn("pnpm", ["paperclipai", "onboard", "--yes", "--run"], {
  cwd: repoRoot,
  env: process.env,
  stdio: "inherit",
});

let stopping = false;
function stop(signal) {
  if (stopping) return;
  stopping = true;
  if (fixture.exitCode === null) fixture.kill(signal);
  if (paperclip.exitCode === null) paperclip.kill(signal);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.once(signal, () => stop(signal));
}

paperclip.once("exit", (code) => {
  stop("SIGTERM");
  process.exitCode = code ?? 1;
});
fixture.once("exit", (code) => {
  if (!stopping) {
    paperclip.kill("SIGTERM");
    process.exitCode = code ?? 1;
  }
});
