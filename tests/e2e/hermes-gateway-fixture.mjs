import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const host = "127.0.0.1";
const port = Number(process.env.PAPERCLIP_E2E_HERMES_PORT ?? 38643);
const apiKey = process.env.PAPERCLIP_E2E_HERMES_API_KEY;
if (!apiKey) throw new Error("PAPERCLIP_E2E_HERMES_API_KEY is required");
const runs = new Map();

function writeJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function authorized(req) {
  return req.headers.authorization === `Bearer ${apiKey}`;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${host}:${port}`);
  if (req.method === "GET" && url.pathname === "/api/health") {
    writeJson(res, 200, { ok: true });
    return;
  }
  if (!authorized(req)) {
    writeJson(res, 401, { error: "invalid Hermes E2E fixture key" });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/v1/runs") {
    const runId = randomUUID();
    runs.set(runId, {
      run_id: runId,
      status: "completed",
      output: "Hermes E2E fixture completed.",
    });
    writeJson(res, 200, { run_id: runId });
    return;
  }
  const match = url.pathname.match(/^\/api\/v1\/runs\/([^/]+)(?:\/(events|stop))?$/);
  if (!match) {
    writeJson(res, 404, { error: "not found" });
    return;
  }
  const run = runs.get(decodeURIComponent(match[1]));
  if (!run) {
    writeJson(res, 404, { error: "run not found" });
    return;
  }
  if (match[2] === "events" && req.method === "GET") {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(`event: run.completed\ndata: ${JSON.stringify(run)}\n\n`);
    return;
  }
  if (match[2] === "stop" && req.method === "POST") {
    run.status = "stopped";
    writeJson(res, 200, run);
    return;
  }
  if (!match[2] && req.method === "GET") {
    writeJson(res, 200, run);
    return;
  }
  writeJson(res, 405, { error: "method not allowed" });
});

server.listen(port, host, () => {
  process.stdout.write(`Hermes E2E fixture listening on ${host}:${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
