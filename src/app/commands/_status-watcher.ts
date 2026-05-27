import type { RunId, RunStatus } from "../../domain/run.js";
import type { DaemonClient } from "../../infra/client/client.js";

const TERMINAL_FAILURE: ReadonlySet<RunStatus> = new Set([
  "failed",
  "crashed",
  "aborted",
]);

/**
 * Watch the daemon's `event.run.statusChanged` notifications for a run and
 * track whether a terminal failure has been seen. Returns an unsubscribe
 * function alongside an accessor for the latest exit code (0 for any
 * non-failure state, 1 once any failure status has been observed).
 */
export function watchExitCode(
  client: DaemonClient,
  runId: RunId,
): { dispose: () => void; current: () => number } {
  let code = 0;
  const dispose = client.subscribe(
    (n) =>
      n.method === "event.run.statusChanged" &&
      (n.params as { runId: RunId }).runId === runId,
    (n) => {
      if (n.method !== "event.run.statusChanged") return;
      if (TERMINAL_FAILURE.has(n.params.status)) code = 1;
    },
  );
  return { dispose, current: () => code };
}
