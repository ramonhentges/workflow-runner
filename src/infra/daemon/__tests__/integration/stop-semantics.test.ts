import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { startDaemonHarness, waitFor, writeFakeWorkflow } from "./harness.js";

describe("integration: stop semantics", () => {
  test("stop on a hung run transitions to aborted within 5s, meta.json reflects it", async () => {
    const h = await startDaemonHarness();
    try {
      const workflowPath = await writeFakeWorkflow(h.storageRoot, "stop-sem", [
        { id: "step-1", description: "fake:hang" },
      ]);
      const { runId } = await h.client.call("run.start", { workflowPath });

      await waitFor(
        async () => {
          const { runs } = await h.client.call("run.ps", {});
          return runs.find((r) => r.id === runId && r.status === "running") ?? null;
        },
        { timeoutMs: 3000, label: "running" },
      );

      const { finalStatus } = await h.client.call("run.stop", { runId });
      expect(finalStatus).toBe("aborted");

      await waitFor(
        async () => {
          const { runs } = await h.client.call("run.ps", {});
          return runs.find((r) => r.id === runId && r.status === "aborted") ?? null;
        },
        { timeoutMs: 5000, label: "aborted" },
      );

      const metaPath = join(h.storageRoot, "runs", runId, "meta.json");
      const meta = (await Bun.file(metaPath).json()) as { status: string };
      expect(meta.status).toBe("aborted");
    } finally {
      await h.cleanup();
    }
  });
});
