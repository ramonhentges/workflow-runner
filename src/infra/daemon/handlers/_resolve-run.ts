import type { RunId } from "../../../domain/run.js";
import { RunManagerError, type ActiveRun, type RunManager } from "../run-manager.js";
import { RpcErrorCode } from "../protocol.js";
import { RpcError } from "../rpc/server.js";

export interface ResolvedRun {
  runId: RunId;
  active: ActiveRun;
}

/**
 * Resolves idOrPrefix against the RunManager registry.
 * Throws RpcError(UNKNOWN_RUN) if not found.
 * Throws RpcError(AMBIGUOUS_PREFIX, ..., {candidates}) if multiple matches.
 */
export function resolveRun(rm: RunManager, idOrPrefix: string): ResolvedRun {
  let active: ActiveRun | undefined;
  try {
    active = rm.get(idOrPrefix);
  } catch (e) {
    if (e instanceof RunManagerError) {
      throw new RpcError(e.code, e.message, e.data);
    }
    throw e;
  }

  if (!active) {
    throw new RpcError(RpcErrorCode.UNKNOWN_RUN, `Unknown run: ${idOrPrefix}`);
  }

  const runId = active.run.snapshot().id;
  return { runId, active };
}
