import { createServer, type Server } from "node:http";

export function startHealthServer(port: number, isReady: () => boolean): Server {
  const server = createServer((request, response) => {
    if (request.url !== "/health") {
      response.writeHead(404).end();
      return;
    }
    const ready = isReady();
    response.writeHead(ready ? 200 : 503, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: ready ? "ready" : "starting" }));
  });
  server.listen(port, "127.0.0.1");
  return server;
}
