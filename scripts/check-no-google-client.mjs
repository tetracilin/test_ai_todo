#!/usr/bin/env node

// K12 blocking gate: the client must contain no Google/Firebase/Gemini code,
// copy, env wiring, or secret material. This checker runs in BLOCKING mode —
// any finding exits 1 and fails CI. It scans every tracked source file
// (excluding this control script's own test fixtures) for:
//   - Google/Firebase/Gemini identifiers and domains
//   - the legacy Firebase project id
//   - known secret shapes (Google web API keys, OAuth client ids)
//   - Vite env wiring that could inject an AI secret into the bundle

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const CHECKER_MODE = 'blocking';

const CONTROL_SCRIPT = path.relative(
  process.cwd(),
  fileURLToPath(import.meta.url),
);

// Files that legitimately mention these terms because they enforce the ban.
const CONTROL_ALLOWLIST = new Set([
  CONTROL_SCRIPT,
  CONTROL_SCRIPT.replace(/\.mjs$/, '.test.mjs'),
  'scripts/scan-client-bundle.mjs',
  'docs/migration/test-ai-todo-inventory.md',
].map((p) => p.split(path.sep).join('/')));

// References to this control itself ("no-google" in gate names, script names,
// docs) are stripped before pattern matching so the gate does not flag the
// machinery that implements it.
const CONTROL_REFERENCE_PATTERN = /no[ -]?google/gi;

export const FORBIDDEN_PATTERNS = [
  { id: 'term_gemini', pattern: /gemini/i },
  { id: 'term_firebase', pattern: /firebase/i },
  { id: 'term_google', pattern: /google/i },
  { id: 'domain_generativelanguage', pattern: /generativelanguage\.googleapis\.com/i },
  { id: 'domain_firebaseio', pattern: /firebaseio\.com/i },
  { id: 'secret_web_api_key', pattern: /AIza[0-9A-Za-z_-]{35}/ },
  { id: 'secret_oauth_client_id', pattern: /[0-9]+-[0-9a-z_]{32}\.apps\.googleusercontent\.com/i },
  { id: 'env_ai_secret_injection', pattern: /process\.env\.(API_KEY|GEMINI_API_KEY)/ },
];

export function classifyPath(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  if (CONTROL_ALLOWLIST.has(normalized)) return 'control';
  if (normalized.startsWith('dist/')) return 'build-output';
  if (/^(package-lock\.json|CHANGELOG\.md|doc\(|doc\/)/.test(normalized)) return 'historical';
  if (normalized === '.claude/design-doc-t8.md') return 'historical';
  return 'source';
}

export function scanFile(relativePath, content) {
  const classification = classifyPath(relativePath);
  if (classification !== 'source') return [];
  const findings = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    const scrubbed = line.replace(CONTROL_REFERENCE_PATTERN, '');
    for (const { id, pattern } of FORBIDDEN_PATTERNS) {
      if (pattern.test(scrubbed)) {
        findings.push({ file: relativePath, line: index + 1, patternId: id });
      }
    }
  });
  return findings;
}

export function trackedSourceFiles(repoRoot) {
  const result = spawnSync('git', ['ls-files', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`git ls-files failed: ${(result.stderr || '').trim() || `exit ${result.status}`}`);
  }
  // Include staged-but-not-yet-committed paths implicitly via ls-files (index),
  // plus untracked non-ignored files so newly added sources are covered.
  const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const tracked = result.status === 0 ? result.stdout.split('\0').filter(Boolean) : [];
  const others = untracked.status === 0 ? untracked.stdout.split('\0').filter(Boolean) : [];
  return [...new Set([...tracked, ...others])];
}

function main() {
  const repoRoot = process.cwd();
  let files;
  try {
    files = trackedSourceFiles(repoRoot);
  } catch (error) {
    console.error(`check-no-google-client: ${error.message}`);
    process.exit(2);
  }

  const findings = [];
  for (const file of files) {
    if (classifyPath(file) !== 'source') continue;
    let content;
    try {
      content = readFileSync(path.join(repoRoot, file), 'utf8');
    } catch {
      continue;
    }
    findings.push(...scanFile(file, content));
  }

  console.log(`check-no-google-client: mode=${CHECKER_MODE}, files_scanned=${files.length}`);

  if (findings.length > 0) {
    console.error('check-no-google-client: BLOCKING — Google/Firebase/Gemini references found:');
    const byFile = new Map();
    for (const f of findings) {
      if (!byFile.has(f.file)) byFile.set(f.file, []);
      byFile.get(f.file).push(`${f.line}:${f.patternId}`);
    }
    for (const [file, hits] of [...byFile.entries()].sort()) {
      console.error(`  ${file}`);
      for (const h of hits.slice(0, 10)) {
        console.error(`    ${h}`);
      }
      if (hits.length > 10) console.error(`    ... and ${hits.length - 10} more`);
    }
    console.error(`Total findings: ${findings.length}. The client must not reference Google/Firebase/Gemini.`);
    process.exit(1);
  }

  console.log('check-no-google-client: PASS — 0 findings.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
