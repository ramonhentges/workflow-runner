import { describe, expect, test } from "bun:test";

import { startDaemonHarness, waitFor, writeFakeWorkflow } from "./harness.js";

describe("integration: concurrent runs", () => {
  test("three runs in parallel each reach completed", async () => {
    const h = await startDaemonHarness();
    try {
      const paths = await Promise.all(
        ["a", "b", "c"].map((id) =>
          writeFakeWorkflow(h.storageRoot, `concurrent-${id}`, [
            { id: "step-1", description: "fake:complete" },
          ]),
        ),
      );

      const starts = await Promise.all(
        paths.map((p) => h.client.call("run.start", { workflowPath: p })),
      );
      const ids = starts.map((s) => s.runId);
      expect(new Set(ids).size).toBe(3);

      await waitFor(
        async () => {
          const { runs } = await h.client.call("run.ps", {});
          const mine = runs.filter((r) => ids.includes(r.id));
          return mine.length === 3 && mine.every((r) => r.status === "completed")
            ? mine
            : null;
        },
        { timeoutMs: 6000, label: "all-completed" },
      );

      const { runs } = await h.client.call("run.ps", {});
      const mine = runs.filter((r) => ids.includes(r.id));
      expect(mine.map((r) => r.status).sort()).toEqual(["completed", "completed", "completed"]);
    } finally {
      await h.cleanup();
    }
  });
});
