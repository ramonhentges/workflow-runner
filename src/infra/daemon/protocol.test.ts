import { describe, expect, it } from "bun:test";
import { asRunId, asRunSlug } from "../../domain/run.js";
import {
  RpcErrorCode,
  type DoctorReport,
  type EventLogEntry,
  type RpcMethods,
  type RpcNotification,
  type RunListEntry,
  type RunSnapshot,
} from "./protocol.js";

// --- Type-only smoke tests (compile failure = test failure) ---

const _runId = asRunId("abc12345");
const _slug = asRunSlug("brave-otter");

const _snapshot: RunSnapshot = {
  id: _runId,
  slug: _slug,
  workflowPath: "/path/to/workflow.json",
  status: "running",
  currentStepId: "step-1",
  visitedStepIds: [],
  kickoffPrompts: {},
  startedAt: 1_000_000,
  endedAt: null,
};

// RpcMethods["run.start"]
void ({ workflowPath: "/x", cwd: "/work" } satisfies RpcMethods["run.start"]["params"]);
void ({ runId: _runId, slug: _slug } satisfies RpcMethods["run.start"]["result"]);

// RpcMethods["run.ps"]
void ({} satisfies RpcMethods["run.ps"]["params"]);
void ({ runs: [] } satisfies RpcMethods["run.ps"]["result"]);

// RpcMethods["run.attach"]
void ({ runId: _runId } satisfies RpcMethods["run.attach"]["params"]);
void ({ runId: _runId, fromSeq: 1 } satisfies RpcMethods["run.attach"]["params"]);
void ({ runId: _runId, initialSnapshot: _snapshot, backlog: [], backlogTruncated: false } satisfies RpcMethods["run.attach"]["result"]);

// RpcMethods["run.send"]
void ({ runId: _runId, message: "hello" } satisfies RpcMethods["run.send"]["params"]);
void ({ acceptedSeq: 42 } satisfies RpcMethods["run.send"]["result"]);

// RpcMethods["run.retryStep"]
void ({ runId: _runId } satisfies RpcMethods["run.retryStep"]["params"]);
void ({ resumedStepId: "step-1" } satisfies RpcMethods["run.retryStep"]["result"]);

// RpcMethods["run.stop"]
void ({ runId: _runId } satisfies RpcMethods["run.stop"]["params"]);
void ({ finalStatus: "aborted" as const } satisfies RpcMethods["run.stop"]["result"]);

// RpcMethods["daemon.doctor"]
void ({} satisfies RpcMethods["daemon.doctor"]["params"]);
const _doctor: DoctorReport = {
  socket: { status: "ok" },
  lockfile: { status: "ok" },
  activeRuns: { status: "ok", count: 2 },
  agentSubprocesses: { status: "warn", count: 10 },
  diskUsageBytes: { status: "ok", bytes: 1024 },
  orphanPorts: { status: "ok", count: 0 },
};
void (_doctor satisfies RpcMethods["daemon.doctor"]["result"]);

// RpcMethods["daemon.shutdown"]
void ({} satisfies RpcMethods["daemon.shutdown"]["params"]);
void ({} satisfies RpcMethods["daemon.shutdown"]["result"]);

// RpcNotification variants
const _entry: EventLogEntry = {
  seq: 1,
  ts: Date.now(),
  stepId: "step-1",
  event: { type: "log", message: "hello" },
};

void ({
  method: "event.run.event",
  params: { runId: _runId, entry: _entry },
} satisfies RpcNotification);

void ({
  method: "event.run.statusChanged",
  params: { runId: _runId, status: "completed" },
} satisfies RpcNotification);

void ({
  method: "event.run.writerSlot",
  params: { runId: _runId, isWriter: true },
} satisfies RpcNotification);

// RunListEntry
const _listEntry: RunListEntry = {
  id: _runId,
  slug: _slug,
  workflowPath: "/path/to/workflow.json",
  currentStepId: "step-1",
  status: "running",
  startedAt: 1_000_000,
  endedAt: null,
  attachedCount: 1,
};
void _listEntry;

// --- Runtime tests ---

describe("RpcErrorCode", () => {
  it("has the correct integer values per TechSpec", () => {
    expect(RpcErrorCode.UNKNOWN_RUN).toBe(-32000);
    expect(RpcErrorCode.WORKFLOW_INVALID).toBe(-32001);
    expect(RpcErrorCode.RUN_NOT_INTERACTIVE).toBe(-32002);
    expect(RpcErrorCode.RUN_NOT_RETRY_ELIGIBLE).toBe(-32003);
    expect(RpcErrorCode.AMBIGUOUS_PREFIX).toBe(-32004);
    expect(RpcErrorCode.RUN_LIMIT_REACHED).toBe(-32005);
    expect(RpcErrorCode.DAEMON_SHUTTING_DOWN).toBe(-32006);
  });

  it("has no duplicate integer values", () => {
    const values = Object.values(RpcErrorCode);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });
});
