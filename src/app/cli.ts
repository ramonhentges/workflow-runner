export type ParseResult<T> =
  | { ok: true; help: true }
  | { ok: true; value: T }
  | { ok: false; error: string };

export interface StartArgs {
  workflowPath: string;
  detach: boolean;
}

export interface StopArgs {
  runId: string;
}

export interface RetryStepArgs {
  runId: string;
}

export interface PsArgs {
  all: boolean;
}

export interface AttachArgs {
  runId: string | null;
}

export interface SendArgs {
  runId: string;
  message: string;
  fromStdin: boolean;
}

export type DoctorArgs = Record<string, never>;

export type DaemonArgs = Record<string, never>;

export const USAGE = {
  start: "Usage: workflow-runner start <workflow.json> [--detach|-d]",
  stop: "Usage: workflow-runner stop <run-id>",
  retryStep: "Usage: workflow-runner retry-step <run-id>",
  ps: "Usage: workflow-runner ps [--all|-a]",
  attach: "Usage: workflow-runner attach [<run-id>]",
  send: "Usage: workflow-runner send <run-id> <message|->",
  doctor: "Usage: workflow-runner doctor",
  daemon: "Usage: workflow-runner daemon",
} as const;

function isHelpFlag(arg: string): boolean {
  return arg === "--help" || arg === "-h";
}

function hasHelp(argv: readonly string[]): boolean {
  for (const arg of argv) if (isHelpFlag(arg)) return true;
  return false;
}

export function parseStartArgs(
  argv: readonly string[],
): ParseResult<StartArgs> {
  if (hasHelp(argv)) return { ok: true, help: true };
  let workflowPath = "";
  let detach = false;
  for (const arg of argv) {
    if (arg === "--detach" || arg === "-d") {
      detach = true;
      continue;
    }
    if (arg.startsWith("-")) {
      return { ok: false, error: `unknown flag '${arg}'` };
    }
    if (workflowPath === "") {
      workflowPath = arg;
    } else {
      return { ok: false, error: `unexpected argument '${arg}'` };
    }
  }
  if (workflowPath === "") {
    return { ok: false, error: "workflow path is required" };
  }
  return { ok: true, value: { workflowPath, detach } };
}

export function parseStopArgs(argv: readonly string[]): ParseResult<StopArgs> {
  if (hasHelp(argv)) return { ok: true, help: true };
  if (argv.length === 0) {
    return { ok: false, error: "run id is required" };
  }
  const first = argv[0];
  if (first.startsWith("-")) {
    return { ok: false, error: `unknown flag '${first}'` };
  }
  if (argv.length > 1) {
    return { ok: false, error: `unexpected argument '${argv[1]}'` };
  }
  return { ok: true, value: { runId: first } };
}

export function parseRetryStepArgs(
  argv: readonly string[],
): ParseResult<RetryStepArgs> {
  if (hasHelp(argv)) return { ok: true, help: true };
  if (argv.length === 0) {
    return { ok: false, error: "run id is required" };
  }
  const first = argv[0];
  if (first.startsWith("-")) {
    return { ok: false, error: `unknown flag '${first}'` };
  }
  if (argv.length > 1) {
    return { ok: false, error: `unexpected argument '${argv[1]}'` };
  }
  return { ok: true, value: { runId: first } };
}

export function parsePsArgs(argv: readonly string[]): ParseResult<PsArgs> {
  if (hasHelp(argv)) return { ok: true, help: true };
  let all = false;
  for (const arg of argv) {
    if (arg === "--all" || arg === "-a") {
      all = true;
      continue;
    }
    return { ok: false, error: `unknown argument '${arg}'` };
  }
  return { ok: true, value: { all } };
}

export function parseAttachArgs(
  argv: readonly string[],
): ParseResult<AttachArgs> {
  if (hasHelp(argv)) return { ok: true, help: true };
  let runId: string | null = null;
  for (const arg of argv) {
    if (arg.startsWith("-")) {
      return { ok: false, error: `unknown flag '${arg}'` };
    }
    if (runId !== null) {
      return { ok: false, error: `unexpected argument '${arg}'` };
    }
    runId = arg;
  }
  return { ok: true, value: { runId } };
}

export function parseSendArgs(argv: readonly string[]): ParseResult<SendArgs> {
  if (hasHelp(argv)) return { ok: true, help: true };
  if (argv.length < 2) {
    return { ok: false, error: "run id and message are required" };
  }
  const runId = argv[0];
  const rawMessage = argv[1];
  if (runId.startsWith("-")) {
    return { ok: false, error: `unknown flag '${runId}'` };
  }
  if (argv.length > 2) {
    return { ok: false, error: `unexpected argument '${argv[2]}'` };
  }
  const fromStdin = rawMessage === "-";
  return {
    ok: true,
    value: {
      runId,
      message: fromStdin ? "" : rawMessage,
      fromStdin,
    },
  };
}

export function parseDoctorArgs(
  argv: readonly string[],
): ParseResult<DoctorArgs> {
  if (hasHelp(argv)) return { ok: true, help: true };
  if (argv.length > 0) {
    return { ok: false, error: `unexpected argument '${argv[0]}'` };
  }
  return { ok: true, value: {} };
}

export function parseDaemonArgs(
  argv: readonly string[],
): ParseResult<DaemonArgs> {
  if (hasHelp(argv)) return { ok: true, help: true };
  if (argv.length > 0) {
    return { ok: false, error: `unexpected argument '${argv[0]}'` };
  }
  return { ok: true, value: {} };
}
