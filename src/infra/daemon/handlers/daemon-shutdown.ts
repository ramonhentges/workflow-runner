import type { RpcHandler } from "../rpc/server.js";

export function createDaemonShutdownHandler(
  triggerExit: (reason: string) => void,
): RpcHandler<"daemon.shutdown"> {
  return async () => {
    // Defer so the JSON-RPC response can flush before the listener stops
    // accepting writes during graceful shutdown.
    setImmediate(() => triggerExit("rpc"));
    return {};
  };
}
