import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { startDaemonHarness, waitFor, writeFakeWorkflow } from "./harness.js";

describe("integration: lifecycle", () => {
  test("start → run completes → ps shows completed → meta.json on disk", async () => {
    const h = await startDaemonHarness();
    try {
      const workflowPath = await writeFakeWorkflow(h.storageRoot, "lifecycle", [
        { id: "step-1", description: "fake:complete" },
      ]);

      const { runId } = await h.client.call("run.start", { workflowPath, cwd: h.storageRoot });
      expect(runId).toBeTruthy();

      const completedSnap = await waitFor(
        async () => {
          const { runs } = await h.client.call("run.ps", {});
          const me = runs.find((r) => r.id === runId);
          return me?.status === "completed" ? me : null;
        },
        { timeoutMs: 4000, label: "run.completed" },
      );
      expect(completedSnap.status).toBe("completed");

      const metaPath = join(h.storageRoot, "runs", runId, "meta.json");
      const meta = (await Bun.file(metaPath).json()) as { status: string };
      expect(meta.status).toBe("completed");

      const { runs } = await h.client.call("run.ps", {});
      expect(runs.find((r) => r.id === runId)).toBeDefined();
    } finally {
      await h.cleanup();
    }
  });
});
