#!/usr/bin/env node

// Scans the built client bundle (dist/) for forbidden Google/Firebase/Gemini
// identifiers, project ids, domains, and secret-shaped strings. Exits 1 on any
// hit. Run after `vite build`.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export const BUNDLE_SCAN_PATTERNS = [
  { id: 'gemini_api_key_env', pattern: /GEMINI_API_KEY/g },
  { id: 'google_genai_pkg', pattern: /@google\/genai/gi },
  { id: 'firebase_sdk', pattern: /firebase/gi },
  { id: 'generativelanguage', pattern: /generativelanguage\.googleapis\.com/gi },
  { id: 'firebaseio_domain', pattern: /firebaseio\.com/gi },
  { id: 'firebasestorage_domain', pattern: /firebasestorage\.app/gi },
  { id: 'firebaseapp_domain', pattern: /firebaseapp\.com/gi },
  { id: 'gstatic_domain', pattern: /gstatic\.com/gi },
  { id: 'web_api_key_shape', pattern: /AIza[0-9A-Za-z_-]{35}/g },
  { id: 'oauth_client_shape', pattern: /[0-9]+-[0-9a-z_]{32}\.apps\.googleusercontent\.com/gi },
];

const TEXT_EXTENSIONS = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt', '.map']);

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listFiles(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

export function scanText(text) {
  const hits = [];
  for (const { id, pattern } of BUNDLE_SCAN_PATTERNS) {
    const matches = text.match(pattern);
    if (matches && matches.length > 0) {
      hits.push({ patternId: id, count: matches.length });
    }
  }
  return hits;
}

export function scanDist(distDir) {
  const findings = [];
  for (const file of listFiles(distDir)) {
    if (!TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const hit of scanText(text)) {
      findings.push({ file: path.relative(distDir, file), ...hit });
    }
  }
  return findings;
}

function main() {
  const distDir = path.resolve(process.argv[2] || 'dist');
  let files = [];
  try {
    files = listFiles(distDir);
  } catch {
    console.error(`scan-client-bundle: cannot read dist directory "${distDir}". Build first.`);
    process.exit(2);
  }
  const findings = scanDist(distDir);
  if (findings.length > 0) {
    console.error('scan-client-bundle: FORBIDDEN CONTENT FOUND in client bundle:');
    for (const f of findings) {
      console.error(`  ${f.file}: ${f.patternId} x${f.count}`);
    }
    process.exit(1);
  }
  console.log(`scan-client-bundle: clean — 0 hits across ${files.length} files in ${path.basename(distDir)}/`);
}

// Only run main when executed directly (tests import the helpers).
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.url.replace('file://', '')) {
  main();
}
