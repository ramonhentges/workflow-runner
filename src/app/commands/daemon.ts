import { runDaemon as defaultRunDaemon } from "../../infra/daemon/daemon.js";
import {
  connect as defaultConnect,
  type DaemonClient,
} from "../../infra/client/client.js";
import {
  runningDaemon as defaultRunningDaemon,
  isProcessAlive as defaultIsProcessAlive,
} from "../../infra/client/discovery.js";
import type { DiscoveryFile } from "../api/schema.js";
import { parseDaemonArgs, USAGE } from "../cli.js";

/** Total time to wait for the daemon to exit after a stop request. */
const STOP_GRACE_MS = 10_000;
const STOP_POLL_MS = 100;
/** Short connect budget for stop — the daemon is known-running, so don't wait long. */
const STOP_CONNECT_TIMEOUT_MS = 2_000;

export interface DaemonDeps {
  /** Foreground daemon entry (bare `daemon`). */
  runDaemon?: (opts: {
    apiPort?: number;
    storageRoot?: string;
  }) => Promise<number | void>;
  connect?: typeof defaultConnect;
  runningDaemon?: (storageRoot?: string) => DiscoveryFile | null;
  isProcessAlive?: (pid: number) => boolean;
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  stdout?: { write(s: string): void };
  stderr?: { write(s: string): void };
}

export async function run(argv: string[], deps: DaemonDeps = {}): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;

  const sub = argv[0];
  switch (sub) {
    case "start":
      return runStart(argv.slice(1), deps);
    case "stop":
      return runStop(argv.slice(1), deps);
    case "status":
      return runStatus(argv.slice(1), deps);
    case "restart":
      return runRestart(argv.slice(1), deps);
    case "--help":
    case "-h":
      stdout.write(`${USAGE.daemon}\n`);
      return 0;
    default:
      // No subcommand (or bare flags): run in the foreground. This is also the
      // form the compiled binary re-spawns (`daemon --storage-root <path>`).
      return runForeground(argv, deps);
  }
}

/** Bare `daemon` (+ flags): run the daemon in the foreground. */
async function runForeground(argv: string[], deps: DaemonDeps): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;

  const parsed = parseDaemonArgs(argv);
  if (!parsed.ok) {
    stderr.write(`workflow-runner: ${parsed.error}\n${USAGE.daemon}\n`);
    return 1;
  }
  if ("help" in parsed) {
    stdout.write(`${USAGE.daemon}\n`);
    return 0;
  }

  const { apiPort, storageRoot } = parsed.value;
  const runDaemonFn = deps.runDaemon ?? ((opts) => defaultRunDaemon(opts));

  try {
    const result = await runDaemonFn({ apiPort, storageRoot });
    return typeof result === "number" ? result : 0;
  } catch (err) {
    stderr.write(
      `workflow-runner: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }
}

async function runStart(argv: string[], deps: DaemonDeps): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const connectFn = deps.connect ?? defaultConnect;
  const running = deps.runningDaemon ?? defaultRunningDaemon;

  const parsed = parseDaemonArgs(argv);
  if (!parsed.ok) {
    stderr.write(`workflow-runner: ${parsed.error}\n${USAGE.daemon}\n`);
    return 1;
  }
  if ("help" in parsed) {
    stdout.write(`${USAGE.daemon}\n`);
    return 0;
  }
  const { apiPort, storageRoot } = parsed.value;

  const existing = running(storageRoot);
  if (existing) {
    stdout.write(
      `daemon already running (pid ${existing.pid}, port ${existing.apiPort})\n`,
    );
    return 0;
  }

  // The spawned daemon resolves its port from WORKFLOW_RUNNER_API_PORT; set it
  // so `--api-port` is honored by the detached child auto-spawn inherits.
  if (apiPort !== undefined) {
    process.env.WORKFLOW_RUNNER_API_PORT = String(apiPort);
  }

  let client: DaemonClient;
  try {
    client = await connectFn({ storageRoot });
  } catch (err) {
    stderr.write(
      `workflow-runner: failed to start daemon: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
    return 1;
  }
  await client.close();

  const started = running(storageRoot);
  if (started) {
    stdout.write(`daemon started (pid ${started.pid}, port ${started.apiPort})\n`);
  } else {
    stdout.write("daemon started\n");
  }
  return 0;
}

async function runStop(argv: string[], deps: DaemonDeps): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const connectFn = deps.connect ?? defaultConnect;
  const running = deps.runningDaemon ?? defaultRunningDaemon;
  const isAlive = deps.isProcessAlive ?? defaultIsProcessAlive;
  const kill = deps.kill ?? ((pid, signal) => process.kill(pid, signal));
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;

  const parsed = parseDaemonArgs(argv);
  if (!parsed.ok) {
    stderr.write(`workflow-runner: ${parsed.error}\n${USAGE.daemon}\n`);
    return 1;
  }
  if ("help" in parsed) {
    stdout.write(`${USAGE.daemon}\n`);
    return 0;
  }
  const { storageRoot } = parsed.value;

  const existing = running(storageRoot);
  if (!existing) {
    stdout.write("daemon is not running\n");
    return 0;
  }
  const { pid } = existing;

  // Prefer a graceful shutdown over the socket; fall back to SIGTERM if the
  // socket is unreachable (e.g. stale) but the process is still alive.
  let requested = false;
  try {
    const client = await connectFn({
      storageRoot,
      spawn: () => {},
      timeoutMs: STOP_CONNECT_TIMEOUT_MS,
    });
    try {
      await client.call("daemon.shutdown", {});
      requested = true;
    } finally {
      await client.close();
    }
  } catch {
    // fall through to signal
  }
  if (!requested && isAlive(pid)) {
    try {
      kill(pid, "SIGTERM");
    } catch {
      // already gone
    }
  }

  // Wait for the process to exit; escalate to SIGKILL if it overstays.
  const deadline = now() + STOP_GRACE_MS;
  let escalated = false;
  while (isAlive(pid)) {
    if (now() >= deadline) {
      if (escalated) {
        stderr.write(`workflow-runner: daemon (pid ${pid}) did not stop\n`);
        return 1;
      }
      try {
        kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
      escalated = true;
    }
    await sleep(STOP_POLL_MS);
  }

  stdout.write(`daemon stopped (pid ${pid})\n`);
  return 0;
}

async function runStatus(argv: string[], deps: DaemonDeps): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const running = deps.runningDaemon ?? defaultRunningDaemon;

  const parsed = parseDaemonArgs(argv);
  if (!parsed.ok) {
    stderr.write(`workflow-runner: ${parsed.error}\n${USAGE.daemon}\n`);
    return 1;
  }
  if ("help" in parsed) {
    stdout.write(`${USAGE.daemon}\n`);
    return 0;
  }

  const daemon = running(parsed.value.storageRoot);
  if (daemon) {
    stdout.write(`daemon running (pid ${daemon.pid}, port ${daemon.apiPort})\n`);
    return 0;
  }
  stdout.write("daemon not running\n");
  return 3; // LSB convention: program is not running
}

async function runRestart(argv: string[], deps: DaemonDeps): Promise<number> {
  const stopCode = await runStop(argv, deps);
  if (stopCode !== 0) return stopCode;
  return runStart(argv, deps);
}
