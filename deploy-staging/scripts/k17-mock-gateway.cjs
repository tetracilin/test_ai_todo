// K17 QA mock Hermes gateway — stdlib only. Lets the staging container's
// hermes_gateway adapter exercise auth/429/5xx/timeout/cancel paths without
// touching the real Hermes gateway (127.0.0.1:8642) or its data.
const http = require("http");

const PORT = Number(process.env.MOCK_PORT || 8137);
const HOST = process.env.MOCK_HOST || "0.0.0.0";

let mode = process.env.MOCK_MODE || "hang"; // auth401 | ratelimit429 | server500 | hang | ok

const server = http.createServer((req, res) => {
  const url = req.url || "/";

  if (req.method === "POST" && url.startsWith("/__mode")) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const m = JSON.parse(body).mode;
        if (m) mode = m;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ mode }));
      } catch {
        res.writeHead(400);
        res.end('{"error":"bad mode"}');
      }
    });
    return;
  }

  if (url.startsWith("/health")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", platform: "hermes-agent-mock", version: "0.0.0-k17" }));
    return;
  }

  // everything else is treated as the run-create endpoint
  if (mode === "auth401") {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "invalid api key" }));
    return;
  }
  if (mode === "ratelimit429") {
    res.writeHead(429, { "content-type": "application/json", "retry-after": "60" });
    res.end(JSON.stringify({ error: "rate limited" }));
    return;
  }
  if (mode === "server500") {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "mock upstream boom" }));
    return;
  }
  if (mode === "hang") {
    // never respond; adapter timeout / cancel must take over
    return;
  }
  // ok: immediate success
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ run_id: "mock-run-" + Date.now(), status: "completed" }));
});

server.listen(PORT, HOST, () => {
  console.log("K17_MOCK_UP host=" + HOST + " port=" + PORT + " mode=" + mode);
});
