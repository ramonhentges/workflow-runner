import { asRunId, type RunId } from "../../domain/run.js";
import {
  connect as defaultConnect,
  DaemonRpcError,
  type DaemonClient,
} from "../../infra/client/client.js";
import { RpcErrorCode } from "../../infra/daemon/protocol.js";
import { parseStartArgs, USAGE } from "../cli.js";
import { attachLoop } from "./_attach-loop.js";
import { mapDaemonError } from "./_errors.js";

export interface StartDeps {
  connect?: typeof defaultConnect;
  isTty?: () => boolean;
  stdout?: { write(s: string): void };
  stderr?: { write(s: string): void };
  attach?: (client: DaemonClient, runId: RunId) => Promise<number>;
}

export async function run(argv: string[], deps: StartDeps = {}): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const isTty = deps.isTty ?? (() => Boolean(process.stdout.isTTY));
  const connectFn = deps.connect ?? defaultConnect;
  const attachFn = deps.attach ?? attachLoop;

  const parsed = parseStartArgs(argv);
  if (!parsed.ok) {
    stderr.write(`workflow-runner: ${parsed.error}\n${USAGE.start}\n`);
    return 1;
  }
  if ("help" in parsed) {
    stdout.write(`${USAGE.start}\n`);
    return 0;
  }
  const { workflowPath, detach, branch } = parsed.value;

  let client: DaemonClient;
  try {
    client = await connectFn();
  } catch (err) {
    stderr.write(
      `workflow-runner: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }

  let startResult: { runId: RunId; slug: string };
  try {
    startResult = await client.call("run.start", {
      workflowPath,
      cwd: process.cwd(),
      ...(branch !== undefined ? { branch } : {}),
    });
  } catch (err) {
    stderr.write(`workflow-runner: ${formatStartError(err)}\n`);
    await client.close();
    return 1;
  }

  const shouldDetach = detach || !isTty();
  if (shouldDetach) {
    stdout.write(`${startResult.runId} ${startResult.slug}\n`);
    await client.close();
    return 0;
  }

  try {
    return await attachFn(client, startResult.runId);
  } finally {
    await client.close();
  }
}

function formatStartError(err: unknown): string {
  if (err instanceof DaemonRpcError) {
    if (err.code === RpcErrorCode.WORKFLOW_INVALID) {
      return `workflow invalid: ${err.message}`;
    }
    if (err.code === RpcErrorCode.RUN_LIMIT_REACHED) {
      return `run limit reached: ${err.message}`;
    }
    if (err.code === RpcErrorCode.NOT_A_GIT_REPO) {
      return `not a git repository: ${err.message}`;
    }
    if (err.code === RpcErrorCode.WORKTREE_CONFLICT) {
      return `worktree conflict: ${err.message}`;
    }
    if (err.code === RpcErrorCode.BRANCH_IN_USE) {
      return `branch already checked out: ${err.message}`;
    }
    return mapDaemonError(err, "<workflow>");
  }
  return err instanceof Error ? err.message : String(err);
}

export { asRunId };
