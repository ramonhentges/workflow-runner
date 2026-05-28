import { describe, expect, it } from "bun:test";

import { asStepId } from "../../domain/ids.js";
import { asRunId, asRunSlug, type RunId } from "../../domain/run.js";
import { DaemonRpcError, type DaemonClient } from "../../infra/client/client.js";
import { createMockClient } from "../../infra/client/__tests__/mock-client.js";
import { RpcErrorCode, type RunListEntry } from "../../infra/daemon/protocol.js";
import * as attach from "./attach.js";

function makeStream() {
  const chunks: string[] = [];
  return { chunks, write: (s: string) => chunks.push(s) };
}

function makeRow(overrides: Partial<RunListEntry> = {}): RunListEntry {
  return {
    id: asRunId("rid-1"),
    slug: asRunSlug("brave-otter"),
    workflowPath: "/tmp/who-is.json",
    currentStepId: asStepId("step-1"),
    status: "running",
    startedAt: 0,
    endedAt: null,
    attachedCount: 0,
    ...overrides,
  };
}

describe("attach.run", () => {
  it("with explicit runId: invokes run.attach via attachFn and returns 0 on clean detach", async () => {
    const mock = createMockClient({
      responders: {
        "run.attach": () => ({
          initialSnapshot: {
            id: asRunId("abc"),
            slug: asRunSlug("brave-otter"),
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
    const stderr = makeStream();
    const attachCalls: Array<{ runId: RunId }> = [];

    const code = await attach.run(["abc"], {
      connect: async () => mock.asClient(),
      stderr,
      attach: async (client, runId) => {
        attachCalls.push({ runId });
        await client.call("run.attach", { runId });
        return 0;
      },
    });

    expect(code).toBe(0);
    expect(attachCalls).toEqual([{ runId: asRunId("abc") }]);
    expect(mock.calls.map((c) => c.method)).toEqual(["run.attach"]);
    expect(stderr.chunks.join("")).toBe("");
    expect(mock.closed).toBe(true);
  });

  it("with no runId and exactly one active run: attaches to it and returns 0", async () => {
    const onlyRun = makeRow({ id: asRunId("only-1") });
    const mock = createMockClient({
      responders: { "run.ps": () => ({ runs: [onlyRun] }) },
    });
    const stderr = makeStream();
    const attachCalls: Array<{ runId: RunId }> = [];

    const code = await attach.run([], {
      connect: async () => mock.asClient(),
      stderr,
      attach: async (_client, runId) => {
        attachCalls.push({ runId });
        return 0;
      },
      now: () => 0,
    });

    expect(code).toBe(0);
    expect(attachCalls).toEqual([{ runId: asRunId("only-1") }]);
    expect(mock.calls.map((c) => c.method)).toEqual(["run.ps"]);
    expect(stderr.chunks.join("")).toBe("");
    expect(mock.closed).toBe(true);
  });

  it("with no runId and zero active runs: prints actionable message and returns 1", async () => {
    const mock = createMockClient({
      responders: { "run.ps": () => ({ runs: [] }) },
    });
    const stderr = makeStream();
    let attachInvoked = false;

    const code = await attach.run([], {
      connect: async () => mock.asClient(),
      stderr,
      attach: async () => {
        attachInvoked = true;
        return 0;
      },
      now: () => 0,
    });

    expect(code).toBe(1);
    expect(attachInvoked).toBe(false);
    const err = stderr.chunks.join("");
    expect(err).toContain("no runs");
    expect(err).toContain("workflow-runner start <workflow.json>");
    expect(mock.closed).toBe(true);
  });

  it("with no runId and multiple active runs: prints a listing and returns 1 without calling run.attach", async () => {
    const rows: RunListEntry[] = [
      makeRow({ id: asRunId("rid-1"), slug: asRunSlug("brave-otter") }),
      makeRow({ id: asRunId("rid-2"), slug: asRunSlug("wise-fox") }),
      makeRow({ id: asRunId("rid-3"), slug: asRunSlug("calm-badger") }),
    ];
    const mock = createMockClient({
      responders: { "run.ps": () => ({ runs: rows }) },
    });
    const stderr = makeStream();
    let attachInvoked = false;

    const code = await attach.run([], {
      connect: async () => mock.asClient(),
      stderr,
      attach: async () => {
        attachInvoked = true;
        return 0;
      },
      now: () => 0,
    });

    expect(code).toBe(1);
    expect(attachInvoked).toBe(false);
    const err = stderr.chunks.join("");
    expect(err).toContain("rid-1");
    expect(err).toContain("rid-2");
    expect(err).toContain("rid-3");
    expect(mock.calls.map((c) => c.method)).toEqual(["run.ps"]);
  });

  it("with no runId and only terminal-state runs: treats them as inactive and prints 'no runs'", async () => {
    const rows: RunListEntry[] = [
      makeRow({ status: "completed", endedAt: 100 }),
      makeRow({ id: asRunId("rid-2"), status: "failed", endedAt: 200 }),
    ];
    const mock = createMockClient({
      responders: { "run.ps": () => ({ runs: rows }) },
    });
    const stderr = makeStream();

    const code = await attach.run([], {
      connect: async () => mock.asClient(),
      stderr,
      attach: async () => 0,
      now: () => 0,
    });

    expect(code).toBe(1);
    expect(stderr.chunks.join("")).toContain("no runs");
  });

  it("on daemon AMBIGUOUS_PREFIX error from the attach handler: prints prefix + candidates and returns 1", async () => {
    const mock = createMockClient();
    const stderr = makeStream();

    const code = await attach.run(["abc"], {
      connect: async () => mock.asClient(),
      stderr,
      attach: async () => {
        throw new DaemonRpcError(
          RpcErrorCode.AMBIGUOUS_PREFIX,
          "ambiguous prefix",
          { candidates: ["abc12345", "abcd6789"] },
        );
      },
    });

    expect(code).toBe(1);
    const err = stderr.chunks.join("");
    expect(err).toContain("ambiguous run prefix 'abc'");
    expect(err).toContain("abc12345");
    expect(err).toContain("abcd6789");
    expect(mock.closed).toBe(true);
  });

  it("rejects unknown flags with a usage error", async () => {
    const stderr = makeStream();
    let connectCalls = 0;
    const code = await attach.run(["--bogus"], {
      connect: async () => {
        connectCalls += 1;
        return createMockClient().asClient();
      },
      stderr,
    });
    expect(code).toBe(1);
    expect(connectCalls).toBe(0);
    expect(stderr.chunks.join("")).toContain("--bogus");
  });

  it("rejects a second positional argument", async () => {
    const stderr = makeStream();
    let connectCalls = 0;
    const code = await attach.run(["abc", "extra"], {
      connect: async () => {
        connectCalls += 1;
        return createMockClient().asClient();
      },
      stderr,
    });
    expect(code).toBe(1);
    expect(connectCalls).toBe(0);
    expect(stderr.chunks.join("")).toContain("extra");
  });

  it("on connection failure: prints the error and returns 1", async () => {
    const stderr = makeStream();
    const code = await attach.run(["abc"], {
      connect: async () => {
        throw new Error("daemon unreachable");
      },
      stderr,
    });
    expect(code).toBe(1);
    expect(stderr.chunks.join("")).toContain("daemon unreachable");
  });

  it("when attachFn throws a non-RPC error: prints the message and returns 1", async () => {
    const mock = createMockClient();
    const stderr = makeStream();
    const code = await attach.run(["abc"], {
      connect: async () => mock.asClient(),
      stderr,
      attach: async () => {
        throw new Error("tui blew up");
      },
    });
    expect(code).toBe(1);
    expect(stderr.chunks.join("")).toContain("tui blew up");
    expect(mock.closed).toBe(true);
  });

  it("propagates a non-zero exit code from attachFn", async () => {
    const mock = createMockClient();
    const stderr = makeStream();
    const code = await attach.run(["abc"], {
      connect: async () => mock.asClient(),
      stderr,
      attach: async () => 1,
    });
    expect(code).toBe(1);
    expect(mock.closed).toBe(true);
  });
});

// Compile-time sanity: dep typing accepts a DaemonClient-shaped attach fn.
const _typeCheck: (client: DaemonClient, runId: RunId) => Promise<number> =
  async () => 0;
void _typeCheck;
