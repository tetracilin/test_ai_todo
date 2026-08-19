import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http, { type Server } from 'http';
import request from 'supertest';

// supertest/superagent normalize `..` segments out of the URL per the WHATWG
// URL spec before the request is ever sent, which would silently no-op the
// traversal-guard test below. Node's raw http.request keeps the literal path.
function rawGet(server: Server, requestPath: string): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const address = server.address();
    if (address === null || typeof address === 'string') {
      reject(new Error('server is not listening on a port'));
      return;
    }
    const req = http.request(
      { host: '127.0.0.1', port: address.port, path: requestPath, method: 'GET' },
      (res) => {
        res.resume();
        resolve({ status: res.statusCode ?? 0 });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

// server.cjs is a CommonJS module; require() it directly so createServer()
// stays a single source of truth shared with the real `node server.cjs` entrypoint.
const { createServer } = require('../server.cjs');

describe('server.cjs', () => {
  let distDir: string;
  let server: Server;

  beforeAll(async () => {
    distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-test-dist-'));
    fs.writeFileSync(path.join(distDir, 'index.html'), '<html><body>Gemini Task Manager</body></html>');
    fs.mkdirSync(path.join(distDir, 'assets'));
    fs.writeFileSync(path.join(distDir, 'assets', 'app.js'), 'console.log("app");');
    server = createServer({ distDir });
    await new Promise<void>((resolve) => server.listen(0, resolve));
  });

  afterAll(() => {
    server.close();
    fs.rmSync(distDir, { recursive: true, force: true });
  });

  it('GET /api/health returns 200 with app status JSON', async () => {
    const res = await request(server).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body.status).toBe('ok');
    expect(res.body.app).toBe('gemini-task-manager');
  });

  it('unknown /api/* route returns 404 JSON', async () => {
    const res = await request(server).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body).toEqual({ error: 'not found' });
  });

  it('GET / serves the built index.html', async () => {
    const res = await request(server).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('Gemini Task Manager');
  });

  it('serves a static asset with the correct mime type', async () => {
    const res = await request(server).get('/assets/app.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/javascript');
    expect(res.text).toContain('console.log');
  });

  it('falls back to index.html for a non-file SPA route (edge case: client-side routing)', async () => {
    const res = await request(server).get('/inbox/today');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('Gemini Task Manager');
  });

  it('blocks path traversal outside the dist directory', async () => {
    const res = await rawGet(server, '/../../../etc/passwd');
    expect(res.status).toBe(403);
  });
});
