// Suite filter for scripts/run-vitest-stable.mjs.
//
// --only-suite <file> runs just those serialized suites (a dedicated CI job for one
// slow or flaky suite). --skip-suite <file> leaves them out of the run (the main job,
// once that suite has its own job). Both only change which serialized suites are
// RUN. The runner still excludes them from the general-server lane, so a skipped
// suite is never picked up there by accident.

export function applySuiteFilter(suites, { only = [], skip = [] } = {}, key = (suite) => suite) {
  if (only.length > 0 && skip.length > 0) {
    throw new Error("--only-suite and --skip-suite cannot combine");
  }
  if (only.length > 0) {
    const keep = new Set(only);
    return suites.filter((suite) => keep.has(key(suite)));
  }
  if (skip.length > 0) {
    const drop = new Set(skip);
    return suites.filter((suite) => !drop.has(key(suite)));
  }
  return suites;
}

// A typo must not turn into "run nothing and pass", so every named suite has to be a
// real serialized suite. Returns one message per unknown name.
export function validateSuiteFilter(knownSuites, { only = [], skip = [] } = {}) {
  const known = new Set(knownSuites);
  return [...only, ...skip]
    .filter((name) => !known.has(name))
    .map((name) => `unknown serialized suite: ${name}`);
}
