import { RunManagerError, type RunManager } from "../run-manager.js";
import { RpcError, type RpcHandler } from "../rpc/server.js";
import { resolveRun } from "./_resolve-run.js";

export function createRunSendHandler(rm: RunManager): RpcHandler<"run.send"> {
  return async (params) => {
    const { runId } = resolveRun(rm, params.runId);

    try {
      const acceptedSeq = await rm.sendInput(runId, params.message);
      return { acceptedSeq };
    } catch (e) {
      if (e instanceof RunManagerError) {
        throw new RpcError(e.code, e.message, e.data);
      }
      throw e;
    }
  };
}
