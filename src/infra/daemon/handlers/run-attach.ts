import type { EventLogEntry } from "../event-log.js";
import { RunManagerError, type RunManager, type RunSubscriber } from "../run-manager.js";
import { RpcError, type RpcHandler } from "../rpc/server.js";
import { resolveRun } from "./_resolve-run.js";

export function createRunAttachHandler(rm: RunManager): RpcHandler<"run.attach"> {
  return async (params, ctx) => {
    const { runId, active } = resolveRun(rm, params.runId);
    const snapshot = active.run.snapshot();
    const currentStepId = snapshot.currentStepId;

    // For terminal runs active.eventLog is null (runner closed it on completion).
    // Open a dedicated handle we own and must close when the connection drops.
    // Running runs have active.eventLog set by the runner; do not close that handle.
    const ownedEventLog = !active.eventLog
      ? await rm.openEventLog(runId).catch(() => null)
      : null;
    const eventLog = active.eventLog ?? ownedEventLog;

    // Collect historical backlog BEFORE registering the subscriber so that
    // it is returned inline in the RPC result and the client never races to
    // subscribe before replay notifications arrive on the wire.
    const backlog: EventLogEntry[] = [];
    let maxBacklogSeq = params.fromSeq ?? 0;
    let backlogTruncated = false;
    if (params.fromSeq !== undefined) {
      // Client is resuming after a disconnect; return all events since fromSeq
      if (eventLog) {
        const { entries: events, truncated } = await eventLog
          .readEventsSince(params.fromSeq)
          .catch(() => ({ entries: [] as EventLogEntry[], truncated: false }));
        backlog.push(...events);
        if (events.length > 0) {
          maxBacklogSeq = events[events.length - 1]!.seq;
        }
        backlogTruncated = truncated;
      }
    } else if (currentStepId !== null) {
      // No fromSeq provided; return current step backlog for initial attach
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
        if (backlog.length > 0) {
          maxBacklogSeq = backlog[backlog.length - 1]!.seq;
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

    // Close the race window: between backlog read and subscriber registration,
    // events may have been appended but not delivered to the new subscriber
    // (observer snapshots subscribers before awaiting the append). Re-read
    // events newer than the backlog to catch any that slipped through.
    // Only do this if we have a valid anchor: either an explicit fromSeq or
    // actual backlog events. If backlog is empty, don't read from seq 0 as
    // that would fetch all historical events.
    const haveAnchor = params.fromSeq !== undefined || backlog.length > 0;
    if (haveAnchor && eventLog) {
      // Drain pending writes before gap-read: any append queued on #writeChain
      // before subscriber registration must be on disk before readEventsSince runs.
      await eventLog.flush().catch(() => {});
      const { entries: gapEvents } = await eventLog
        .readEventsSince(maxBacklogSeq)
        .catch(() => ({ entries: [] as EventLogEntry[], truncated: false }));
      // Deduplicate: skip any events already in backlog (shouldn't happen,
      // but be defensive).
      const seen = new Set(backlog.map((e) => e.seq));
      for (const entry of gapEvents) {
        if (!seen.has(entry.seq)) {
          backlog.push(entry);
          seen.add(entry.seq);
        }
      }
    }

    let cleanedUp = false;
    ctx.onClose(() => {
      if (cleanedUp) return;
      cleanedUp = true;
      try {
        detach();
      } catch {}
      if (ownedEventLog) {
        ownedEventLog.close().catch(() => {});
      }
    });

    return { runId, initialSnapshot: snapshot, backlog, backlogTruncated };
  };
}
