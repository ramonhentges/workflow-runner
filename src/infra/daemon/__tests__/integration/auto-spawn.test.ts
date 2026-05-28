import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { connect } from "../../../client/client.js";
import { sleep, waitFor, writeFakeWorkflow } from "./harness.js";

const CLI_ENTRY = new URL("../../../../index.ts", import.meta.url).pathname;

describe("integration: auto-spawn", () => {
  test("`start <workflow>` with no daemon auto-spawns, exits 0, run completes", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "wfr-autospawn-"));
    const storageRoot = join(tempDir, "workflow-runner");

    try {
      const workflowPath = await writeFakeWorkflow(tempDir, "autospawn", [
        { id: "step-1", description: "fake:complete" },
      ]);

      // Non-TTY stdout makes `start` auto-detach: prints "<id> <slug>\n" + exits 0.
      const proc = Bun.spawn({
        cmd: ["bun", CLI_ENTRY, "start", workflowPath],
        env: {
          ...process.env,
          NODE_ENV: "test",
          WORKFLOW_RUNNER_FAKE_FACTORY: "1",
          XDG_STATE_HOME: tempDir,
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);

      const stdout = await new Response(proc.stdout).text();
      const [runId] = stdout.trim().split(/\s+/);
      expect(runId).toBeTruthy();

      // The daemon was auto-spawned; the socket should now exist.
      await waitFor(() => existsSync(join(storageRoot, "daemon.sock")), {
        timeoutMs: 3000,
        label: "auto-spawned socket",
      });

      const client = await connect({ storageRoot });
      try {
        await waitFor(
          async () => {
            const { runs } = await client.call("run.ps", {});
            return runs.find((r) => r.id === runId && r.status === "completed") ?? null;
          },
          { timeoutMs: 4000, label: "run completed via auto-spawn" },
        );
      } finally {
        await client.close();
      }

      await stopAutoSpawnedDaemon(storageRoot);
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

async function stopAutoSpawnedDaemon(storageRoot: string): Promise<void> {
  const lockPath = join(storageRoot, "daemon.lock");
  if (!existsSync(lockPath)) return;
  const pid = Number.parseInt(readFileSync(lockPath, "utf8").trim(), 10);
  if (!Number.isFinite(pid) || pid <= 0) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {}
  // Wait for the daemon to exit (lockfile removed by releaseLock).
  for (let i = 0; i < 80; i++) {
    if (!existsSync(lockPath)) return;
    await sleep(25);
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {}
}
