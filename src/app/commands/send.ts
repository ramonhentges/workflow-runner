import { asRunId } from "../../domain/run.js";
import {
  connect as defaultConnect,
  DaemonRpcError,
  type DaemonClient,
} from "../../infra/client/client.js";
import { RpcErrorCode } from "../../infra/daemon/protocol.js";
import { parseSendArgs, USAGE } from "../cli.js";
import { mapDaemonError } from "./_errors.js";

export interface SendDeps {
  connect?: typeof defaultConnect;
  stdout?: { write(s: string): void };
  stderr?: { write(s: string): void };
  readStdin?: () => Promise<string>;
}

export async function run(argv: string[], deps: SendDeps = {}): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const connectFn = deps.connect ?? defaultConnect;
  const readStdin = deps.readStdin ?? (() => Bun.stdin.text());

  const parsed = parseSendArgs(argv);
  if (!parsed.ok) {
    stderr.write(`workflow-runner: ${parsed.error}\n${USAGE.send}\n`);
    return 1;
  }
  if ("help" in parsed) {
    stdout.write(`${USAGE.send}\n`);
    return 0;
  }
  const { runId: runIdInput, message: inlineMessage, fromStdin } = parsed.value;

  const message = fromStdin ? await readStdin() : inlineMessage;

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
    await client.call("run.send", {
      runId: asRunId(runIdInput),
      message,
    });
    return 0;
  } catch (err) {
    if (
      err instanceof DaemonRpcError &&
      err.code === RpcErrorCode.RUN_NOT_INTERACTIVE
    ) {
      stderr.write(
        `workflow-runner: cannot send to run '${runIdInput}': current step is autonomous\n`,
      );
    } else if (err instanceof DaemonRpcError) {
      stderr.write(
        `workflow-runner: ${mapDaemonError(err, runIdInput)}\n`,
      );
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
