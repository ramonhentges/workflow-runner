import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, unlinkSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { connect } from "../../../client/client.js";
import { killDaemon, sleep, waitFor, writeFakeWorkflow } from "./harness.js";

const DAEMON_ENTRY = new URL("../../entry.ts", import.meta.url).pathname;

describe("integration: daemon-restart discovery", () => {
  test("hard-kill marks running runs crashed, retryStep with completing factory finishes", async () => {
    // Two daemon spawns + RPC round-trips can push past Bun's default 5s test timeout
    // under load; bump it explicitly.
    const tempDir = mkdtempSync(join(tmpdir(), "wfr-restart-"));
    const storageRoot = join(tempDir, "workflow-runner");

    try {
      // First daemon: hangs the step so we have a "running" run to crash.
      const first = Bun.spawn({
        cmd: ["bun", DAEMON_ENTRY],
        env: {
          ...process.env,
          NODE_ENV: "test",
          WORKFLOW_RUNNER_FAKE_FACTORY: "1",
          XDG_STATE_HOME: tempDir,
        },
        stdout: "ignore",
        stderr: "ignore",
      });

      await waitFor(() => existsSync(join(storageRoot, "daemon.sock")), {
        timeoutMs: 10000,
        label: "daemon.sock",
      });

      const client1 = await connect({ storageRoot });
      const workflowPath = await writeFakeWorkflow(storageRoot, "restart", [
        { id: "step-1", description: "fake:hang" },
      ]);
      const { runId } = await client1.call("run.start", { workflowPath });

      await waitFor(
        async () => {
          const { runs } = await client1.call("run.ps", {});
          const r = runs.find((x) => x.id === runId);
          return r?.currentStepId === "step-1" ? r : null;
        },
        { timeoutMs: 3000, label: "step-1 banner" },
      );

      await client1.close();
      await killDaemon(first, "SIGKILL");
      // Give the kernel a tick to release the socket inode.
      await sleep(50);
      // Under heavy parallel test load the killed daemon's PID can be reused by
      // another worker, defeating `acquireLock`'s stale-PID check. Production
      // tolerates this via `flock` semantics, but for this test we model a
      // user-recovery cleanup of the stale lock so the restart can proceed.
      // SIGKILL leaves both the lockfile and the socket file behind. Production
      // recovers via `acquireLock`'s stale-PID heuristic and `bindSocket`'s
      // pre-bind unlink, but under heavy parallel test load the killed PID can
      // be recycled (defeating the lockfile check), and `connect`'s default
      // auto-spawn races our explicit Bun.spawn second daemon. Remove both
      // files so the only daemon that can come up is the one we spawn next.
      try {
        unlinkSync(join(storageRoot, "daemon.lock"));
      } catch {}
      try {
        unlinkSync(join(storageRoot, "daemon.sock"));
      } catch {}

      // Second daemon: same storageRoot, override marker so retry completes.
      const second = Bun.spawn({
        cmd: ["bun", DAEMON_ENTRY],
        env: {
          ...process.env,
          NODE_ENV: "test",
          WORKFLOW_RUNNER_FAKE_FACTORY: "1",
          WORKFLOW_RUNNER_FAKE_OVERRIDE: "complete",
          XDG_STATE_HOME: tempDir,
        },
        stdout: "ignore",
        stderr: "ignore",
      });

      try {
        await waitFor(() => existsSync(join(storageRoot, "daemon.sock")), {
          timeoutMs: 10000,
          label: "second daemon.sock",
        });

        // Disable auto-spawn so a stale socket never causes a fresh daemon to
        // be forked outside the test's controlled env vars.
        const client2 = await connect({ storageRoot, spawn: () => {} });

        const psSnap = await waitFor(
          async () => {
            const { runs } = await client2.call("run.ps", {});
            return runs.find((r) => r.id === runId && r.status === "crashed") ?? null;
          },
          { timeoutMs: 3000, label: "crashed status" },
        );
        expect(psSnap.status).toBe("crashed");

        await client2.call("run.retryStep", { runId });

        await waitFor(
          async () => {
            const { runs } = await client2.call("run.ps", {});
            const r = runs.find((x) => x.id === runId);
            return r?.status === "completed" ? r : null;
          },
          { timeoutMs: 10000, label: "completed after retry" },
        );

        await client2.close();
      } finally {
        await killDaemon(second, "SIGTERM");
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 60000);
});
