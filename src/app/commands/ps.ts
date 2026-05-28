import {
  connect as defaultConnect,
  type DaemonClient,
} from "../../infra/client/client.js";
import { formatPsTable } from "../../infra/client/format.js";
import { parsePsArgs, USAGE } from "../cli.js";

export interface PsDeps {
  connect?: typeof defaultConnect;
  stdout?: { write(s: string): void };
  stderr?: { write(s: string): void };
  now?: () => number;
}

export async function run(argv: string[], deps: PsDeps = {}): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const connectFn = deps.connect ?? defaultConnect;
  const now = deps.now ?? Date.now;

  const parsed = parsePsArgs(argv);
  if (!parsed.ok) {
    stderr.write(`workflow-runner: ${parsed.error}\n${USAGE.ps}\n`);
    return 1;
  }
  if ("help" in parsed) {
    stdout.write(`${USAGE.ps}\n`);
    return 0;
  }
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
    const result = await client.call(
      "run.ps",
      parsed.value.all ? { all: true } : {},
    );
    stdout.write(formatPsTable(result.runs, now()) + "\n");
    return 0;
  } catch (err) {
    stderr.write(
      `workflow-runner: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  } finally {
    await client.close();
  }
}
