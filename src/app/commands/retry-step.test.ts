import { describe, expect, it } from "bun:test";

import { asRunId } from "../../domain/run.js";
import { asStepId } from "../../domain/ids.js";
import { DaemonRpcError } from "../../infra/client/client.js";
import { RpcErrorCode } from "../../infra/daemon/protocol.js";
import { createMockClient } from "../../infra/client/__tests__/mock-client.js";
import * as retryStep from "./retry-step.js";

function makeStream() {
  const chunks: string[] = [];
  return { chunks, write: (s: string) => chunks.push(s) };
}

describe("retry-step.run", () => {
  it("invokes run.retryStep and prints the disclaimer banner exactly", async () => {
    const mock = createMockClient({
      responders: {
        "run.retryStep": () => ({ resumedStepId: asStepId("step-2") }),
      },
    });
    const stdout = makeStream();
    const stderr = makeStream();

    const code = await retryStep.run(["abc"], {
      connect: async () => mock.asClient(),
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    expect(mock.calls).toEqual([
      { method: "run.retryStep", params: { runId: asRunId("abc") } },
    ]);
    expect(stdout.chunks.join("")).toBe(
      "↻ retrying step-2 — LLM output may differ from the previous attempt\n",
    );
    expect(mock.closed).toBe(true);
  });

  it("on RUN_NOT_RETRY_ELIGIBLE: prints 'cannot retry run <id>: <reason>' and returns 1", async () => {
    const mock = createMockClient({
      responders: {
        "run.retryStep": () => {
          throw new DaemonRpcError(
            RpcErrorCode.RUN_NOT_RETRY_ELIGIBLE,
            "run is currently running",
          );
        },
      },
    });
    const stdout = makeStream();
    const stderr = makeStream();

    const code = await retryStep.run(["abc"], {
      connect: async () => mock.asClient(),
      stdout,
      stderr,
    });

    expect(code).toBe(1);
    expect(stderr.chunks.join("")).toContain(
      "cannot retry run 'abc': run is currently running",
    );
    expect(stdout.chunks.join("")).toBe("");
    expect(mock.closed).toBe(true);
  });

  it("on connection failure: prints the error and returns 1", async () => {
    const stdout = makeStream();
    const stderr = makeStream();
    const code = await retryStep.run(["abc"], {
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
    const code = await retryStep.run([], {
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
