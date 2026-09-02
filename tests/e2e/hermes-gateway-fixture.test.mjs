import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";

const port = 38642;
const baseUrl = `http://127.0.0.1:${port}`;
const apiKey = `test-hermes-${randomUUID()}`;

test("Hermes E2E fixture completes a deterministic gateway run", async (t) => {
  const child = spawn(process.execPath, ["tests/e2e/hermes-gateway-fixture.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, PAPERCLIP_E2E_HERMES_PORT: String(port), PAPERCLIP_E2E_HERMES_API_KEY: apiKey },
    stdio: "ignore",
  });
  t.after(async () => {
    if (child.exitCode === null) child.kill("SIGTERM");
    await once(child, "exit").catch(() => undefined);
  });

  let health = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        health = await response.json();
        break;
      }
    } catch {
      // Fixture is still binding its loopback port.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.deepEqual(health, { ok: true });

  const created = await fetch(`${baseUrl}/api/v1/runs`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ input: "fixture run" }),
  });
  assert.equal(created.status, 200);
  const { run_id: runId } = await created.json();
  assert.equal(typeof runId, "string");

  const events = await fetch(`${baseUrl}/api/v1/runs/${runId}/events`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  assert.equal(events.status, 200);
  assert.match(await events.text(), /event: run\.completed/);

  const completed = await fetch(`${baseUrl}/api/v1/runs/${runId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  assert.equal(completed.status, 200);
  assert.deepEqual(await completed.json(), {
    run_id: runId,
    status: "completed",
    output: "Hermes E2E fixture completed.",
  });

  const stopped = await fetch(`${baseUrl}/api/v1/runs/${runId}/stop`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  assert.equal(stopped.status, 200);
  assert.equal((await stopped.json()).status, "stopped");
});
