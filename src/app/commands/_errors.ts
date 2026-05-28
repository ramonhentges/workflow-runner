import { DaemonRpcError } from "../../infra/client/client.js";
import { RpcErrorCode } from "../../infra/daemon/protocol.js";

/**
 * Map a `DaemonRpcError` to a human-readable, actionable CLI message.
 * `runIdInput` is the literal token the user typed (id or slug prefix); it is
 * surfaced verbatim so the error references what they actually wrote.
 */
export function mapDaemonError(err: DaemonRpcError, runIdInput: string): string {
  switch (err.code) {
    case RpcErrorCode.UNKNOWN_RUN:
      return `no run with id '${runIdInput}'; see 'workflow-runner ps' for current runs`;
    case RpcErrorCode.AMBIGUOUS_PREFIX: {
      const data = err.data as { candidates?: string[] } | undefined;
      const candidates = data?.candidates?.join(", ") ?? "";
      const tail = candidates ? `: ${candidates}` : "";
      return `ambiguous run prefix '${runIdInput}'${tail}`;
    }
    case RpcErrorCode.RUN_NOT_RETRY_ELIGIBLE:
      return `cannot retry run '${runIdInput}': ${err.message}`;
    case RpcErrorCode.RUN_NOT_INTERACTIVE:
      return `run '${runIdInput}' is not waiting for input`;
    case RpcErrorCode.DAEMON_SHUTTING_DOWN:
      return "daemon is shutting down";
    default:
      return err.message;
  }
}
