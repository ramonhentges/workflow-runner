import { asRunId, type RunId } from "../../domain/run.js";
import {
  connect as defaultConnect,
  DaemonRpcError,
  type DaemonClient,
} from "../../infra/client/client.js";
import { formatPsTable } from "../../infra/client/format.js";
import type { RunListEntry } from "../../infra/daemon/protocol.js";
import { parseAttachArgs, USAGE } from "../cli.js";
import { attachLoop } from "./_attach-loop.js";
import { mapDaemonError } from "./_errors.js";

export interface AttachDeps {
  connect?: typeof defaultConnect;
  stdout?: { write(s: string): void };
  stderr?: { write(s: string): void };
  attach?: (client: DaemonClient, runId: RunId) => Promise<number>;
  now?: () => number;
}

export async function run(
  argv: string[],
  deps: AttachDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const connectFn = deps.connect ?? defaultConnect;
  const attachFn = deps.attach ?? attachLoop;
  const now = deps.now ?? Date.now;

  const parsed = parseAttachArgs(argv);
  if (!parsed.ok) {
    stderr.write(`workflow-runner: ${parsed.error}\n${USAGE.attach}\n`);
    return 1;
  }
  if ("help" in parsed) {
    stdout.write(`${USAGE.attach}\n`);
    return 0;
  }
  const { runId: runIdInput } = parsed.value;

  let client: DaemonClient;
  try {
    client = await connectFn();
  } catch (err) {
    stderr.write(
      `workflow-runner: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }

  try {
    let resolvedRunId: RunId;
    if (runIdInput === null) {
      const psResult = await client.call("run.ps", {});
      const active = psResult.runs.filter(
        (r: RunListEntry) => r.status === "running",
      );
      if (active.length === 0) {
        stderr.write(
          "workflow-runner: no runs; start one with: workflow-runner start <workflow.json>\n",
        );
        return 1;
      }
      if (active.length > 1) {
        stderr.write(formatPsTable(active, now()) + "\n");
        stderr.write(
          "workflow-runner: multiple active runs; pass a run id to choose one\n",
        );
        return 1;
      }
      resolvedRunId = active[0].id;
    } else {
      resolvedRunId = asRunId(runIdInput);
    }

    try {
      return await attachFn(client, resolvedRunId);
    } catch (err) {
      if (err instanceof DaemonRpcError) {
        stderr.write(
          `workflow-runner: ${mapDaemonError(err, runIdInput ?? String(resolvedRunId))}\n`,
        );
      } else {
        stderr.write(
          `workflow-runner: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
      return 1;
    }
  } catch (err) {
    stderr.write(
      `workflow-runner: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  } finally {
    await client.close();
  }
}
