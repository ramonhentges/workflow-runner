import { describe, expect, it } from "bun:test";

import { asRunId } from "../../domain/run.js";
import { DaemonRpcError } from "../../infra/client/client.js";
import { RpcErrorCode } from "../../infra/daemon/protocol.js";
import { createMockClient } from "../../infra/client/__tests__/mock-client.js";
import * as stop from "./stop.js";

function makeStream() {
  const chunks: string[] = [];
  return { chunks, write: (s: string) => chunks.push(s) };
}

describe("stop.run", () => {
  it("calls run.stop with the runId and prints 'aborted run <id>' when finalStatus is aborted", async () => {
    const mock = createMockClient({
      responders: { "run.stop": () => ({ finalStatus: "aborted" }) },
    });
    const stdout = makeStream();
    const stderr = makeStream();

    const code = await stop.run(["abc12345"], {
      connect: async () => mock.asClient(),
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    expect(mock.calls).toEqual([
      { method: "run.stop", params: { runId: asRunId("abc12345") } },
    ]);
    expect(stdout.chunks.join("")).toBe("aborted run abc12345\n");
    expect(stderr.chunks.join("")).toBe("");
    expect(mock.closed).toBe(true);
  });

  it("prints 'already <status> (no-op)' when run is already in a terminal state", async () => {
    const mock = createMockClient({
      responders: { "run.stop": () => ({ finalStatus: "finished" }) },
    });
    const stdout = makeStream();
    const stderr = makeStream();

    const code = await stop.run(["abc12345"], {
      connect: async () => mock.asClient(),
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    expect(stdout.chunks.join("")).toBe("run abc12345 already finished (no-op)\n");
    expect(stderr.chunks.join("")).toBe("");
    expect(mock.closed).toBe(true);
  });

  it("on UNKNOWN_RUN: prints the actionable 'see workflow-runner ps' message and returns 1", async () => {
    const mock = createMockClient({
      responders: {
        "run.stop": () => {
          throw new DaemonRpcError(RpcErrorCode.UNKNOWN_RUN, "not found");
        },
      },
    });
    const stdout = makeStream();
    const stderr = makeStream();

    const code = await stop.run(["zzz"], {
      connect: async () => mock.asClient(),
      stdout,
      stderr,
    });

    expect(code).toBe(1);
    const errOut = stderr.chunks.join("");
    expect(errOut).toContain("no run with id 'zzz'");
    expect(errOut).toContain("workflow-runner ps");
    expect(stdout.chunks.join("")).toBe("");
    expect(mock.closed).toBe(true);
  });

  it("on connection failure: prints the error and returns 1", async () => {
    const stdout = makeStream();
    const stderr = makeStream();
    const code = await stop.run(["abc"], {
      connect: async () => {
        throw new Error("daemon unreachable");
      },
      stdout,
      stderr,
    });
    expect(code).toBe(1);
    expect(stderr.chunks.join("")).toContain("daemon unreachable");
  });

  it("with no runId: prints usage error and returns 1", async () => {
    const stdout = makeStream();
    const stderr = makeStream();
    let connectCalls = 0;

    const code = await stop.run([], {
      connect: async () => {
        connectCalls += 1;
        return createMockClient().asClient();
      },
      stdout,
      stderr,
    });

    expect(code).toBe(1);
    expect(connectCalls).toBe(0);
    expect(stderr.chunks.join("")).toContain("Usage:");
  });
});
