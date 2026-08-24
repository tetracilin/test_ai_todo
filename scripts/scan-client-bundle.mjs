#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

export const BUNDLE_SCAN_PATTERNS = [
  { id: "legacy_adapter_id", pattern: /gemini_local/gi },
  { id: "legacy_cli_package", pattern: /@google\/gemini-cli/gi },
  { id: "legacy_client_sdk", pattern: /@google\/genai|firebase\//gi },
  { id: "legacy_ai_env", pattern: /\b(?:GEMINI_API_KEY|GOOGLE_API_KEY)\b/gi },
  { id: "legacy_model_endpoint", pattern: /generativelanguage\.googleapis\.com/gi },
  { id: "legacy_data_endpoint", pattern: /(?:firebaseio\.com|firebasestorage\.(?:app|googleapis\.com)|firebaseapp\.com)/gi },
  { id: "legacy_app_slug", pattern: /\b(?:google-sheets|google-gemini)\b/gi },
  { id: "legacy_app_env", pattern: /\bGOOGLE_SHEETS_[A-Z0-9_]+\b/gi },
  { id: "web_api_key_shape", pattern: /AIza[0-9A-Za-z_-]{35}/g },
  { id: "oauth_client_shape", pattern: /[0-9]+-[0-9a-z_]{32}\.apps\.googleusercontent\.com/gi },
];

const TEXT_EXTENSIONS = new Set([".html", ".js", ".css", ".json", ".svg", ".txt", ".map"]);

function listFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    if (statSync(fullPath).isDirectory()) files.push(...listFiles(fullPath));
    else files.push(fullPath);
  }
  return files;
}

export function scanText(text) {
  const hits = [];
  for (const { id, pattern } of BUNDLE_SCAN_PATTERNS) {
    pattern.lastIndex = 0;
    const matches = text.match(pattern);
    if (matches?.length) hits.push({ patternId: id, count: matches.length });
  }
  return hits;
}

export function scanDist(distDir) {
  const findings = [];
  for (const file of listFiles(distDir)) {
    if (!TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const hit of scanText(text)) {
      findings.push({ file: path.relative(distDir, file), ...hit });
    }
  }
  return findings;
}

export function runBundleScan(distDir) {
  let files;
  try {
    files = listFiles(distDir);
  } catch {
    return { exitCode: 2, files: 0, findings: [], error: `cannot read dist directory "${distDir}"` };
  }
  const findings = scanDist(distDir);
  return { exitCode: findings.length === 0 ? 0 : 1, files: files.length, findings, error: null };
}

function main() {
  const distDir = path.resolve(process.argv[2] || "ui/dist");
  const result = runBundleScan(distDir);
  if (result.error) {
    console.error(`scan-client-bundle: ${result.error}. Build first.`);
    process.exit(result.exitCode);
  }
  if (result.findings.length > 0) {
    console.error("scan-client-bundle: FORBIDDEN CONTENT FOUND:");
    for (const finding of result.findings) {
      console.error(`  ${finding.file}: ${finding.patternId} x${finding.count}`);
    }
    process.exit(1);
  }
  console.log(`scan-client-bundle: clean — 0 hits across ${result.files} files in ${path.relative(process.cwd(), distDir)}/`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main();
}
