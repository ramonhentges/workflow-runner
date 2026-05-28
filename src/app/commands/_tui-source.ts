import type { RunnerEvent } from "../../domain/runner.js";
import type { RunId } from "../../domain/run.js";
import type { DaemonClient } from "../../infra/client/client.js";
import type { EventLogEntry, RpcNotification } from "../../infra/daemon/protocol.js";
import type { TuiEventSource } from "../../infra/tui/event-source.js";

/**
 * Adapter that lets a local `Tui` consume events from a daemon-hosted run via
 * a `DaemonClient`. `subscribe` replays any `backlog` entries synchronously
 * (supplied inline in the `run.attach` RPC result) and then forwards live
 * events from the daemon's notification stream. `sendInput` forwards user
 * input as a `run.send` RPC; `detach` releases the subscription. Closing the
 * subscription on `detach()` is sufficient: the daemon cleans its subscriber
 * slot when the client connection drops.
 *
 * Optionally accepts `earlyUnsubscribe` and `earlyEvents` if the subscription
 * was already registered on the client before the attach RPC was sent, and
 * events were captured during the RPC. This prevents a race where live events
 * enqueued during the attach handler are dispatched before `subscribe` is
 * called and silently dropped.
 */
export function createTuiEventSource(
  client: DaemonClient,
  runId: RunId,
  backlog?: EventLogEntry[],
  earlyUnsubscribe?: () => void,
  earlyEvents?: Array<{ runId: RunId; entry: EventLogEntry }>,
  droppedEarlyEvents?: number,
): TuiEventSource {
  let unsubscribe: (() => void) | null = null;

  return {
    subscribe(observer: (event: RunnerEvent) => void): () => void {
      // Replay historical backlog synchronously before subscribing for live
      // events.  Because the backlog was returned inline in the attach RPC
      // result, it arrives before any subsequent notifications, so there is
      // no timing window to miss events.
      const backlogSeqs = new Set<number>();
      if (backlog) {
        for (const entry of backlog) {
          backlogSeqs.add(entry.seq);
          observer(entry.event);
        }
      }

      // Replay any events captured during the early subscription phase
      // (between subscribing and the RPC response arriving). Filter to only
      // events for this run (in case the prefix matched a different run).
      // Deduplicate against backlog to prevent races where an event arrived
      // during gap-read and was included in both backlog and earlyEvents.
      if (earlyEvents) {
        for (const params of earlyEvents) {
          if (params.runId === runId && !backlogSeqs.has(params.entry.seq)) {
            observer(params.entry.event);
          }
        }
      }

      // Surface any events the early buffer could not hold. The live
      // subscription below will re-deliver events that arrived after the
      // overflow, but events that arrived before the cap and were displaced
      // by newer ones are genuinely lost — surface that gap explicitly.
      if (droppedEarlyEvents && droppedEarlyEvents > 0) {
        observer({
          type: "log",
          message: `[warning] early-event buffer overflowed: ${droppedEarlyEvents} event(s) dropped`,
          color: "yellow",
        });
      }

      // Unsubscribe from the early subscription since we're now listening
      // with the real observer.
      if (earlyUnsubscribe) {
        earlyUnsubscribe();
      }

      const off = client.subscribe(
        (n: RpcNotification) =>
          n.method === "event.run.event" &&
          (n.params as { runId: RunId }).runId === runId,
        (n: RpcNotification) => {
          if (n.method !== "event.run.event") return;
          // Skip any sequences already in backlog to prevent races where
          // an event arrived during gap-read and was included in both.
          if (!backlogSeqs.has(n.params.entry.seq)) {
            observer(n.params.entry.event);
          }
        },
      );
      unsubscribe = off;
      return () => {
        off();
        if (unsubscribe === off) unsubscribe = null;
      };
    },
    async sendInput(text: string): Promise<void> {
      await client.call("run.send", { runId, message: text });
    },
    async detach(): Promise<void> {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    },
  };
}
