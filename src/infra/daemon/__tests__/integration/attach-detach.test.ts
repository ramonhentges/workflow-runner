import { describe, expect, test } from "bun:test";

import { connect } from "../../../client/client.js";
import { startDaemonHarness, waitFor, writeFakeWorkflow } from "./harness.js";

describe("integration: attach/detach", () => {
  test("attach receives banner backlog, detach stops delivery, run survives", async () => {
    const h = await startDaemonHarness();
    try {
      const workflowPath = await writeFakeWorkflow(h.storageRoot, "attach-detach", [
        { id: "step-1", description: "fake:hang" },
      ]);
      const { runId } = await h.client.call("run.start", { workflowPath });

      // Wait until the run has entered step-1 so attach replay has a banner to send.
      await waitFor(
        async () => {
          const { runs } = await h.client.call("run.ps", {});
          const r = runs.find((x) => x.id === runId);
          return r?.currentStepId === "step-1" ? r : null;
        },
        { timeoutMs: 3000, label: "currentStepId=step-1" },
      );

      // Use a dedicated client to model a TUI: closing it == /detach.
      const tui = await connect({ storageRoot: h.storageRoot });

      // Attach — backlog is returned inline in the result.
      const attachResult = await tui.call("run.attach", { runId });
      const { backlog } = attachResult as { backlog: { seq: number; event: { type: string } }[] };
      expect(backlog.length).toBeGreaterThan(0);
      expect(backlog.some((e) => e.event.type === "banner")).toBe(true);

      // Subscribe for live events and verify detach stops delivery.
      const receivedAfterDetach: unknown[] = [];
      let detached = false;
      const unsubscribe = tui.subscribe(
        (n) => n.method === "event.run.event",
        (n) => {
          const params = n.params as { entry: { event: { type: string } } };
          if (detached) {
            receivedAfterDetach.push(params);
          }
        },
      );

      detached = true;
      unsubscribe();
      await tui.close();

      // Subscriber slot should clear; ps reports zero attached subscribers.
      await waitFor(
        async () => {
          const { runs } = await h.client.call("run.ps", {});
          const r = runs.find((x) => x.id === runId);
          return r && r.attachedCount === 0 ? r : null;
        },
        { timeoutMs: 1500, label: "attachedCount=0" },
      );

      expect(receivedAfterDetach.length).toBe(0);

      // Run is still alive — status is still "running" (fake:hang never resolves).
      const { runs } = await h.client.call("run.ps", {});
      const me = runs.find((r) => r.id === runId);
      expect(me?.status).toBe("running");

      // Stop the hung run so cleanup doesn't have to wait on a stuck dispose.
      await h.client.call("run.stop", { runId });
    } finally {
      await h.cleanup();
    }
  });

  test("attach by runId prefix returns resolved full runId and backlog", async () => {
    const h = await startDaemonHarness();
    try {
      const workflowPath = await writeFakeWorkflow(h.storageRoot, "attach-prefix", [
        { id: "step-1", description: "fake:hang" },
      ]);
      const { runId } = await h.client.call("run.start", { workflowPath });

      await waitFor(
        async () => {
          const { runs } = await h.client.call("run.ps", {});
          const r = runs.find((x) => x.id === runId);
          return r?.currentStepId === "step-1" ? r : null;
        },
        { timeoutMs: 3000, label: "currentStepId=step-1" },
      );

      const tui = await connect({ storageRoot: h.storageRoot });

      // Attach using a short prefix of the run ID
      const prefix = runId.slice(0, 4);
      const attachResult = await tui.call("run.attach", {
        runId: prefix as never,
      });
      const { runId: resolvedRunId, backlog } = attachResult as {
        runId: string;
        backlog: { seq: number; event: { type: string } }[];
      };

      // The resolved runId must be the full ID, not the prefix
      expect(resolvedRunId).toBe(runId);
      expect(resolvedRunId).not.toBe(prefix);

      // Backlog should contain the step banner
      expect(backlog.length).toBeGreaterThan(0);
      expect(backlog.some((e) => e.event.type === "banner")).toBe(true);

      await tui.close();
      await h.client.call("run.stop", { runId });
    } finally {
      await h.cleanup();
    }
  });
});
