import type { EventLogEntry } from "../event-log.js";
import { RunManagerError, type RunManager, type RunSubscriber } from "../run-manager.js";
import { RpcError, type RpcHandler } from "../rpc/server.js";
import { resolveRun } from "./_resolve-run.js";

export function createRunAttachHandler(rm: RunManager): RpcHandler<"run.attach"> {
  return async (params, ctx) => {
    const { runId, active } = resolveRun(rm, params.runId);
    const snapshot = active.run.snapshot();
    const currentStepId = snapshot.currentStepId;

    // Collect historical backlog BEFORE registering the subscriber so that
    // it is returned inline in the RPC result and the client never races to
    // subscribe before replay notifications arrive on the wire.
    const backlog: EventLogEntry[] = [];
    if (currentStepId !== null) {
      const eventLog =
        active.eventLog ??
        (await rm.openEventLog(runId).catch(() => null));
      if (eventLog) {
        const fromRing = eventLog.currentStepBacklog(currentStepId);
        if (fromRing !== null) {
          backlog.push(...fromRing);
        } else {
          backlog.push(
            ...(await eventLog
              .readBackwardForCurrentStep(currentStepId)
              .catch(() => [])),
          );
        }
      }
    }

    // Register subscriber for live events only — all historical events have
    // already been captured in `backlog` above.
    let detach: () => void;
    try {
      detach = rm.attachSubscriber(runId, {
        onEvent: (entry) => {
          void ctx.notify("event.run.event", { runId, entry });
        },
        onStatusChanged: (status) => {
          void ctx.notify("event.run.statusChanged", { runId, status });
        },
      });
    } catch (e) {
      if (e instanceof RunManagerError) {
        throw new RpcError(e.code, e.message, e.data);
      }
      throw e;
    }

    let cleanedUp = false;
    ctx.onClose(() => {
      if (cleanedUp) return;
      cleanedUp = true;
      try {
        detach();
      } catch {}
    });

    return { runId, initialSnapshot: snapshot, backlog };
  };
}
