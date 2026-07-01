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

  it("sends process.cwd() as cwd in the run.start RPC request", async () => {
    const runId = asRunId("rid-cwd");
    const slug = asRunSlug("cwd-otter");
    const mock = createMockClient({
      responders: {
        "run.start": () => ({ runId, slug }),
      },
    });

    const stdout = makeStream();
    const stderr = makeStream();

    await start.run(["workflow.json", "--detach"], {
      connect: async () => mock.asClient(),
      isTty: () => false,
      stdout,
      stderr,
    });

    const startCall = mock.calls.find((c) => c.method === "run.start");
    expect(startCall).toBeDefined();
    const params = startCall!.params as { workflowPath: string; cwd: string };
    expect(params.workflowPath).toBe("workflow.json");
    expect(params.cwd).toBe(process.cwd());
  });

  it("forwards branch in the run.start RPC request when --branch is given", async () => {
    const runId = asRunId("rid-branch");
    const slug = asRunSlug("iso-otter");
    const mock = createMockClient({
      responders: {
        "run.start": () => ({ runId, slug }),
      },
    });

    const stdout = makeStream();
    const stderr = makeStream();

    const code = await start.run(["workflow.json", "--branch", "b", "--detach"], {
      connect: async () => mock.asClient(),
      isTty: () => false,
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    const startCall = mock.calls.find((c) => c.method === "run.start");
    expect(startCall).toBeDefined();
    const params = startCall!.params as {
      workflowPath: string;
      cwd: string;
      branch?: string;
    };
    expect(params.workflowPath).toBe("workflow.json");
    expect(params.cwd).toBe(process.cwd());
    expect(params.branch).toBe("b");
  });

  it("forwards --step as startStepId and still attaches on a TTY", async () => {
    const runId = asRunId("rid-step");
    const slug = asRunSlug("step-otter");
    const mock = createMockClient({
      responders: { "run.start": () => ({ runId, slug }) },
    });
    let attachedRunId: string | undefined;

    const code = await start.run(["workflow.json", "--step", "review"], {
      connect: async () => mock.asClient(),
      isTty: () => true,
      attach: async (_client, id) => {
        attachedRunId = id;
        return 0;
      },
      stdout: makeStream(),
      stderr: makeStream(),
    });

    const startCall = mock.calls.find((call) => call.method === "run.start");
    expect(code).toBe(0);
    expect(startCall?.params).toEqual({
      workflowPath: "workflow.json",
      cwd: process.cwd(),
      startStepId: "review",
    });
    expect(attachedRunId).toBe(runId);
  });

  it("omits startStepId from run.start when --step is absent", async () => {
    const runId = asRunId("rid-plain");
    const slug = asRunSlug("plain-otter");
    const mock = createMockClient({
      responders: { "run.start": () => ({ runId, slug }) },
    });

    await start.run(["workflow.json", "--detach"], {
      connect: async () => mock.asClient(),
      isTty: () => true,
      stdout: makeStream(),
      stderr: makeStream(),
    });

    const startCall = mock.calls.find((call) => call.method === "run.start");
    expect("startStepId" in (startCall?.params ?? {})).toBe(false);
  });

  it("rejects a missing --step value before connecting and prints supported usage", async () => {
    let connectCalls = 0;
    const stderr = makeStream();

    const code = await start.run(["workflow.json", "--step"], {
      connect: async () => {
        connectCalls++;
        throw new Error("connect must not be reached");
      },
      stdout: makeStream(),
      stderr,
    });

    expect(code).toBe(1);
    expect(connectCalls).toBe(0);
    expect(stderr.chunks.join("")).toContain("--step requires a value");
    expect(stderr.chunks.join("")).toContain("[--step <step-id>]");
  });

  it("forwards inline --prompt text as initialPrompt in run.start", async () => {
    const runId = asRunId("rid-prompt");
    const slug = asRunSlug("inline-otter");
    const mock = createMockClient({
      responders: { "run.start": () => ({ runId, slug }) },
    });

    const code = await start.run(["workflow.json", "--prompt", "x", "--detach"], {
      connect: async () => mock.asClient(),
      isTty: () => false,
      stdout: makeStream(),
      stderr: makeStream(),
    });

    expect(code).toBe(0);
    const startCall = mock.calls.find((c) => c.method === "run.start");
    expect(startCall).toBeDefined();
    const params = startCall!.params as { initialPrompt?: string };
    expect(params.initialPrompt).toBe("x");
  });

  it("with --prompt -: reads the injected stdin reader and forwards its contents", async () => {
    const runId = asRunId("rid-stdin");
    const slug = asRunSlug("stdin-otter");
    const mock = createMockClient({
      responders: { "run.start": () => ({ runId, slug }) },
    });
    let stdinCalls = 0;

    const code = await start.run(["workflow.json", "--prompt", "-", "--detach"], {
      connect: async () => mock.asClient(),
      isTty: () => false,
      stdout: makeStream(),
      stderr: makeStream(),
      readStdin: async () => {
        stdinCalls += 1;
        return "from\nstdin\n";
      },
    });

    expect(code).toBe(0);
    expect(stdinCalls).toBe(1);
    const startCall = mock.calls.find((c) => c.method === "run.start");
    const params = startCall!.params as { initialPrompt?: string };
    expect(params.initialPrompt).toBe("from\nstdin\n");
  });

  it("with --prompt @file: reads the injected file reader and forwards its contents", async () => {
    const runId = asRunId("rid-file");
    const slug = asRunSlug("file-otter");
    const mock = createMockClient({
      responders: { "run.start": () => ({ runId, slug }) },
    });
    let readPath: string | undefined;

    const code = await start.run(
      ["workflow.json", "--prompt", "@/tmp/brief.md", "--detach"],
      {
        connect: async () => mock.asClient(),
        isTty: () => false,
        stdout: makeStream(),
        stderr: makeStream(),
        readFile: async (path: string) => {
          readPath = path;
          return "file brief contents";
        },
      },
    );

    expect(code).toBe(0);
    expect(readPath).toBe("/tmp/brief.md");
    const startCall = mock.calls.find((c) => c.method === "run.start");
    const params = startCall!.params as { initialPrompt?: string };
    expect(params.initialPrompt).toBe("file brief contents");
  });

  it("omits initialPrompt from the run.start request when --prompt is absent", async () => {
    const runId = asRunId("rid-noprompt");
    const slug = asRunSlug("plain-otter");
    const mock = createMockClient({
      responders: { "run.start": () => ({ runId, slug }) },
    });

    await start.run(["workflow.json", "--detach"], {
      connect: async () => mock.asClient(),
      isTty: () => false,
      stdout: makeStream(),
      stderr: makeStream(),
    });

    const startCall = mock.calls.find((c) => c.method === "run.start");
    expect(startCall).toBeDefined();
    expect("initialPrompt" in (startCall!.params as object)).toBe(false);
  });

  it("returns 1 and reports the error when the --prompt file read fails", async () => {
    const mock = createMockClient({
      responders: {
        "run.start": () => ({ runId: asRunId("x"), slug: asRunSlug("y") }),
      },
    });
    const stderr = makeStream();

    const code = await start.run(
      ["workflow.json", "--prompt", "@/nope.md", "--detach"],
      {
        connect: async () => mock.asClient(),
        isTty: () => false,
        stdout: makeStream(),
        stderr,
        readFile: async () => {
          throw new Error("ENOENT: no such file");
        },
      },
    );

    expect(code).toBe(1);
    expect(stderr.chunks.join("")).toContain("ENOENT");
    // The run was never started.
    expect(mock.calls.some((c) => c.method === "run.start")).toBe(false);
  });

  it("omits branch from the run.start request when --branch is absent", async () => {
    const runId = asRunId("rid-nobranch");
    const slug = asRunSlug("plain-fox");
    const mock = createMockClient({
      responders: { "run.start": () => ({ runId, slug }) },
    });

    await start.run(["workflow.json", "--detach"], {
      connect: async () => mock.asClient(),
      isTty: () => false,
      stdout: makeStream(),
      stderr: makeStream(),
    });

    const startCall = mock.calls.find((c) => c.method === "run.start");
    expect(startCall).toBeDefined();
    expect("branch" in (startCall!.params as object)).toBe(false);
  });

  it("on NOT_A_GIT_REPO: prints a non-repo message and starts nothing", async () => {
    const mock = createMockClient({
      responders: {
        "run.start": () => {
          throw new DaemonRpcError(
            RpcErrorCode.NOT_A_GIT_REPO,
            "cwd is not inside a git repository",
          );
        },
      },
    });
    const stdout = makeStream();
    const stderr = makeStream();
    const code = await start.run(["workflow.json", "--branch", "b", "--detach"], {
      connect: async () => mock.asClient(),
      isTty: () => false,
      stdout,
      stderr,
    });
    expect(code).toBe(1);
    expect(stderr.chunks.join("")).toContain("not a git repository");
    expect(stderr.chunks.join("")).toContain("cwd is not inside a git repository");
    expect(stdout.chunks.join("")).toBe("");
    expect(mock.closed).toBe(true);
  });

  it("on WORKTREE_CONFLICT: prints a conflict message and starts nothing", async () => {
    const mock = createMockClient({
      responders: {
        "run.start": () => {
          throw new DaemonRpcError(
            RpcErrorCode.WORKTREE_CONFLICT,
            "path already occupied by a non-worktree directory",
          );
        },
      },
    });
    const stdout = makeStream();
    const stderr = makeStream();
    const code = await start.run(["workflow.json", "--branch", "b", "--detach"], {
      connect: async () => mock.asClient(),
      isTty: () => false,
      stdout,
      stderr,
    });
    expect(code).toBe(1);
    expect(stderr.chunks.join("")).toContain("worktree conflict");
    expect(stderr.chunks.join("")).toContain(
      "path already occupied by a non-worktree directory",
    );
    expect(stdout.chunks.join("")).toBe("");
    expect(mock.closed).toBe(true);
  });

  it("on BRANCH_IN_USE: prints a branch-checked-out message and starts nothing", async () => {
    const mock = createMockClient({
      responders: {
        "run.start": () => {
          throw new DaemonRpcError(
            RpcErrorCode.BRANCH_IN_USE,
            "Branch 'b' is already checked out in another worktree",
          );
        },
      },
    });
    const stdout = makeStream();
    const stderr = makeStream();
    const code = await start.run(["workflow.json", "--branch", "b", "--detach"], {
      connect: async () => mock.asClient(),
      isTty: () => false,
      stdout,
      stderr,
    });
    expect(code).toBe(1);
    expect(stderr.chunks.join("")).toContain("branch already checked out");
    expect(stderr.chunks.join("")).toContain(
      "Branch 'b' is already checked out in another worktree",
    );
    expect(stdout.chunks.join("")).toBe("");
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
    let attachCalls = 0;

    const code = await start.run(["bad.json", "--step", "missing"], {
      connect: async () => mock.asClient(),
      isTty: () => true,
      attach: async () => {
        attachCalls++;
        return 0;
      },
      stdout,
      stderr,
    });

    expect(code).toBe(1);
    const startCall = mock.calls.find(call => call.method === "run.start");
    expect(startCall?.params).toEqual({
      workflowPath: "bad.json",
      cwd: process.cwd(),
      startStepId: "missing",
    });
    expect(stderr.chunks.join("")).toContain("workflow invalid");
    expect(stderr.chunks.join("")).toContain("missing 'steps'");
    expect(mock.closed).toBe(true);
    expect(attachCalls).toBe(0);
  });
});
