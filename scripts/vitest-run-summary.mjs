// Result tracking for scripts/run-vitest-stable.mjs.
//
// The runner issues one vitest invocation per project / serialized suite. It used
// to exit on the first red one, so a nightly with N failures surfaced exactly one
// per night and never reached the invocations after it. The tracker lets the
// runner keep going, then report every invocation and fail once at the end.

export function createRunTracker() {
  const results = [];
  return {
    record(label, status, durationMs) {
      results.push({ label, status, durationMs });
    },
    results,
    failures() {
      return results.filter((result) => result.status !== 0);
    },
  };
}

function formatDuration(durationMs) {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

export function formatSummary(results) {
  const failed = results.filter((result) => result.status !== 0);
  const lines = [
    "",
    `[test:run] summary: ${results.length - failed.length} passed, ${failed.length} failed, ${results.length} invocations`,
  ];
  if (failed.length === 0) {
    return lines.join("\n");
  }
  lines.push("[test:run] failed invocations:");
  for (const result of failed) {
    lines.push(`  FAIL (exit ${result.status}) ${result.label} [${formatDuration(result.durationMs)}]`);
  }
  return lines.join("\n");
}

// A killed child (signal, OOM) reports a null status; treat it as a failure.
export function normalizeExitStatus(status) {
  return typeof status === "number" ? status : 1;
}
