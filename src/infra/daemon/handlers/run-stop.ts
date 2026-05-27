import type { RunManager } from "../run-manager.js";
import { RunManagerError } from "../run-manager.js";
import { RpcError, type RpcHandler } from "../rpc/server.js";
import { resolveRun } from "./_resolve-run.js";

export function createRunStopHandler(rm: RunManager): RpcHandler<"run.stop"> {
  return async (params) => {
    const { runId, active } = resolveRun(rm, params.runId);

    try {
      await rm.stop(runId);
    } catch (e) {
      if (e instanceof RunManagerError) {
        throw new RpcError(e.code, e.message, e.data);
      }
      throw e;
    }

    return { finalStatus: active.run.snapshot().status };
  };
}
