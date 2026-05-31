/**
 * Integration tests for Task 13 + Task 14: API listener mount, bind assertion,
 * discovery file, no-regression latency/RSS check, and graceful shutdown drain.
 *
 * All tests start a real daemon subprocess (via startDaemonHarness) using
 * WORKFLOW_RUNNER_API_PORT=0 so the OS assigns a free port per test.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";

import {
  startDaemonHarness,
  waitFor,
  waitForDiscoveryFile,
  writeFakeWorkflow,
  sleep,
} from "./harness.js";

// ---------------------------------------------------------------------------
// Discovery file tests
// ---------------------------------------------------------------------------

describe("integration: API listener — discovery file", () => {
  test(
    "daemon.json appears after startup with correct shape and 0600 permissions",
    async () => {
      const h = await startDaemonHarness();
      try {
        // daemon.json should already exist by the time the socket appears.
        expect(existsSync(h.discoveryFilePath)).toBe(true);

        const parsed = JSON.parse(readFileSync(h.discoveryFilePath, "utf8")) as {
          pid: number;
          apiPort: number;
          socket: string;
        };

        expect(parsed.pid).toBe(h.daemon.pid);
        expect(parsed.apiPort).toBeGreaterThan(0);
        expect(parsed.socket).toBe(h.socketPath);

        const mode = statSync(h.discoveryFilePath).mode & 0o777;
        expect(mode).toBe(0o600);
      } finally {
        await h.cleanup();
      }
    },
    15000,
  );

  test(
    "a client reading daemon.json can reach the live API port (GET /health)",
    async () => {
      const h = await startDaemonHarness();
      try {
        const discovery = await waitForDiscoveryFile(h.storageRoot, 5000);
        const { apiPort } = discovery;

        const res = await fetch(`http://127.0.0.1:${apiPort}/health`, {
          headers: { Host: `127.0.0.1:${apiPort}` },
        });
        expect(res.status).toBe(200);

        const body = (await res.json()) as { status: string; pid: number };
        expect(body.status).toBe("ok");
        expect(body.pid).toBe(h.daemon.pid);
      } finally {
        await h.cleanup();
      }
    },
    15000,
  );

  test(
    "daemon.json is removed after graceful shutdown",
    async () => {
      const h = await startDaemonHarness();
      try {
        expect(existsSync(h.discoveryFilePath)).toBe(true);
        // Trigger graceful shutdown.
        await h.cleanup();
        // cleanup() sends SIGTERM and waits; discovery file should be gone.
        expect(existsSync(h.discoveryFilePath)).toBe(false);
      } finally {
        // cleanup() is idempotent — safe to call again.
        await h.cleanup();
      }
    },
    15000,
  );
});

// ---------------------------------------------------------------------------
// No-regression test: idle WS connections vs UDS latency/RSS
// ---------------------------------------------------------------------------

describe("integration: API listener — no-regression (idle WS vs UDS latency/RSS)", () => {
  test(
    "N idle WS connections do not degrade UDS p95 latency beyond 5 ms or RSS beyond 25 MB",
    async () => {
      const h = await startDaemonHarness();
      const WS_CONNECTIONS = 20; // below MAX_WS_CONNECTIONS=50; representative idle load
      const UDS_SAMPLES = 40; // enough for a stable p95 estimate
      const P95_LATENCY_BUDGET_MS = 5;
      const RSS_BUDGET_MB = 25;

      const openedWs: WebSocket[] = [];

      try {
        const discovery = await waitForDiscoveryFile(h.storageRoot, 5000);
        const { apiPort } = discovery;

        // Start a fake:interactive run that stays in running state for the test.
        const workflowPath = await writeFakeWorkflow(h.storageRoot, "no-reg", [
          { id: "s1", description: "fake:interactive" },
        ]);
        const { runId } = await h.client.call("run.start", {
          workflowPath,
          cwd: h.storageRoot,
        });

        // Wait for the run to reach running state.
        await waitFor(
          async () => {
            const { runs } = await h.client.call("run.ps", {});
            const me = runs.find((r) => r.id === runId);
            return me?.status === "running" ? me : null;
          },
          { timeoutMs: 5000, label: "run.running" },
        );

        // Measure RSS before opening idle WS connections.
        const rssBefore = readDaemonRssMB(h.daemon.pid ?? 0);

        // Open N idle WS connections (no data sent after the initial attach frames).
        const wsReady: Promise<void>[] = [];
        for (let i = 0; i < WS_CONNECTIONS; i++) {
          const { ws, ready } = openIdleWsConnection(
            `ws://127.0.0.1:${apiPort}/runs/${runId}/attach`,
          );
          openedWs.push(ws);
          wsReady.push(ready);
        }

        // Wait for all connections to be established.
        await Promise.all(wsReady);

        // Allow brief settle time.
        await sleep(100);

        // Measure RSS after idle connections are open.
        const rssAfter = readDaemonRssMB(h.daemon.pid ?? 0);
        const rssDeltaMB = Math.max(0, rssAfter - rssBefore);

        // Measure UDS p95 latency while WS connections are open.
        const latencies: number[] = [];
        for (let i = 0; i < UDS_SAMPLES; i++) {
          const t0 = performance.now();
          // Alternate between daemon.doctor and run.ps to match the KPI.
          if (i % 2 === 0) {
            await h.client.call("daemon.doctor", {});
          } else {
            await h.client.call("run.ps", {});
          }
          latencies.push(performance.now() - t0);
        }

        latencies.sort((a, b) => a - b);
        const p95Index = Math.floor(latencies.length * 0.95);
        const p95 = latencies[p95Index] ?? latencies[latencies.length - 1] ?? 0;

        expect(p95).toBeLessThan(P95_LATENCY_BUDGET_MS);
        expect(rssDeltaMB).toBeLessThan(RSS_BUDGET_MB);
      } finally {
        for (const ws of openedWs) {
          try {
            ws.close();
          } catch {}
        }
        await h.cleanup();
      }
    },
    30000,
  );
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Opens a WebSocket and returns it alongside a promise that resolves once
 * the initial snapshot+backlog frames have arrived (connection is established).
 */
function openIdleWsConnection(url: string): { ws: WebSocket; ready: Promise<void> } {
  let resolveReady!: () => void;
  const ready = new Promise<void>((r) => {
    resolveReady = r;
  });

  let backlogSeen = false;
  let snapshotSeen = false;

  const ws = new WebSocket(url);
  ws.onmessage = (evt) => {
    try {
      const frame = JSON.parse(evt.data as string) as { type: string };
      if (frame.type === "snapshot") snapshotSeen = true;
      if (frame.type === "backlog") backlogSeen = true;
      if (snapshotSeen && backlogSeen) resolveReady();
    } catch {}
  };
  ws.onerror = () => {
    resolveReady(); // resolve anyway so the test doesn't hang
  };

  // Resolve after a timeout as well (in case no frames arrive — e.g. run already terminal).
  setTimeout(resolveReady, 3000);

  return { ws, ready };
}

/**
 * Read the VmRSS of a process from /proc/<pid>/status (Linux only).
 * Returns 0 when unavailable (non-Linux platforms).
 */
function readDaemonRssMB(pid: number): number {
  if (pid <= 0) return 0;
  try {
    const status = readFileSync(`/proc/${pid}/status`, "utf8");
    const match = status.match(/VmRSS:\s+(\d+)\s+kB/);
    if (match?.[1]) return parseInt(match[1], 10) / 1024;
  } catch {}
  return 0;
}

// ---------------------------------------------------------------------------
// Task 14: Graceful shutdown drain — WS clients receive close frame on SIGTERM
// ---------------------------------------------------------------------------

describe("integration: shutdown drain — WS client receives close frame on SIGTERM", () => {
  test(
    "open WS client is closed by the server and daemon.json is removed after shutdown",
    async () => {
      const h = await startDaemonHarness();
      // Use a container to avoid TypeScript CFA narrowing to 'never' when ws is
      // assigned inside a Promise callback and used in a finally block.
      const wsRef: { current: WebSocket | null } = { current: null };

      try {
        const discovery = await waitForDiscoveryFile(h.storageRoot, 5000);
        const { apiPort } = discovery;

        // Start an interactive run that stays in running state throughout.
        const workflowPath = await writeFakeWorkflow(h.storageRoot, "drain-it", [
          { id: "s1", description: "fake:interactive" },
        ]);
        const { runId } = await h.client.call("run.start", {
          workflowPath,
          cwd: h.storageRoot,
        });

        // Wait for the run to be running.
        await waitFor(
          async () => {
            const { runs } = await h.client.call("run.ps", {});
            const me = runs.find((r) => r.id === runId);
            return me?.status === "running" ? me : null;
          },
          { timeoutMs: 5000, label: "run.running" },
        );

        // Open a WS connection and wait for snapshot + backlog frames to confirm
        // the connection is established before we trigger shutdown.
        const wsConnected = new Promise<void>((resolve) => {
          let snapshotSeen = false;
          let backlogSeen = false;
          wsRef.current = new WebSocket(
            `ws://127.0.0.1:${apiPort}/runs/${runId}/attach`,
          );
          wsRef.current.onmessage = (evt) => {
            try {
              const frame = JSON.parse(evt.data as string) as { type: string };
              if (frame.type === "snapshot") snapshotSeen = true;
              if (frame.type === "backlog") backlogSeen = true;
              if (snapshotSeen && backlogSeen) resolve();
            } catch {}
          };
          setTimeout(resolve, 3000); // fallback in case frames arrive differently
        });

        await wsConnected;

        // Capture the WS close event. -1 = our timeout sentinel (connection NOT closed).
        const ws = wsRef.current;
        const wsClosePromise = new Promise<number>((resolve) => {
          if (!ws) { resolve(-1); return; }
          ws.onclose = (evt) => resolve(evt.code);
        });

        // Send SIGTERM. The daemon should drain WS clients before exiting.
        h.daemon.kill("SIGTERM");

        // The WS client must be closed by the server (not time out). Bun may send
        // either 1001 (Going Away, from our drain) or 1000 (Normal, from
        // server.stop(true)) depending on close-handshake timing — both are correct.
        const closeCode = await Promise.race([
          wsClosePromise,
          sleep(8000).then(() => -1),
        ]);

        // -1 means our test timeout fired before the WS was closed — that's a failure.
        expect(closeCode).not.toBe(-1);
        // Close code must be a valid WebSocket close code (not a raw TCP abort).
        expect(closeCode).toBeGreaterThanOrEqual(1000);

        // Wait for daemon to exit fully.
        await Promise.race([h.daemon.exited, sleep(5000)]);

        // Both daemon.json and the UDS socket must be removed after shutdown.
        expect(existsSync(h.discoveryFilePath)).toBe(false);
        expect(existsSync(h.socketPath)).toBe(false);
      } finally {
        try { wsRef.current?.close(); } catch {}
        await h.cleanup();
      }
    },
    30000,
  );
});
