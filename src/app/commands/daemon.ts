import { runDaemon as defaultRunDaemon } from "../../infra/daemon/daemon.js";
import { parseDaemonArgs, USAGE } from "../cli.js";

export interface DaemonDeps {
  runDaemon?: () => Promise<number | void>;
  stdout?: { write(s: string): void };
  stderr?: { write(s: string): void };
}

export async function run(argv: string[], deps: DaemonDeps = {}): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const runDaemonFn = deps.runDaemon ?? (() => defaultRunDaemon({}));

  const parsed = parseDaemonArgs(argv);
  if (!parsed.ok) {
    stderr.write(`workflow-runner: ${parsed.error}\n${USAGE.daemon}\n`);
    return 1;
  }
  if ("help" in parsed) {
    stdout.write(`${USAGE.daemon}\n`);
    return 0;
  }

  try {
    const result = await runDaemonFn();
    return typeof result === "number" ? result : 0;
  } catch (err) {
    stderr.write(
      `workflow-runner: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }
}
