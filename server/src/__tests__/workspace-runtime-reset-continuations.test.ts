/**
 * Regression coverage for the slow-tests flake in issue #274.
 *
 * `resetRuntimeServicesForTests` used to clear the in-memory runtime state while
 * three kinds of continuation could still be running:
 *
 *  - a runtime provision queued in `runtimeProvisionByWorkspace`,
 *  - a workspace-control start queued in `runtimeControlStartByOwner`,
 *  - the teardown write scheduled by a child process's `exit` handler.
 *
 * Any of them could persist a `workspace_runtime_services` row after the test
 * suite deleted the parent company, which surfaced as a foreign-key violation
 * in a later test (`workspace_runtime_services_company_id_companies_id_fk`).
 *
 * These tests gate each continuation, call the reset, and prove the reset does
 * not return until that continuation has finished its write.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@paperclipai/db";

import type { BrokerClient } from "../services/runtime-exposure/broker-client.js";
import {
  resetRuntimeServicesForTests,
  setWorkspaceRuntimeExposureDepsForTests,
  startRuntimeServicesForWorkspaceControl,
  type WorkspaceRuntimeExposureDeps,
} from "../services/workspace-runtime.js";

const DECLARED_EXPOSE = {
  type: "tailscale_https",
  hostname: "auto",
  publicPort: "same",
  includePaperclipViteHmr: true,
  failurePolicy: "fail_closed",
} as const;

type Deferred = { promise: Promise<void>; resolve: () => void };

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function createFakeBroker(): BrokerClient {
  return {
    async reserve(runtimeId, requested) {
      return {
        handle: `handle-${runtimeId}`,
        reservedPorts: requested.map((listener) => listener.port),
      };
    },
    async expose(_runtimeId, handle) {
      return { handle, publicPorts: [] };
    },
    async remove() {
      return { removedPorts: [] };
    },
    async list() {
      return [];
    },
  };
}

function installDeps(overrides: Partial<WorkspaceRuntimeExposureDeps> = {}) {
  setWorkspaceRuntimeExposureDepsForTests({
    broker: createFakeBroker(),
    isPortAvailable: async () => false,
    isBrokerAvailable: async () => true,
    resolveHostname: async () => "runner.tail123.ts.net",
    probeHealth: async () => true,
    now: () => new Date().toISOString(),
    diagnoseListenerBinds: async () => null,
    ...overrides,
  });
}

/**
 * A minimal Drizzle stand-in. The start path only reads via one `select` chain
 * (no stopped reuse candidate exists) and writes via one `insert` chain, so this
 * is enough to observe and gate `persistRuntimeServiceRecord` calls.
 */
function createGatedDb(gateAt: number) {
  const inserts: Array<Record<string, unknown>> = [];
  const reached = new Map<number, Deferred>();
  const gates = new Map<number, Deferred>();
  const at = (map: Map<number, Deferred>, index: number) => {
    let entry = map.get(index);
    if (!entry) {
      entry = deferred();
      map.set(index, entry);
    }
    return entry;
  };

  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => [],
          }),
        }),
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: async () => {
          const index = inserts.length + 1;
          inserts.push(values);
          at(reached, index).resolve();
          if (index === gateAt) await at(gates, index).promise;
        },
      }),
    }),
  } as unknown as Db;

  return {
    db,
    inserts,
    waitForInsert: (index: number) => at(reached, index).promise,
    releaseInsert: (index: number) => at(gates, index).resolve(),
  };
}

async function waitFor<T>(promise: Promise<T>, label: string): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`${label} timed out`)), 10_000).unref?.();
  });
  return await Promise.race([promise, timeout]);
}

async function waitForFile(filePath: string, label: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      await fs.stat(filePath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`${label} timed out`);
}

function trackSettled(promise: Promise<unknown>) {
  const state = { settled: false };
  void promise.then(
    () => {
      state.settled = true;
    },
    () => {
      state.settled = true;
    },
  );
  return state;
}

describe.skipIf(process.platform === "win32")(
  "resetRuntimeServicesForTests drains runtime continuations",
  () => {
    let workspaceRoot: string;
    let paperclipHome: string;
    let previousHttpsMode: string | undefined;
    let previousPaperclipHome: string | undefined;
    let previousInstanceId: string | undefined;

    beforeEach(async () => {
      workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pap274-reset-"));
      paperclipHome = await fs.mkdtemp(path.join(os.tmpdir(), "pap274-home-"));
      previousHttpsMode = process.env.PAPERCLIP_MANAGED_RUNTIME_HTTPS;
      process.env.PAPERCLIP_MANAGED_RUNTIME_HTTPS = "off";
      previousPaperclipHome = process.env.PAPERCLIP_HOME;
      previousInstanceId = process.env.PAPERCLIP_INSTANCE_ID;
      process.env.PAPERCLIP_HOME = paperclipHome;
      process.env.PAPERCLIP_INSTANCE_ID = `pap274-${randomUUID()}`;
      installDeps();
    });

    afterEach(async () => {
      await resetRuntimeServicesForTests({ terminateProcesses: true });
      if (previousHttpsMode === undefined) delete process.env.PAPERCLIP_MANAGED_RUNTIME_HTTPS;
      else process.env.PAPERCLIP_MANAGED_RUNTIME_HTTPS = previousHttpsMode;
      if (previousPaperclipHome === undefined) delete process.env.PAPERCLIP_HOME;
      else process.env.PAPERCLIP_HOME = previousPaperclipHome;
      if (previousInstanceId === undefined) delete process.env.PAPERCLIP_INSTANCE_ID;
      else process.env.PAPERCLIP_INSTANCE_ID = previousInstanceId;
      await fs.rm(workspaceRoot, { recursive: true, force: true });
      await fs.rm(paperclipHome, { recursive: true, force: true });
    });

    function startInput(options: {
      db?: Db;
      runtimeProvisionCommand?: string;
      expose?: boolean;
    } = {}) {
      const config: Record<string, unknown> = {
        workspaceRuntime: {
          services: [{
            name: "preview",
            command: "node -e \"setInterval(() => {}, 1000)\"",
            port: { type: "auto" },
            ...(options.expose ? { expose: DECLARED_EXPOSE } : {}),
          }],
        },
      };
      if (options.runtimeProvisionCommand) {
        config.runtimeProvisionCommand = options.runtimeProvisionCommand;
      }
      return {
        invocationId: `pap-274-${randomUUID()}`,
        actor: { id: null, name: "Paperclip", companyId: randomUUID() },
        issue: null,
        db: options.db,
        workspace: {
          baseCwd: workspaceRoot,
          source: "agent_home" as const,
          projectId: null,
          workspaceId: null,
          repoUrl: null,
          repoRef: null,
          strategy: "project_primary" as const,
          cwd: workspaceRoot,
          branchName: null,
          worktreePath: null,
          warnings: [],
          created: false,
        },
        config,
        adapterEnv: {},
      };
    }

    it("waits for an in-flight runtime provision before it clears state", async () => {
      const startedPath = path.join(workspaceRoot, "provision-started");
      const gatePath = path.join(workspaceRoot, "provision-gate");
      const markerPath = path.join(workspaceRoot, "provision-finished");
      const provisionCommand =
        `: > ${startedPath}; while [ ! -f ${gatePath} ]; do sleep 0.01; done; echo provisioned > ${markerPath}`;

      const startPromise = startRuntimeServicesForWorkspaceControl(startInput({
        runtimeProvisionCommand: provisionCommand,
        expose: true,
      })).then(
        () => null,
        (error: unknown) => error,
      );
      await waitForFile(startedPath, "runtime provision");

      const resetPromise = resetRuntimeServicesForTests();
      const resetState = trackSettled(resetPromise);
      try {
        await new Promise((resolve) => setTimeout(resolve, 50));
        // The provision command is gated, so a reset that does not drain it has
        // already returned here.
        expect(resetState.settled).toBe(false);
      } finally {
        await fs.writeFile(gatePath, "");
      }

      await resetPromise;
      // The reset waited for the provision's write, so it is on disk by now.
      await expect(fs.readFile(markerPath, "utf8")).resolves.toBe("provisioned\n");
      // The start itself fails after the provision (no free exposure pair).
      await expect(startPromise).resolves.toBeInstanceOf(Error);
    });

    it("waits for an in-flight workspace-control start before it clears state", async () => {
      const portProbeReached = deferred();
      const portProbeGate = deferred();
      installDeps({
        isPortAvailable: async () => {
          portProbeReached.resolve();
          await portProbeGate.promise;
          return false;
        },
      });

      const startPromise = startRuntimeServicesForWorkspaceControl(startInput({ expose: true })).then(
        () => null,
        (error: unknown) => error,
      );
      await waitFor(portProbeReached.promise, "port probe");

      const resetPromise = resetRuntimeServicesForTests();
      const resetState = trackSettled(resetPromise);
      try {
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(resetState.settled).toBe(false);
      } finally {
        portProbeGate.resolve();
      }

      await resetPromise;
      await expect(startPromise).resolves.toBeInstanceOf(Error);
      expect(resetState.settled).toBe(true);
    });

    it("waits for the child-exit stop continuation before it clears state", async () => {
      const gatedDb = createGatedDb(2);
      const [service] = await startRuntimeServicesForWorkspaceControl(startInput({ db: gatedDb.db }));
      // The start persists the running row itself.
      expect(gatedDb.inserts).toHaveLength(1);
      expect(service?.providerRef).toBeTypeOf("string");

      // Kill the child outside the service: its exit handler schedules the
      // teardown write, which is the continuation under test.
      process.kill(-Number(service!.providerRef), "SIGTERM");
      await waitFor(gatedDb.waitForInsert(2), "child-exit teardown write");

      const resetPromise = resetRuntimeServicesForTests();
      const resetState = trackSettled(resetPromise);
      try {
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(resetState.settled).toBe(false);
      } finally {
        gatedDb.releaseInsert(2);
      }

      await resetPromise;
      expect(gatedDb.inserts).toHaveLength(2);
      expect(gatedDb.inserts[1]?.status).toBe("stopped");
      expect(resetState.settled).toBe(true);
    });
  },
);
