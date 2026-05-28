import { describe, expect, it } from "bun:test";

import { asRunId, asRunSlug } from "../../domain/run.js";
import { DaemonRpcError } from "../../infra/client/client.js";
import { RpcErrorCode } from "../../infra/daemon/protocol.js";
import { createMockClient } from "../../infra/client/__tests__/mock-client.js";
import * as start from "./start.js";
import { watchExitCode } from "./_status-watcher.js";

interface StubStream {
  chunks: string[];
  write(s: string): void;
}

function makeStream(): StubStream {
  const chunks: string[] = [];
  return {
    chunks,
    write(s: string) {
      chunks.push(s);
    },
  };
}

describe("start.run", () => {
  it("with TTY=true: calls run.start then run.attach and returns 0 on clean detach", async () => {
    const runId = asRunId("rid-1");
    const slug = asRunSlug("brave-otter");
    const mock = createMockClient({
      responders: {
        "run.start": () => ({ runId, slug }),
        "run.attach": () => ({
          initialSnapshot: {
            id: runId,
            slug,
            workflowPath: "workflow.json",
            status: "running",
            currentStepId: null,
            visitedStepIds: [],
            kickoffPrompts: {},
            startedAt: 0,
            endedAt: null,
          },
        }),
      },
    });

    const stdout = makeStream();
    const stderr = makeStream();
    let attachInvoked = false;

    const code = await start.run(["workflow.json"], {
      connect: async () => mock.asClient(),
      isTty: () => true,
      stdout,
      stderr,
      attach: async (_client, attachRunId) => {
        attachInvoked = true;
        // Simulate the TUI invoking run.attach internally.
        await _client.call("run.attach", { runId: attachRunId });
        return 0;
      },
    });

    expect(code).toBe(0);
    expect(attachInvoked).toBe(true);
    expect(mock.calls.map((c) => c.method)).toEqual(["run.start", "run.attach"]);
    expect(stdout.chunks.join("")).toBe("");
    expect(stderr.chunks.join("")).toBe("");
    expect(mock.closed).toBe(true);
  });

  it("with --detach: prints '{runId} {slug}' to stdout and skips attach", async () => {
    const runId = asRunId("rid-2");
    const slug = asRunSlug("wise-fox");
    const mock = createMockClient({
      responders: { "run.start": () => ({ runId, slug }) },
    });

    const stdout = makeStream();
    const stderr = makeStream();
    let attachCalls = 0;

    const code = await start.run(["workflow.json", "--detach"], {
      connect: async () => mock.asClient(),
      isTty: () => true,
      stdout,
      stderr,
      attach: async () => {
        attachCalls += 1;
        return 0;
      },
    });

    expect(code).toBe(0);
    expect(attachCalls).toBe(0);
    expect(mock.calls.map((c) => c.method)).toEqual(["run.start"]);
    expect(stdout.chunks.join("")).toBe(`${runId} ${slug}\n`);
    expect(stderr.chunks.join("")).toBe("");
    expect(mock.closed).toBe(true);
  });

  it("with TTY=false (non-TTY auto-detach): prints id+slug and skips attach", async () => {
    const runId = asRunId("rid-3");
    const slug = asRunSlug("calm-badger");
    const mock = createMockClient({
      responders: { "run.start": () => ({ runId, slug }) },
    });

    const stdout = makeStream();
    const stderr = makeStream();
    let attachCalls = 0;

    const code = await start.run(["workflow.json"], {
      connect: async () => mock.asClient(),
      isTty: () => false,
      stdout,
      stderr,
      attach: async () => {
        attachCalls += 1;
        return 0;
      },
    });

    expect(code).toBe(0);
    expect(attachCalls).toBe(0);
    expect(mock.calls.map((c) => c.method)).toEqual(["run.start"]);
    expect(stdout.chunks.join("")).toBe(`${runId} ${slug}\n`);
  });

  it("with missing workflow path: prints usage error to stderr and returns 1", async () => {
    const mock = createMockClient();
    const stdout = makeStream();
    const stderr = makeStream();
    let connectCalls = 0;

    const code = await start.run([], {
      connect: async () => {
        connectCalls += 1;
        return mock.asClient();
      },
      isTty: () => true,
      stdout,
      stderr,
    });

    expect(code).toBe(1);
    expect(connectCalls).toBe(0);
    expect(stderr.chunks.join("")).toContain("Usage:");
    expect(stdout.chunks.join("")).toBe("");
  });

  it("rejects unknown flags with a usage error", async () => {
    const stdout = makeStream();
    const stderr = makeStream();
    let connectCalls = 0;
    const code = await start.run(["workflow.json", "--bogus"], {
      connect: async () => {
        connectCalls += 1;
        return createMockClient().asClient();
      },
      isTty: () => true,
      stdout,
      stderr,
    });
    expect(code).toBe(1);
    expect(connectCalls).toBe(0);
    expect(stderr.chunks.join("")).toContain("--bogus");
  });

  it("reports a connection-failure error to stderr and returns 1", async () => {
    const stdout = makeStream();
    const stderr = makeStream();
    const code = await start.run(["workflow.json", "--detach"], {
      connect: async () => {
        throw new Error("daemon unreachable");
      },
      isTty: () => false,
      stdout,
      stderr,
    });
    expect(code).toBe(1);
    expect(stderr.chunks.join("")).toContain("daemon unreachable");
  });

  it("on RUN_LIMIT_REACHED: prints the dedicated message and returns 1", async () => {
    const mock = createMockClient({
      responders: {
        "run.start": () => {
          throw new DaemonRpcError(
            RpcErrorCode.RUN_LIMIT_REACHED,
            "too many active runs",
          );
        },
      },
    });
    const stdout = makeStream();
    const stderr = makeStream();
    const code = await start.run(["workflow.json", "--detach"], {
      connect: async () => mock.asClient(),
      isTty: () => false,
      stdout,
      stderr,
    });
    expect(code).toBe(1);
    expect(stderr.chunks.join("")).toContain("run limit reached");
    expect(stderr.chunks.join("")).toContain("too many active runs");
    expect(mock.closed).toBe(true);
  });

  it("watchExitCode: flips to 1 when a terminal failure status arrives for the run", () => {
    const mock = createMockClient();
    const runId = asRunId("rid-watch");
    const watcher = watchExitCode(mock.asClient(), runId);
    expect(watcher.current()).toBe(0);

    // Status change for a different run is ignored.
    mock.emit({
      method: "event.run.statusChanged",
      params: { runId: asRunId("other"), status: "failed" },
    });
    expect(watcher.current()).toBe(0);

    // Non-terminal status for our run leaves the code at 0.
    mock.emit({
      method: "event.run.statusChanged",
      params: { runId, status: "running" },
    });
    expect(watcher.current()).toBe(0);

    // Completed is also not a failure.
    mock.emit({
      method: "event.run.statusChanged",
      params: { runId, status: "completed" },
    });
    expect(watcher.current()).toBe(0);

    // failed/crashed/aborted all flip to 1.
    mock.emit({
      method: "event.run.statusChanged",
      params: { runId, status: "crashed" },
    });
    expect(watcher.current()).toBe(1);

    watcher.dispose();
    // After dispose, subsequent notifications are ignored.
    mock.emit({
      method: "event.run.statusChanged",
      params: { runId, status: "running" },
    });
    expect(watcher.current()).toBe(1);
  });

  it("falls back to the daemon error message for unknown daemon error codes", async () => {
    const mock = createMockClient({
      responders: {
        "run.start": () => {
          throw new DaemonRpcError(-39999, "weird error");
        },
      },
    });
    const stdout = makeStream();
    const stderr = makeStream();
    const code = await start.run(["workflow.json", "--detach"], {
      connect: async () => mock.asClient(),
      isTty: () => false,
      stdout,
      stderr,
    });
    expect(code).toBe(1);
    expect(stderr.chunks.join("")).toContain("weird error");
    expect(mock.closed).toBe(true);
  });

  it("maps WORKFLOW_INVALID errors to a readable message and closes the client", async () => {
    const mock = createMockClient({
      responders: {
        "run.start": () => {
          throw new DaemonRpcError(
            RpcErrorCode.WORKFLOW_INVALID,
            "missing 'steps'",
          );
        },
      },
    });
    const stdout = makeStream();
    const stderr = makeStream();

    const code = await start.run(["bad.json", "--detach"], {
      connect: async () => mock.asClient(),
      isTty: () => false,
      stdout,
      stderr,
    });

    expect(code).toBe(1);
    expect(stderr.chunks.join("")).toContain("workflow invalid");
    expect(stderr.chunks.join("")).toContain("missing 'steps'");
    expect(mock.closed).toBe(true);
  });
});
