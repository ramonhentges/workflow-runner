import type { RunManager } from "../run-manager.js";
import { RunManagerError } from "../run-manager.js";
import { RpcErrorCode } from "../protocol.js";
import { RpcError, type RpcHandler } from "../rpc/server.js";
import { WorkflowConfigError } from "../../../domain/workflow.js";
import { resolveRun } from "./_resolve-run.js";

export function createRunRetryStepHandler(rm: RunManager): RpcHandler<"run.retryStep"> {
  return async (params) => {
    const { runId, active } = resolveRun(rm, params.runId);

    // Capture the failed step id before retrying; retryStep throws if null.
    const snap = active.run.snapshot();

    try {
      await rm.retryStep(runId);
    } catch (e) {
      if (e instanceof RunManagerError) {
        throw new RpcError(e.code, e.message, e.data);
      }
      if (e instanceof WorkflowConfigError) {
        throw new RpcError(RpcErrorCode.WORKFLOW_INVALID, e.message);
      }
      throw e;
    }

    // retryStep succeeds only when currentStepId was non-null (enforced by RunManager).
    const resumedStepId = snap.currentStepId!;
    return { resumedStepId };
  };
}
