import { RpcErrorCode } from "../../infra/daemon/protocol.js";
import { RunManagerError } from "../../infra/daemon/run-manager.js";
import { WorkflowConfigError } from "../../domain/workflow.js";

// Maps RpcErrorCode numeric codes to HTTP status codes.
// Unmapped codes fall back to 500.
export const ERROR_HTTP_STATUS: Record<number, number> = {
  [RpcErrorCode.UNKNOWN_RUN]: 404,
  [RpcErrorCode.WORKFLOW_INVALID]: 400,
  [RpcErrorCode.RUN_NOT_INTERACTIVE]: 409,
  [RpcErrorCode.RUN_NOT_RETRY_ELIGIBLE]: 409,
  [RpcErrorCode.AMBIGUOUS_PREFIX]: 409,
  [RpcErrorCode.RUN_LIMIT_REACHED]: 429,
  [RpcErrorCode.DAEMON_SHUTTING_DOWN]: 503,
  [RpcErrorCode.CWD_INVALID]: 400,
};

export function httpStatusForError(err: RunManagerError): number {
  return ERROR_HTTP_STATUS[err.code] ?? 500;
}

export interface MappedError {
  status: number;
  code: string;
  message: string;
}

/**
 * Maps any thrown error to an HTTP error shape.
 * RunManagerError → uses ERROR_HTTP_STATUS; WorkflowConfigError → 400; others → 500.
 */
export function mapError(err: unknown): MappedError {
  if (err instanceof RunManagerError) {
    const status = httpStatusForError(err);
    const code =
      Object.entries(RpcErrorCode).find(([, v]) => v === err.code)?.[0] ??
      "INTERNAL_ERROR";
    return { status, code, message: err.message };
  }
  if (err instanceof WorkflowConfigError) {
    return { status: 400, code: "WORKFLOW_INVALID", message: err.message };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { status: 500, code: "INTERNAL_ERROR", message };
}
