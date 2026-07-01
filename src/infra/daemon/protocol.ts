import type { StepId } from "../../domain/ids.js";
import type { RunId, RunSlug, RunSnapshot, RunStatus } from "../../domain/run.js";
import type { EventLogEntry } from "./event-log.js";

export type { EventLogEntry };
export type { RunId, RunSlug, RunSnapshot, RunStatus };
export type { StepId };

export type DoctorStatus = "ok" | "warn" | "fail";

export interface DoctorReport {
  socket: { status: DoctorStatus };
  lockfile: { status: DoctorStatus; detail?: string };
  activeRuns: { status: DoctorStatus; count: number };
  agentSubprocesses: { status: DoctorStatus; count: number };
  diskUsageBytes: { status: DoctorStatus; bytes: number };
  orphanPorts: { status: DoctorStatus; count: number };
}

export interface RunListEntry {
  id: RunId;
  slug: RunSlug;
  workflowPath: string;
  cwd?: string;
  worktreePath?: string;
  branch?: string;
  currentStepId: StepId | null;
  status: RunStatus;
  startedAt: number;
  endedAt: number | null;
  attachedCount: number;
}

export interface RpcMethods {
  "run.start": {
    params: {
      workflowPath: string;
      cwd: string;
      branch?: string;
      initialPrompt?: string;
      startStepId?: string;
    };
    result: { runId: RunId; slug: RunSlug };
  };
  "run.ps": {
    params: { all?: boolean };
    result: { runs: RunListEntry[] };
  };
  "run.attach": {
    params: { runId: RunId; fromSeq?: number };
    result: { runId: RunId; initialSnapshot: RunSnapshot; backlog: EventLogEntry[]; backlogTruncated: boolean };
  };
  "run.send": {
    params: { runId: RunId; message: string };
    result: { acceptedSeq: number };
  };
  "run.retryStep": {
    params: { runId: RunId };
    result: { resumedStepId: StepId };
  };
  "run.stop": {
    params: { runId: RunId };
    result: { finalStatus: RunStatus };
  };
  "daemon.doctor": {
    params: {};
    result: DoctorReport;
  };
  "daemon.shutdown": {
    params: {};
    result: {};
  };
}

export type RpcNotification =
  | { method: "event.run.event"; params: { runId: RunId; entry: EventLogEntry } }
  | { method: "event.run.statusChanged"; params: { runId: RunId; status: RunStatus } }
  | { method: "event.run.writerSlot"; params: { runId: RunId; isWriter: boolean } };

export const RpcErrorCode = {
  UNKNOWN_RUN: -32000,
  WORKFLOW_INVALID: -32001,
  RUN_NOT_INTERACTIVE: -32002,
  RUN_NOT_RETRY_ELIGIBLE: -32003,
  AMBIGUOUS_PREFIX: -32004,
  RUN_LIMIT_REACHED: -32005,
  DAEMON_SHUTTING_DOWN: -32006,
  CWD_INVALID: -32007,
  WORKFLOW_RUN_ACTIVE: -32008,
  WORKFLOW_EXISTS: -32009,
  NOT_A_GIT_REPO: -32010,
  WORKTREE_CONFLICT: -32011,
  BRANCH_IN_USE: -32012,
  GIT_ISOLATION_FAILED: -32013,
} as const;

export type RpcErrorName = keyof typeof RpcErrorCode;
