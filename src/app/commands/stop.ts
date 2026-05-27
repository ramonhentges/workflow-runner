import { asRunId } from "../../domain/run.js";
import {
  connect as defaultConnect,
  DaemonRpcError,
  type DaemonClient,
} from "../../infra/client/client.js";
import { parseStopArgs, USAGE } from "../cli.js";
import { mapDaemonError } from "./_errors.js";

export interface StopDeps {
  connect?: typeof defaultConnect;
  stdout?: { write(s: string): void };
  stderr?: { write(s: string): void };
}

export async function run(argv: string[], deps: StopDeps = {}): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const connectFn = deps.connect ?? defaultConnect;

  const parsed = parseStopArgs(argv);
  if (!parsed.ok) {
    stderr.write(`workflow-runner: ${parsed.error}\n${USAGE.stop}\n`);
    return 1;
  }
  if ("help" in parsed) {
    stdout.write(`${USAGE.stop}\n`);
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
    const { finalStatus } = await client.call("run.stop", {
      runId: asRunId(runIdInput),
    });
    if (finalStatus === "aborted") {
      stdout.write(`aborted run ${runIdInput}\n`);
    } else {
      stdout.write(`run ${runIdInput} already ${finalStatus} (no-op)\n`);
    }
    return 0;
  } catch (err) {
    if (err instanceof DaemonRpcError) {
      stderr.write(`workflow-runner: ${mapDaemonError(err, runIdInput)}\n`);
    } else {
      stderr.write(
        `workflow-runner: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
    return 1;
  } finally {
    await client.close();
  }
}
