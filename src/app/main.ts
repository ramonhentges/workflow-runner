import * as attach from "./commands/attach.js";
import * as daemon from "./commands/daemon.js";
import * as doctor from "./commands/doctor.js";
import * as ps from "./commands/ps.js";
import * as retryStep from "./commands/retry-step.js";
import * as send from "./commands/send.js";
import * as start from "./commands/start.js";
import * as stop from "./commands/stop.js";

export type CommandRun = (argv: string[]) => Promise<number>;

const SUBCOMMANDS: ReadonlyArray<readonly [string, string]> = [
  ["start", "start a workflow run (auto-attaches by default)"],
  ["attach", "attach the TUI to a running run"],
  ["detach", "documentation-only: use /detach inside the TUI"],
  ["ps", "list runs (active and recent)"],
  ["send", "send a message to an interactive run"],
  ["retry-step", "retry the failing step of a run"],
  ["stop", "stop a run"],
  ["doctor", "print the daemon health report"],
  ["daemon", "run the daemon process in the foreground"],
];

const DETACH_MESSAGE =
  "detach is performed inside the TUI with /detach; this command is for documentation only";

export interface MainDeps {
  commands?: Partial<Record<string, CommandRun>>;
  stdout?: { write(s: string): void };
  stderr?: { write(s: string): void };
  readVersion?: () => Promise<string> | string;
}

export async function main(argv: string[], deps: MainDeps = {}): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const readVersion = deps.readVersion ?? defaultReadVersion;
  const commands: Record<string, CommandRun> = {
    daemon: (a) => daemon.run(a),
    start: (a) => start.run(a),
    attach: (a) => attach.run(a),
    ps: (a) => ps.run(a),
    send: (a) => send.run(a),
    "retry-step": (a) => retryStep.run(a),
    stop: (a) => stop.run(a),
    doctor: (a) => doctor.run(a),
    ...deps.commands,
  };

  const positional = argv.slice(2);
  const first = positional[0];

  if (first === undefined || first === "--help" || first === "-h") {
    stdout.write(formatUsage());
    return 0;
  }
  if (first === "--version") {
    stdout.write(`${await readVersion()}\n`);
    return 0;
  }
  if (first === "detach") {
    stdout.write(`${DETACH_MESSAGE}\n`);
    return 0;
  }

  const handler = commands[first];
  if (!handler) {
    stderr.write(`unknown subcommand '${first}'; see 'workflow-runner --help'\n`);
    return 1;
  }
  return handler(positional.slice(1));
}

function formatUsage(): string {
  const pad = SUBCOMMANDS.reduce((m, [n]) => Math.max(m, n.length), 0);
  const lines = SUBCOMMANDS.map(([n, d]) => `  ${n.padEnd(pad)}  ${d}`);
  return [
    "Usage: workflow-runner <subcommand> [args...]",
    "",
    "Subcommands:",
    ...lines,
    "",
    "Global flags:",
    "  --help, -h    show this help",
    "  --version     print the version",
    "",
  ].join("\n");
}

async function defaultReadVersion(): Promise<string> {
  try {
    const url = new URL("../../package.json", import.meta.url);
    const pkg = (await Bun.file(url).json()) as { version?: unknown };
    if (typeof pkg.version === "string" && pkg.version.length > 0) return pkg.version;
  } catch {
    // fall through to the literal fallback
  }
  return "0.0.0";
}
