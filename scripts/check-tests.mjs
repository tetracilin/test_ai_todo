#!/usr/bin/env node
// Lightweight PR test-population guard (T-54 §7 / T-55). Fails a PR that
// changes source files in a watched subtree without also changing a test
// file in that same subtree. Intentionally simple: subtree matching, no
// coverage thresholds. Exempt with `[skip-test-check]` + a reason in the PR
// description.
import { execSync } from 'node:child_process';

const SKIP_MARKER = '[skip-test-check]';
const TEST_PATTERN = /\.(test|spec)\.[jt]sx?$/;

// { sourcePrefixes: dirs whose non-test changes require a matching test change,
//   testPrefixes: dirs where that matching test change may land }
const GROUPS = [
  { name: 'components', sourcePrefixes: ['components/'], testPrefixes: ['components/', 'e2e/'] },
  { name: 'hooks', sourcePrefixes: ['hooks/'], testPrefixes: ['hooks/'] },
  { name: 'services', sourcePrefixes: ['services/'], testPrefixes: ['services/'] },
  { name: 'context', sourcePrefixes: ['context/'], testPrefixes: ['context/'] },
  {
    name: 'app shell (root)',
    sourcePrefixes: ['App.tsx', 'ItemDetail.tsx', 'server.cjs', 'index.tsx'],
    testPrefixes: ['integration/', 'e2e/'],
  },
  { name: 'discord-bridge', sourcePrefixes: ['discord-bridge/src/'], testPrefixes: ['discord-bridge/src/'] },
];

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

function resolveBaseRef() {
  const envBase = process.env.BASE_SHA?.trim();
  if (envBase) return envBase;
  try {
    sh('git rev-parse --verify origin/main');
    return 'origin/main';
  } catch {
    try {
      return sh('git rev-parse HEAD~1');
    } catch {
      return null;
    }
  }
}

function matchesAny(file, prefixes) {
  return prefixes.some((p) => (p.endsWith('/') ? file.startsWith(p) : file === p));
}

const prBody = process.env.PR_BODY || '';
if (prBody.includes(SKIP_MARKER)) {
  console.log(`check-tests: ${SKIP_MARKER} found in PR description — skipping guard.`);
  process.exit(0);
}

const baseRef = resolveBaseRef();
if (!baseRef) {
  console.log('check-tests: no base ref to diff against (shallow history, no origin/main) — skipping.');
  process.exit(0);
}

let changedFiles;
try {
  changedFiles = sh(`git diff --name-only ${baseRef}...HEAD`)
    .split('\n')
    .filter(Boolean);
} catch (err) {
  console.log(`check-tests: could not diff against ${baseRef} (${err.message}) — skipping.`);
  process.exit(0);
}

if (changedFiles.length === 0) {
  console.log('check-tests: no changed files — nothing to check.');
  process.exit(0);
}

const failures = [];
for (const group of GROUPS) {
  const changedSource = changedFiles.filter(
    (f) => matchesAny(f, group.sourcePrefixes) && !TEST_PATTERN.test(f),
  );
  if (changedSource.length === 0) continue;

  const hasTestChange = changedFiles.some(
    (f) => matchesAny(f, group.testPrefixes) && TEST_PATTERN.test(f),
  );
  if (!hasTestChange) {
    failures.push({ group: group.name, files: changedSource });
  }
}

if (failures.length > 0) {
  console.error('check-tests: source changes with no matching test change:\n');
  for (const f of failures) {
    console.error(`  [${f.group}]`);
    for (const file of f.files) console.error(`    - ${file}`);
  }
  console.error(
    `\nAdd or update a test in the same subtree, or add "${SKIP_MARKER} <reason>" to the PR description if this change genuinely has no testable surface.`,
  );
  process.exit(1);
}

console.log('check-tests: all changed source subtrees have a matching test change.');
