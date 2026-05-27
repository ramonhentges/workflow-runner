import type { RunManager } from "../run-manager.js";
import type { RunListEntry } from "../protocol.js";
import type { RpcHandler } from "../rpc/server.js";

export function createRunPsHandler(rm: RunManager): RpcHandler<"run.ps"> {
  return async (params) => {
    const snapshots = rm.list({ includeOldTerminal: !!params.all });

    const runs: RunListEntry[] = snapshots.map((snap) => {
      let attachedCount = 0;
      try {
        // Exact id lookup never produces ambiguity; catch only as a safety net.
        const active = rm.get(snap.id);
        attachedCount = active?.subscribers.size ?? 0;
      } catch {
        // Registry lookup failure is not fatal for ps output.
      }

      return {
        id: snap.id,
        slug: snap.slug,
        workflowPath: snap.workflowPath,
        currentStepId: snap.currentStepId,
        status: snap.status,
        startedAt: snap.startedAt,
        endedAt: snap.endedAt,
        attachedCount,
      };
    });

    return { runs };
  };
}
