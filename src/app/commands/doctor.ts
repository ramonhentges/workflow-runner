import {
  connect as defaultConnect,
  type DaemonClient,
} from "../../infra/client/client.js";
import { formatDoctorReport } from "../../infra/client/format.js";
import type { DoctorReport } from "../../infra/daemon/protocol.js";
import { parseDoctorArgs, USAGE } from "../cli.js";

export interface DoctorDeps {
  connect?: typeof defaultConnect;
  stdout?: { write(s: string): void };
  stderr?: { write(s: string): void };
}

export async function run(
  argv: string[],
  deps: DoctorDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const connectFn = deps.connect ?? defaultConnect;

  const parsed = parseDoctorArgs(argv);
  if (!parsed.ok) {
    stderr.write(`workflow-runner: ${parsed.error}\n${USAGE.doctor}\n`);
    return 1;
  }
  if ("help" in parsed) {
    stdout.write(`${USAGE.doctor}\n`);
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
    const report = await client.call("daemon.doctor", {});
    stdout.write(formatDoctorReport(report) + "\n");
    return hasFailure(report) ? 1 : 0;
  } catch (err) {
    stderr.write(
      `workflow-runner: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  } finally {
    await client.close();
  }
}

function hasFailure(report: DoctorReport): boolean {
  return (
    report.socket.status === "fail" ||
    report.lockfile.status === "fail" ||
    report.activeRuns.status === "fail" ||
    report.agentSubprocesses.status === "fail" ||
    report.diskUsageBytes.status === "fail" ||
    report.orphanPorts.status === "fail"
  );
}
