import type { RunId } from "../../domain/run.js";
import type { DaemonClient } from "../../infra/client/client.js";
import { Tui } from "../../infra/tui/tui.js";
import { createTuiEventSource } from "./_tui-source.js";
import { watchExitCode } from "./_status-watcher.js";

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
  const { runId: resolvedRunId, backlog } = await client.call("run.attach", { runId });

  let resolveQuit!: () => void;
  const quitPromise = new Promise<void>((resolve) => {
    resolveQuit = resolve;
  });

  const watcher = watchExitCode(client, resolvedRunId);

  const tui = await Tui.create({
    hooks: {
      exit: () => resolveQuit(),
    },
  });
  const source = createTuiEventSource(client, resolvedRunId, backlog);
  tui.attachSource(source);

  try {
    await quitPromise;
  } finally {
    watcher.dispose();
    tui.shutdown();
  }
  return watcher.current();
}
