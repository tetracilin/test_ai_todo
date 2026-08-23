import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHECKER_MODE, classifyPath, scanFile, FORBIDDEN_PATTERNS } from './check-no-google-client.mjs';

test('checker runs in blocking mode', () => {
  assert.equal(CHECKER_MODE, 'blocking');
});

test('control files are classified as control and never scanned', () => {
  assert.equal(classifyPath('scripts/check-no-google-client.mjs'), 'control');
  assert.equal(classifyPath('scripts/check-no-google-client.test.mjs'), 'control');
});

test('build output, lockfiles and historical docs are out of scope', () => {
  assert.equal(classifyPath('dist/assets/index.js'), 'build-output');
  assert.equal(classifyPath('package-lock.json'), 'historical');
  assert.equal(classifyPath('.claude/design-doc-t8.md'), 'historical');
});

test('clean source produces zero findings', () => {
  const findings = scanFile(
    'src/app.ts',
    'import { orchestrateTask } from "../services/aiService";\nexport default {};\n',
  );
  assert.deepEqual(findings, []);
});

test('deliberately reverted file (regression proof): every forbidden class is caught', () => {
  const regressed = [
    'import { initializeApp } from "firebase/app";',
    'const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });',
    'authDomain: "legacy-project.firebaseapp.com",',
    '// model: gemini-2.5-flash',
    'const key = "AIza0123456789abcdefghijklmnopqrstuvwxyz123";',
    '<div className="..."><GoogleIcon /></div>',
    'fetch("https://generativelanguage.googleapis.com/v1beta/models");',
  ].join('\n');

  const findings = scanFile('src/regression-fixture.ts', regressed);
  const ids = new Set(findings.map((f) => f.patternId));
  for (const expected of ['term_firebase', 'env_ai_secret_injection', 'term_google', 'term_gemini', 'secret_web_api_key', 'domain_generativelanguage']) {
    assert.ok(ids.has(expected), `expected pattern ${expected} to be detected`);
  }
  assert.equal(findings.every((f) => f.file === 'src/regression-fixture.ts'), true);
  assert.ok(findings.length >= 7);
});

test('every forbidden pattern matches at least one hostile sample', () => {
  const samples = {
    term_gemini: 'call gemini now',
    term_firebase: 'use firebase sdk',
    term_google: 'google it',
    domain_generativelanguage: 'https://generativelanguage.googleapis.com/x',
    domain_firebaseio: 'https://x.firebaseio.com/y',
    secret_web_api_key: 'AIza0123456789abcdefghijklmnopqrstuvwxyz123',
    secret_oauth_client_id: '123456789-abcdefghijklmnopqrstuvwxyz123456.apps.googleusercontent.com',
    env_ai_secret_injection: 'const k = process.env.API_KEY;',
  };
  for (const { id, pattern } of FORBIDDEN_PATTERNS) {
    assert.ok(pattern.test(samples[id]), `pattern ${id} should match its sample`);
  }
});
