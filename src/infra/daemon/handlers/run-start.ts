import type { RunManager } from "../run-manager.js";
import { RunManagerError } from "../run-manager.js";
import { RpcErrorCode } from "../protocol.js";
import { RpcError, type RpcHandler } from "../rpc/server.js";
import { WorkflowConfigError } from "../../../domain/workflow.js";

export function createRunStartHandler(rm: RunManager): RpcHandler<"run.start"> {
  return async (params) => {
    try {
      return await rm.startRun(params.workflowPath);
    } catch (e) {
      if (e instanceof RunManagerError) {
        throw new RpcError(e.code, e.message, e.data);
      }
      if (e instanceof WorkflowConfigError) {
        throw new RpcError(RpcErrorCode.WORKFLOW_INVALID, e.message);
      }
      throw e;
    }
  };
}
