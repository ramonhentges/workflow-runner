import type { RunId } from "../../domain/run.js";
import type { DaemonClient } from "../../infra/client/client.js";
import type { EventLogEntry, RpcNotification } from "../../infra/daemon/protocol.js";
import { Tui } from "../../infra/tui/tui.js";
import { createTuiEventSource } from "./_tui-source.js";
import { watchExitCode } from "./_status-watcher.js";

// Cap early-event buffer to avoid unbounded growth in high-throughput scenarios.
// Size is intentionally generous: the buffer must hold every event that arrives
// between subscribe() and tui.attachSource(), which is at most one RPC round-trip.
const EARLY_EVENT_BUFFER_LIMIT = 5000;

/**
 * Default attach loop used by `start` and `attach` (task 16): calls
 * `run.attach`, hosts a local `Tui` over a `TuiEventSource` adapter, and
 * resolves when the user dismisses the TUI. Returns exit code 1 if the run
 * reached a terminal failure state while attached, 0 otherwise.
 *
 * This module is intentionally kept out of unit-test coverage — it depends on
 * `@opentui/core` which initializes terminal state. End-to-end coverage comes
 * from the integration suite (task 19's "Lifecycle" scenario).
 */
export async function attachLoop(
  client: DaemonClient,
  runId: RunId,
): Promise<number> {
  // Subscribe before calling run.attach to capture any events that are
  // enqueued while the attach handler is running. If the daemon returns
  // events and the response in the same TCP segment, they're dispatched
  // synchronously, and our subscription must already be registered.
  const earlyEvents: Array<{ runId: RunId; entry: EventLogEntry }> = [];
  let droppedEarlyEvents = 0;
  const earlyUnsubscribe = client.subscribe(
    (n) =>
      n.method === "event.run.event" &&
      (n.params as { runId: RunId }).runId === runId,
    (n: RpcNotification) => {
      if (n.method === "event.run.event") {
        if (earlyEvents.length >= EARLY_EVENT_BUFFER_LIMIT) {
          // Drop newest: the oldest buffered events bridge the gap between the
          // daemon's backlog snapshot and the live subscription, so they must
          // be preserved. Events dropped here are genuinely lost (the live
          // subscription only delivers future events); the count is forwarded
          // to createTuiEventSource so the TUI can surface a gap marker.
          droppedEarlyEvents++;
          return;
        }
        earlyEvents.push(n.params);
      }
    },
  );

  let result;
  try {
    result = await client.call("run.attach", { runId });
  } catch (err) {
    earlyUnsubscribe();
    throw err;
  }

  const { runId: resolvedRunId, backlog, initialSnapshot } = result;

  let resolveQuit!: () => void;
  const quitPromise = new Promise<void>((resolve) => {
    resolveQuit = resolve;
  });

  const watcher = watchExitCode(client, resolvedRunId);

  let handedOff = false;
  try {
    const tui = await Tui.create({
      hooks: {
        exit: () => resolveQuit(),
      },
    });
    const source = createTuiEventSource(
      client,
      resolvedRunId,
      backlog,
      earlyUnsubscribe,
      earlyEvents,
      droppedEarlyEvents,
    );
    // Surface the run's isolation info (branch/worktree) in the header so an
    // attached user sees where isolated work lives (PRD Core Feature #3).
    tui.setIsolation(initialSnapshot);
    // Show the prompt the run was started with as the opening transcript entry,
    // matching the web run view (ADR-003). No-op when the run had no prompt.
    tui.showInitialPrompt(initialSnapshot.initialPrompt);
    handedOff = true;
    tui.attachSource(source);

    try {
      await quitPromise;
    } finally {
      watcher.dispose();
      tui.shutdown();
    }
  } finally {
    if (!handedOff) earlyUnsubscribe();
  }
  return watcher.current();
}
