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
 */
export function createTuiEventSource(
  client: DaemonClient,
  runId: RunId,
  backlog?: EventLogEntry[],
): TuiEventSource {
  let unsubscribe: (() => void) | null = null;

  return {
    subscribe(observer: (event: RunnerEvent) => void): () => void {
      // Replay historical backlog synchronously before subscribing for live
      // events.  Because the backlog was returned inline in the attach RPC
      // result, it arrives before any subsequent notifications, so there is
      // no timing window to miss events.
      if (backlog) {
        for (const entry of backlog) {
          observer(entry.event);
        }
      }

      const off = client.subscribe(
        (n: RpcNotification) =>
          n.method === "event.run.event" &&
          (n.params as { runId: RunId }).runId === runId,
        (n: RpcNotification) => {
          if (n.method !== "event.run.event") return;
          observer(n.params.entry.event);
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
