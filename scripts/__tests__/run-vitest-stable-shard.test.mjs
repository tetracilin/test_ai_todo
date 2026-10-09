import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  defaultSuiteWeight,
  loadShardDurations,
  partitionGeneralServerSuites,
} from "../general-server-shard.mjs";
import {
  createRunTracker,
  formatSummary,
  normalizeExitStatus,
} from "../vitest-run-summary.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = path.join(repoRoot, "scripts", "run-vitest-stable.mjs");
const durationsManifest = path.join(repoRoot, "scripts", "general-server-shard-durations.json");
const serializedDurationsManifest = path.join(
  repoRoot,
  "scripts",
  "serialized-shard-durations.json",
);

function dryRun(args) {
  const result = spawnSync(process.execPath, [script, ...args, "--dry-run"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return result;
}

function dryRunJson(args) {
  const result = dryRun(args);
  assert.equal(result.status, 0, `expected success for ${args.join(" ")}: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

const SHARD_COUNT = 5;
const SERIALIZED_SHARD_COUNT = 5;


test("the serialized shards form a complete, non-overlapping partition", () => {
  const shards = Array.from({ length: SERIALIZED_SHARD_COUNT }, (_, index) =>
    dryRunJson(["--mode", "serialized", "--shard-index", String(index), "--shard-count", String(SERIALIZED_SHARD_COUNT)]),
  );

  const total = shards[0].serializedSuiteCount;
  const selected = shards.flatMap((shard) => shard.selectedSerializedSuites);
  assert.equal(selected.length, total, "every serialized suite must be selected exactly once");
  assert.equal(new Set(selected).size, total, "serialized shards must not overlap");
});

test("the general-server shards form a complete, non-overlapping partition", () => {
  const shards = Array.from({ length: SHARD_COUNT }, (_, index) =>
    dryRunJson(["--mode", "general", "--group", "general-server", "--shard-index", String(index), "--shard-count", String(SHARD_COUNT)]),
  );

  const total = shards[0].generalServerSuiteCount;
  assert.ok(total > 0, "expected a non-empty general-server suite set");

  const seen = new Set();
  let selectedTotal = 0;
  for (const shard of shards) {
    assert.equal(shard.generalServerSuiteCount, total, "suite count must be stable across shards");
    for (const file of shard.selectedGeneralServerSuites) {
      assert.ok(!seen.has(file), `suite assigned to more than one shard: ${file}`);
      seen.add(file);
      selectedTotal += 1;
    }
  }

  // Every suite runs exactly once: union covers the whole set with no overlap.
  assert.equal(selectedTotal, total, "every suite must be selected exactly once");
  assert.equal(seen.size, total, "union of shards must cover the whole suite set");
});

test("a route/authz suite never leaks into the general-server shards", () => {
  const shard = dryRunJson(["--mode", "general", "--group", "general-server", "--shard-index", "0", "--shard-count", SHARD_COUNT.toString()]);
  for (const file of shard.selectedGeneralServerSuites) {
    assert.ok(
      !/[^/]*(?:route|routes|authz)[^/]*\.test\.ts$/.test(file),
      `route/authz suite must stay in the serialized lane, not general-server: ${file}`,
    );
  }
});

test("shard flags are rejected for the workspaces-b group", () => {
  const result = dryRun(["--mode", "general", "--group", "general-workspaces-b", "--shard-index", "0", "--shard-count", "3"]);
  assert.notEqual(result.status, 0, "workspaces-b must not accept shard flags");
});

test("workspaces-a shards map to Vitest native --shard slices over a stable project list", () => {
  const shards = [0, 1].map((index) =>
    dryRunJson([
      "--mode", "general", "--group", "general-workspaces-a",
      "--shard-index", String(index), "--shard-count", "2",
    ]),
  );

  assert.deepEqual(
    shards.map((shard) => shard.workspacesVitestShard),
    ["1/2", "2/2"],
    "each matrix job must pass its own --shard slice to vitest",
  );
  // Vitest's --shard partitions each project's file list deterministically, so
  // an identical project list across jobs is what guarantees complete,
  // non-overlapping coverage of the lane.
  assert.deepEqual(shards[0].workspaceProjects, shards[1].workspaceProjects);
  assert.ok(shards[0].workspaceProjects.length > 0, "workspaces-a must run at least one project");

  const unsharded = dryRunJson(["--mode", "general", "--group", "general-workspaces-a"]);
  assert.deepEqual(
    unsharded.workspaceProjects,
    shards[0].workspaceProjects,
    "sharding must not change which projects the lane covers",
  );
  assert.equal(unsharded.workspacesVitestShard, null);
});

test("duration-aware partition balances skewed weights better than round-robin", () => {
  // Round-robin puts all three heavy suites on shard 0 (indexes 0, 3, 6).
  const files = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
  const durations = { a: 30000, d: 30000, g: 30000, b: 100, c: 100, e: 100, f: 100, h: 100, i: 100 };

  const shards = partitionGeneralServerSuites(files, 3, durations);
  const totals = shards.map((shard) => shard.totalWeight);
  const maxTotal = Math.max(...totals);
  const minTotal = Math.min(...totals);
  assert.ok(
    maxTotal - minTotal <= 200,
    `expected near-even shard weights, got ${totals.join(", ")}`,
  );
  assert.equal(
    shards.flatMap((shard) => shard.files).sort().join(","),
    files.join(","),
    "partition must cover every file exactly once",
  );
});

test("the partition is deterministic for identical inputs", () => {
  const files = Array.from({ length: 50 }, (_, index) => `suite-${index}.test.ts`);
  const durations = Object.fromEntries(files.map((file, index) => [file, (index * 37) % 5000]));

  const first = partitionGeneralServerSuites(files, 3, durations);
  const second = partitionGeneralServerSuites(files, 3, durations);
  assert.deepEqual(first, second, "same inputs must always produce the same partition");
});

test("suites missing from the manifest get the median weight", () => {
  assert.equal(defaultSuiteWeight({ a: 100, b: 300, c: 900 }), 300);
  assert.equal(defaultSuiteWeight({ a: 100, b: 300, c: 500, d: 900 }), 400);
  assert.equal(defaultSuiteWeight({}), 1000, "empty manifest falls back to a fixed weight");
});

test("a missing or malformed manifest degrades to uniform weights", () => {
  assert.deepEqual(loadShardDurations(path.join(repoRoot, "scripts", "no-such-manifest.json")), {});

  const files = ["a", "b", "c", "d"];
  const shards = partitionGeneralServerSuites(files, 2, {});
  assert.equal(shards[0].files.length + shards[1].files.length, files.length);
  assert.equal(Math.abs(shards[0].files.length - shards[1].files.length), 0);
});

test("the checked-in manifest loads and covers most of the current suite set", () => {
  const durations = loadShardDurations(durationsManifest);
  assert.ok(Object.keys(durations).length > 0, "manifest must parse to a non-empty duration map");

  const shard = dryRunJson(["--mode", "general", "--group", "general-server", "--shard-index", "0", "--shard-count", "1"]);
  const currentFiles = shard.selectedGeneralServerSuites;
  const known = currentFiles.filter((file) => durations[file] !== undefined).length;
  assert.ok(
    known / currentFiles.length >= 0.5,
    `manifest is stale: only ${known} of ${currentFiles.length} suites have recorded durations — regenerate it from a recent PR run (see the manifest's $comment)`,
  );
});

test("the checked-in serialized manifest loads and covers most of the current suite set", () => {
  const durations = loadShardDurations(serializedDurationsManifest);
  assert.ok(Object.keys(durations).length > 0, "manifest must parse to a non-empty duration map");

  const shard = dryRunJson(["--mode", "serialized", "--shard-index", "0", "--shard-count", "1"]);
  const currentFiles = shard.selectedSerializedSuites;
  const known = currentFiles.filter((file) => durations[file] !== undefined).length;
  assert.ok(
    known / currentFiles.length >= 0.5,
    `manifest is stale: only ${known} of ${currentFiles.length} suites have recorded durations — regenerate it from a recent PR run (see the manifest's $comment)`,
  );
});

test("the real serialized shard partition is duration-balanced", () => {
  const durations = loadShardDurations(serializedDurationsManifest);
  const fallback = defaultSuiteWeight(durations);
  const shards = Array.from({ length: SERIALIZED_SHARD_COUNT }, (_, index) =>
    dryRunJson(["--mode", "serialized", "--shard-index", String(index), "--shard-count", String(SERIALIZED_SHARD_COUNT)]),
  );

  const totals = shards.map((shard) =>
    shard.selectedSerializedSuites.reduce((sum, file) => sum + (durations[file] ?? fallback), 0),
  );
  const maxTotal = Math.max(...totals);
  const minTotal = Math.min(...totals);
  // LPT keeps the spread within the heaviest single suite; use that as the bound.
  const heaviest = Math.max(...Object.values(durations));
  assert.ok(
    maxTotal - minTotal <= heaviest,
    `serialized shard weight spread ${maxTotal - minTotal}ms exceeds heaviest suite ${heaviest}ms: ${totals.join(", ")}`,
  );
});

test("the real shard partition is duration-balanced", () => {
  const durations = loadShardDurations(durationsManifest);
  const fallback = defaultSuiteWeight(durations);
  const shards = Array.from({ length: SHARD_COUNT }, (_, index) =>
    dryRunJson(["--mode", "general", "--group", "general-server", "--shard-index", String(index), "--shard-count", String(SHARD_COUNT)]),
  );

  const totals = shards.map((shard) =>
    shard.selectedGeneralServerSuites.reduce((sum, file) => sum + (durations[file] ?? fallback), 0),
  );
  const maxTotal = Math.max(...totals);
  const minTotal = Math.min(...totals);
  // LPT keeps the spread within the heaviest single suite; use that as the bound.
  const heaviest = Math.max(...Object.values(durations));
  assert.ok(
    maxTotal - minTotal <= heaviest,
    `shard weight spread ${maxTotal - minTotal}ms exceeds heaviest suite ${heaviest}ms: ${totals.join(", ")}`,
  );
});

test("the tracker keeps every result and reports only the failures", () => {
  const tracker = createRunTracker();
  tracker.record("a", 0, 1000);
  tracker.record("b", 1, 2500);
  tracker.record("c", 0, 10);
  tracker.record("d", 130, 4000);
  assert.equal(tracker.results.length, 4);
  assert.deepEqual(
    tracker.failures().map((result) => result.label),
    ["b", "d"],
  );
});

test("the summary lists every failed invocation with its exit code", () => {
  const text = formatSummary([
    { label: "ok-one", status: 0, durationMs: 1000 },
    { label: "server/src/__tests__/x-routes.test.ts", status: 1, durationMs: 6500 },
  ]);
  assert.match(text, /1 passed, 1 failed, 2 invocations/);
  assert.match(text, /FAIL \(exit 1\) server\/src\/__tests__\/x-routes\.test\.ts \[6\.5s\]/);
  assert.doesNotMatch(text, /ok-one/);
});

test("the summary of an all-green run has no failure section", () => {
  const text = formatSummary([{ label: "a", status: 0, durationMs: 5 }]);
  assert.match(text, /1 passed, 0 failed/);
  assert.doesNotMatch(text, /failed invocations/);
});

test("a signal-killed child (null status) counts as a failure", () => {
  assert.equal(normalizeExitStatus(null), 1);
  assert.equal(normalizeExitStatus(undefined), 1);
  assert.equal(normalizeExitStatus(0), 0);
  assert.equal(normalizeExitStatus(2), 2);
});

test("the runner's non-server project list is exactly vitest.config.ts minus server", () => {
  const result = spawnSync(process.execPath, [script, "--mode", "general", "--dry-run"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const { nonServerProjects } = JSON.parse(result.stdout);

  const configText = readFileSync(path.join(repoRoot, "vitest.config.ts"), "utf8");
  const block = /projects\s*:\s*\[([^\]]*)\]/.exec(configText);
  assert.ok(block, "vitest.config.ts must declare a projects list");
  const names = [...block[1].matchAll(/"([^"]+)"/g)].map(
    (match) => JSON.parse(readFileSync(path.join(repoRoot, match[1], "package.json"), "utf8")).name,
  );
  const configured = names.filter((name) => name !== "@paperclipai/server");
  assert.deepEqual(nonServerProjects, configured);
  assert.ok(configured.length > 0);
});

// End-to-end: a fake `pnpm` on PATH whose vitest invocations fail for chosen
// labels, so the real runner loop is exercised without running any real tests.
function runWithFakePnpm(args, failPattern) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "fake-pnpm-"));
  const bin = path.join(dir, "bin");
  mkdirSync(bin);
  const log = path.join(dir, "calls.log");
  const impl = path.join(bin, "pnpm-impl.mjs");
  writeFileSync(
    impl,
    `import { appendFileSync } from "node:fs";
     const a = process.argv.slice(2).join(" ");
     appendFileSync(${JSON.stringify(log)}, a + "\n");
     process.exit(new RegExp(${JSON.stringify(failPattern)}).test(a) ? 1 : 0);`,
  );
  const shim =
    process.platform === "win32"
      ? [["pnpm.cmd", `@echo off\r\n"${process.execPath}" "${impl}" %*\r\n`]]
      : [["pnpm", `#!/bin/sh\nexec "${process.execPath}" "${impl}" "$@"\n`]];
  for (const [name, body] of shim) {
    writeFileSync(path.join(bin, name), body, { mode: 0o755 });
  }
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
    shell: false,
  });
  const calls = (
    spawnSync(process.execPath, ["-e", `process.stdout.write(require("fs").existsSync(${JSON.stringify(log)})?require("fs").readFileSync(${JSON.stringify(log)},"utf8"):"")`], { encoding: "utf8" }).stdout
  )
    .split("\n")
    .filter(Boolean);
  return { result, calls };
}

test("a failing invocation does not stop the remaining ones, and the run exits 1", { skip: process.platform === "win32" && "runner spawns pnpm without a shell; Linux CI covers this" }, () => {
  const { result, calls } = runWithFakePnpm(
    ["--mode", "general", "--group", "general-workspaces-b"],
    "adapter-utils",
  );
  const projectCount = calls.length;
  assert.ok(projectCount > 3, `expected several invocations, got ${projectCount}`);
  assert.ok(calls.some((call) => call.includes("--project @paperclipai/db")));
  assert.ok(calls.some((call) => call.includes("--project paperclipai") || call.includes("--project @paperclipai/plugin-sdk")), "invocations after the failure must still run");
  assert.equal(result.status, 1);
  assert.match(result.stdout, /1 failed/);
  assert.match(result.stdout, /FAIL \(exit 1\) .*adapter-utils/);
});

test("--bail stops at the first failing invocation", { skip: process.platform === "win32" && "runner spawns pnpm without a shell; Linux CI covers this" }, () => {
  const { result, calls } = runWithFakePnpm(
    ["--mode", "general", "--group", "general-workspaces-b", "--bail"],
    "adapter-utils",
  );
  assert.equal(result.status, 1);
  assert.ok(calls.at(-1).includes("adapter-utils"), "the failing invocation must be the last one run");
  assert.match(result.stdout, /1 failed/);
});

test("an all-green run exits 0 and prints the summary", { skip: process.platform === "win32" && "runner spawns pnpm without a shell; Linux CI covers this" }, () => {
  const { result } = runWithFakePnpm(
    ["--mode", "general", "--group", "general-workspaces-b"],
    "^$never-matches",
  );
  assert.equal(result.status, 0);
  assert.match(result.stdout, /0 failed/);
});
