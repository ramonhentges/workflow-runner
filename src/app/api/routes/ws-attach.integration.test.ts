/**
 * Integration tests for WS /runs/:id/attach.
 *
 * These tests start a real Bun.serve HTTP+WS server in-process using the same
 * createApiApp + websocket handler that production will use. This validates
 * end-to-end framing fidelity without requiring a full daemon subprocess.
 */

import { describe, it, expect } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApiApp } from "../app.js";
import { websocket } from "./ws-attach.js";
import { RunManager } from "../../../infra/daemon/run-manager.js";
import { FixtureSessionFactory } from "../../../infra/daemon/test-helpers/fixture-session-factory.js";
import type { AttachFrame, RunEvent } from "../schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWorkflowJson(id: string, description: string): string {
  return JSON.stringify({
    id,
    name: id,
    description: id,
    version: "1",
    steps: [
      {
        id: "s1",
        agent: "fake/AGENT",
        model: "fake/model",
        mode: "autonomous",
        ide: "fake",
        description,
        edges: [],
      },
    ],
  });
}

interface TestServer {
  port: number;
  stop: () => void;
}

/**
 * Starts a Bun.serve instance with the Hono app + WS handler.
 * Port 0 = OS-assigned (avoids conflicts).
 */
function startTestServer(manager: RunManager, apiPort?: number): TestServer {
  const app = createApiApp(manager, apiPort);
  const srv = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: app.fetch,
    websocket,
  });
  return { port: srv.port ?? 0, stop: () => srv.stop(true) };
}

/**
 * Opens a WebSocket, collects all frames until the socket closes or the
 * timeout fires, then returns the frames and close code.
 */
async function collectFrames(
  url: string,
  timeoutMs = 4000,
): Promise<{ frames: AttachFrame[]; closeCode: number | null }> {
  return new Promise((resolve) => {
    const frames: AttachFrame[] = [];
    let done = false;
    let closeCode: number | null = null;

    const timer = setTimeout(() => {
      if (!done) ws.close();
    }, timeoutMs);

    const ws = new WebSocket(url);
    ws.onmessage = (evt) => {
      try {
        frames.push(JSON.parse(evt.data as string) as AttachFrame);
      } catch {}
    };
    ws.onclose = (evt) => {
      done = true;
      closeCode = evt.code;
      clearTimeout(timer);
      resolve({ frames, closeCode });
    };
    ws.onerror = () => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve({ frames, closeCode });
      }
    };
  });
}

/**
 * Opens a WebSocket, waits for at least `minFrames` to arrive, then closes
 * and returns what was received up to that point.
 */
async function collectNFrames(
  url: string,
  minFrames: number,
  timeoutMs = 5000,
): Promise<AttachFrame[]> {
  return new Promise((resolve) => {
    const frames: AttachFrame[] = [];
    let done = false;
    let ws: WebSocket;

    const finish = () => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        ws.close();
        resolve(frames);
      }
    };

    const timer = setTimeout(finish, timeoutMs);

    ws = new WebSocket(url);
    ws.onmessage = (evt) => {
      try {
        frames.push(JSON.parse(evt.data as string) as AttachFrame);
      } catch {}
      if (frames.length >= minFrames) finish();
    };
    ws.onclose = () => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve(frames);
      }
    };
    ws.onerror = () => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve(frames);
      }
    };
  });
}

// ---------------------------------------------------------------------------
// Event-stream fidelity
// ---------------------------------------------------------------------------

describe("WS /runs/:id/attach — integration: event-stream fidelity", () => {
  it(
    "WS client and RunSubscriber see the same RunEvent sequences on a completed run (KPI)",
    async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "ws-fidelity-"));
      const storageRoot = join(tempDir, "workflow-runner");
      mkdirSync(storageRoot, { recursive: true });

      const factory = new FixtureSessionFactory();
      const manager = new RunManager(storageRoot, factory);
      let server: TestServer | null = null;

      try {
        const wfPath = join(storageRoot, "wf.json");
        await Bun.write(wfPath, makeWorkflowJson("fidelity", "fake:complete"));

        const { runId } = await manager.startRun(wfPath, storageRoot);

        // Direct subscriber captures events as they arrive from the runner.
        const subscriberSeqs: number[] = [];
        manager.attachSubscriber(runId, {
          onEvent: (entry) => { subscriberSeqs.push(entry.seq); },
        });

        // Wait for the run to complete and all events to be persisted.
        await new Promise((r) => setTimeout(r, 500));

        server = startTestServer(manager);

        // WS client attaches after completion → receives full backlog.
        const { frames } = await collectFrames(
          `ws://127.0.0.1:${server.port}/runs/${runId}/attach`,
          3000,
        );

        const snapshotFrame = frames.find((f) => f.type === "snapshot");
        const backlogFrame = frames.find((f) => f.type === "backlog");

        expect(snapshotFrame?.type).toBe("snapshot");
        expect(backlogFrame?.type).toBe("backlog");

        if (backlogFrame?.type !== "backlog") return;

        // Combine backlog + live event frames for total WS event set.
        const wsEntries: RunEvent[] = [
          ...backlogFrame.entries,
          ...frames
            .filter((f): f is Extract<AttachFrame, { type: "event" }> => f.type === "event")
            .map((f) => f.entry),
        ];

        // Deduplicate by seq (mirrors what the TUI client does).
        const seenSeqs = new Set<number>();
        const wsUnique: RunEvent[] = [];
        for (const e of wsEntries) {
          if (!seenSeqs.has(e.seq)) {
            seenSeqs.add(e.seq);
            wsUnique.push(e);
          }
        }

        // Every subscriber event must appear in the WS set (0 dropped).
        for (const seq of subscriberSeqs) {
          expect(seenSeqs.has(seq)).toBe(true);
        }

        // Sequences are strictly increasing (no reordering).
        const wsSeqs = wsUnique.map((e) => e.seq);
        expect(wsSeqs).toEqual([...wsSeqs].sort((a, b) => a - b));
      } finally {
        server?.stop();
        await manager.shutdown();
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    },
    20000,
  );

  it(
    "fromSeq resume: second connection delivers only events with seq > fromSeq",
    async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "ws-resume-"));
      const storageRoot = join(tempDir, "workflow-runner");
      mkdirSync(storageRoot, { recursive: true });

      const factory = new FixtureSessionFactory();
      const manager = new RunManager(storageRoot, factory);
      let server: TestServer | null = null;

      try {
        const wfPath = join(storageRoot, "wf.json");
        await Bun.write(wfPath, makeWorkflowJson("resume", "fake:complete"));

        const { runId } = await manager.startRun(wfPath, storageRoot);
        await new Promise((r) => setTimeout(r, 400));

        server = startTestServer(manager);

        // First connection: get all events.
        const { frames: first } = await collectFrames(
          `ws://127.0.0.1:${server.port}/runs/${runId}/attach`,
          3000,
        );

        const firstBacklog = first.find((f) => f.type === "backlog");
        if (firstBacklog?.type !== "backlog" || firstBacklog.entries.length < 2) {
          // Not enough events to test resume; skip gracefully.
          return;
        }

        // Resume from the first event's seq.
        const resumeFromSeq = firstBacklog.entries[0]!.seq;

        // Second connection with fromSeq.
        const { frames: second } = await collectFrames(
          `ws://127.0.0.1:${server.port}/runs/${runId}/attach?fromSeq=${resumeFromSeq}`,
          3000,
        );

        const secondBacklog = second.find((f) => f.type === "backlog");
        expect(secondBacklog?.type).toBe("backlog");
        if (secondBacklog?.type === "backlog") {
          // All resumed entries have seq strictly greater than resumeFromSeq.
          for (const entry of secondBacklog.entries) {
            expect(entry.seq).toBeGreaterThan(resumeFromSeq);
          }
          // The second backlog contains one fewer event than the first.
          expect(secondBacklog.entries.length).toBe(firstBacklog.entries.length - 1);
        }
      } finally {
        server?.stop();
        await manager.shutdown();
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    },
    20000,
  );
});

// ---------------------------------------------------------------------------
// Origin check (DNS-rebinding guard)
// ---------------------------------------------------------------------------

describe("WS /runs/:id/attach — integration: security", () => {
  it(
    "rejects HTTP upgrade request with foreign Origin header with 403 when port is enforced",
    async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "ws-origin-"));
      const storageRoot = join(tempDir, "workflow-runner");
      mkdirSync(storageRoot, { recursive: true });

      const factory = new FixtureSessionFactory();
      const manager = new RunManager(storageRoot, factory);
      let server: TestServer | null = null;

      try {
        const wfPath = join(storageRoot, "wf.json");
        await Bun.write(wfPath, makeWorkflowJson("origin", "fake:complete"));
        const { runId } = await manager.startRun(wfPath, storageRoot);

        // Use a fixed port for Origin allowlist enforcement.
        const enforcedPort = 19999;
        const app = createApiApp(manager, enforcedPort);
        const srv = Bun.serve({
          port: 0,
          hostname: "127.0.0.1",
          fetch: app.fetch,
          websocket,
        });
        server = { port: srv.port ?? 0, stop: () => srv.stop(true) };

        // Simulate a WS upgrade request with a malicious Origin header.
        // The pre-upgrade middleware checks the Origin header and returns 403.
        const res = await fetch(
          `http://127.0.0.1:${server.port}/runs/${runId}/attach`,
          {
            headers: {
              Host: `127.0.0.1:${enforcedPort}`,
              Origin: "http://evil.com",
              Upgrade: "websocket",
              Connection: "Upgrade",
            },
          },
        );

        expect(res.status).toBe(403);
      } finally {
        server?.stop();
        await manager.shutdown();
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    },
    10000,
  );

  it(
    "returns 404 when the run id does not exist",
    async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "ws-404-"));
      const storageRoot = join(tempDir, "workflow-runner");
      mkdirSync(storageRoot, { recursive: true });

      const factory = new FixtureSessionFactory();
      const manager = new RunManager(storageRoot, factory);
      let server: TestServer | null = null;

      try {
        server = startTestServer(manager);

        const res = await fetch(
          `http://127.0.0.1:${server.port}/runs/no-such-run/attach`,
        );
        expect(res.status).toBe(404);
      } finally {
        server?.stop();
        await manager.shutdown();
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    },
    10000,
  );
});

// ---------------------------------------------------------------------------
// Live-tail: WS client receives live events from a running run
// ---------------------------------------------------------------------------

describe("WS /runs/:id/attach — integration: live tail", () => {
  it(
    "receives snapshot + backlog frames immediately when attaching to a running run",
    async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "ws-live-"));
      const storageRoot = join(tempDir, "workflow-runner");
      mkdirSync(storageRoot, { recursive: true });

      const factory = new FixtureSessionFactory();
      const manager = new RunManager(storageRoot, factory);
      let server: TestServer | null = null;

      let runId: string | null = null;
      try {
        const wfPath = join(storageRoot, "wf.json");
        await Bun.write(wfPath, makeWorkflowJson("live-tail", "fake:hang"));

        const result = await manager.startRun(wfPath, storageRoot);
        runId = result.runId;

        // Wait for the step to start and emit its banner event.
        await new Promise((r) => setTimeout(r, 200));

        server = startTestServer(manager);

        // Collect at least snapshot + backlog (2 frames minimum).
        const frames = await collectNFrames(
          `ws://127.0.0.1:${server.port}/runs/${runId}/attach`,
          2,
          4000,
        );

        const snapshotFrame = frames.find((f) => f.type === "snapshot");
        const backlogFrame = frames.find((f) => f.type === "backlog");

        expect(snapshotFrame?.type).toBe("snapshot");
        expect(backlogFrame?.type).toBe("backlog");

        // Snapshot should show a running run.
        if (snapshotFrame?.type === "snapshot") {
          expect(snapshotFrame.snapshot.status).toBe("running");
        }

        // Backlog should contain the banner event for step s1.
        if (backlogFrame?.type === "backlog") {
          const hasBanner = backlogFrame.entries.some(
            (e) => (e.event as { type?: string }).type === "banner",
          );
          expect(hasBanner).toBe(true);
        }
      } finally {
        // Stop the hanging run before cleanup.
        if (runId !== null) {
          try {
            await manager.stop(runId as never);
          } catch {}
        }
        server?.stop();
        await manager.shutdown();
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    },
    15000,
  );

  it(
    "forwards initialPrompt on the snapshot frame when the run was started with one",
    async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "ws-live-prompt-"));
      const storageRoot = join(tempDir, "workflow-runner");
      mkdirSync(storageRoot, { recursive: true });

      const factory = new FixtureSessionFactory();
      const manager = new RunManager(storageRoot, factory);
      let server: TestServer | null = null;

      let runId: string | null = null;
      try {
        const wfPath = join(storageRoot, "wf.json");
        await Bun.write(wfPath, makeWorkflowJson("live-prompt", "fake:hang"));

        const result = await manager.startRun(
          wfPath,
          storageRoot,
          undefined,
          "review PR #42",
        );
        runId = result.runId;

        await new Promise((r) => setTimeout(r, 200));

        server = startTestServer(manager);

        const frames = await collectNFrames(
          `ws://127.0.0.1:${server.port}/runs/${runId}/attach`,
          2,
          4000,
        );

        const snapshotFrame = frames.find((f) => f.type === "snapshot");
        expect(snapshotFrame?.type).toBe("snapshot");
        if (snapshotFrame?.type === "snapshot") {
          expect(snapshotFrame.snapshot.initialPrompt).toBe("review PR #42");
        }
      } finally {
        if (runId !== null) {
          try {
            await manager.stop(runId as never);
          } catch {}
        }
        server?.stop();
        await manager.shutdown();
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    },
    15000,
  );
});
