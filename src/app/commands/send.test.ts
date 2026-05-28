import { describe, expect, it } from "bun:test";

import { asRunId } from "../../domain/run.js";
import { DaemonRpcError } from "../../infra/client/client.js";
import { createMockClient } from "../../infra/client/__tests__/mock-client.js";
import { RpcErrorCode } from "../../infra/daemon/protocol.js";
import * as send from "./send.js";

function makeStream() {
  const chunks: string[] = [];
  return { chunks, write: (s: string) => chunks.push(s) };
}

describe("send.run", () => {
  it("with inline message: invokes run.send with that message and returns 0", async () => {
    const mock = createMockClient({
      responders: { "run.send": () => ({ acceptedSeq: 42 }) },
    });
    const stderr = makeStream();

    const code = await send.run(["abc", "hello"], {
      connect: async () => mock.asClient(),
      stderr,
    });

    expect(code).toBe(0);
    expect(mock.calls).toEqual([
      {
        method: "run.send",
        params: { runId: asRunId("abc"), message: "hello" },
      },
    ]);
    expect(stderr.chunks.join("")).toBe("");
    expect(mock.closed).toBe(true);
  });

  it("with '-' as the message: reads stdin and forwards verbatim", async () => {
    const mock = createMockClient({
      responders: { "run.send": () => ({ acceptedSeq: 7 }) },
    });
    const stderr = makeStream();
    let stdinCalls = 0;

    const code = await send.run(["abc", "-"], {
      connect: async () => mock.asClient(),
      stderr,
      readStdin: async () => {
        stdinCalls += 1;
        return "multi\nline\n";
      },
    });

    expect(code).toBe(0);
    expect(stdinCalls).toBe(1);
    expect(mock.calls).toEqual([
      {
        method: "run.send",
        params: { runId: asRunId("abc"), message: "multi\nline\n" },
      },
    ]);
    expect(mock.closed).toBe(true);
  });

  it("on RUN_NOT_INTERACTIVE: prints the autonomous-step message and returns 1", async () => {
    const mock = createMockClient({
      responders: {
        "run.send": () => {
          throw new DaemonRpcError(
            RpcErrorCode.RUN_NOT_INTERACTIVE,
            "current step is autonomous",
          );
        },
      },
    });
    const stderr = makeStream();

    const code = await send.run(["abc", "hi"], {
      connect: async () => mock.asClient(),
      stderr,
    });

    expect(code).toBe(1);
    expect(stderr.chunks.join("")).toContain(
      "cannot send to run 'abc': current step is autonomous",
    );
    expect(mock.closed).toBe(true);
  });

  it("on UNKNOWN_RUN: prints the actionable mapped message and returns 1", async () => {
    const mock = createMockClient({
      responders: {
        "run.send": () => {
          throw new DaemonRpcError(RpcErrorCode.UNKNOWN_RUN, "no such run");
        },
      },
    });
    const stderr = makeStream();

    const code = await send.run(["zzz", "hi"], {
      connect: async () => mock.asClient(),
      stderr,
    });

    expect(code).toBe(1);
    const err = stderr.chunks.join("");
    expect(err).toContain("no run with id 'zzz'");
    expect(mock.closed).toBe(true);
  });

  it("on connection failure: prints the error and returns 1", async () => {
    const stderr = makeStream();
    const code = await send.run(["abc", "hi"], {
      connect: async () => {
        throw new Error("daemon unreachable");
      },
      stderr,
    });
    expect(code).toBe(1);
    expect(stderr.chunks.join("")).toContain("daemon unreachable");
  });

  it("with no arguments: prints usage error and returns 1", async () => {
    const stderr = makeStream();
    let connectCalls = 0;
    const code = await send.run([], {
      connect: async () => {
        connectCalls += 1;
        return createMockClient().asClient();
      },
      stderr,
    });
    expect(code).toBe(1);
    expect(connectCalls).toBe(0);
    expect(stderr.chunks.join("")).toContain("Usage:");
  });

  it("with only a runId (no message): prints usage error", async () => {
    const stderr = makeStream();
    const code = await send.run(["abc"], {
      connect: async () => createMockClient().asClient(),
      stderr,
    });
    expect(code).toBe(1);
    expect(stderr.chunks.join("")).toContain("Usage:");
  });

  it("rejects extra positional arguments", async () => {
    const stderr = makeStream();
    const code = await send.run(["abc", "hi", "extra"], {
      connect: async () => createMockClient().asClient(),
      stderr,
    });
    expect(code).toBe(1);
    expect(stderr.chunks.join("")).toContain("extra");
  });

  it("rejects a runId beginning with '-' as a usage error", async () => {
    const stderr = makeStream();
    let connectCalls = 0;
    const code = await send.run(["--bogus", "hi"], {
      connect: async () => {
        connectCalls += 1;
        return createMockClient().asClient();
      },
      stderr,
    });
    expect(code).toBe(1);
    expect(connectCalls).toBe(0);
    expect(stderr.chunks.join("")).toContain("Usage:");
  });

  it("on a non-RPC throw from run.send: prints the error and returns 1", async () => {
    const mock = createMockClient({
      responders: {
        "run.send": () => {
          throw new Error("kaboom");
        },
      },
    });
    const stderr = makeStream();
    const code = await send.run(["abc", "hi"], {
      connect: async () => mock.asClient(),
      stderr,
    });
    expect(code).toBe(1);
    expect(stderr.chunks.join("")).toContain("kaboom");
    expect(mock.closed).toBe(true);
  });
});
