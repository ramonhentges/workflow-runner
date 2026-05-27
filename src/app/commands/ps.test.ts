import { describe, expect, it } from "bun:test";

import { asRunId, asRunSlug } from "../../domain/run.js";
import { asStepId } from "../../domain/ids.js";
import { createMockClient } from "../../infra/client/__tests__/mock-client.js";
import { formatPsTable } from "../../infra/client/format.js";
import type { RunListEntry } from "../../infra/daemon/protocol.js";
import * as ps from "./ps.js";

function makeStream() {
  const chunks: string[] = [];
  return { chunks, write: (s: string) => chunks.push(s) };
}

describe("ps.run", () => {
  it("calls run.ps, pipes through formatPsTable, and writes to stdout", async () => {
    const rows: RunListEntry[] = [
      {
        id: asRunId("rid-1"),
        slug: asRunSlug("brave-otter"),
        workflowPath: "/tmp/who-is.json",
        currentStepId: asStepId("step-2"),
        status: "running",
        startedAt: 1000,
        endedAt: null,
        attachedCount: 1,
      },
    ];
    const mock = createMockClient({
      responders: { "run.ps": () => ({ runs: rows }) },
    });
    const stdout = makeStream();
    const stderr = makeStream();
    const now = 1000 + 4 * 60_000 + 22_000;

    const code = await ps.run([], {
      connect: async () => mock.asClient(),
      stdout,
      stderr,
      now: () => now,
    });

    expect(code).toBe(0);
    expect(mock.calls).toEqual([{ method: "run.ps", params: {} }]);
    expect(stdout.chunks.join("")).toBe(formatPsTable(rows, now) + "\n");
    expect(stderr.chunks.join("")).toBe("");
    expect(mock.closed).toBe(true);
  });

  it("on connection failure: prints the error and returns 1", async () => {
    const stdout = makeStream();
    const stderr = makeStream();
    const code = await ps.run([], {
      connect: async () => {
        throw new Error("daemon unreachable");
      },
      stdout,
      stderr,
      now: () => 0,
    });
    expect(code).toBe(1);
    expect(stderr.chunks.join("")).toContain("daemon unreachable");
  });

  it("rejects unknown arguments with an error", async () => {
    const stdout = makeStream();
    const stderr = makeStream();
    let connectCalls = 0;
    const code = await ps.run(["--bogus"], {
      connect: async () => {
        connectCalls += 1;
        return createMockClient().asClient();
      },
      stdout,
      stderr,
      now: () => 0,
    });
    expect(code).toBe(1);
    expect(connectCalls).toBe(0);
    expect(stderr.chunks.join("")).toContain("--bogus");
  });

  it("returns 1 if run.ps throws a non-RPC error", async () => {
    const mock = createMockClient({
      responders: {
        "run.ps": () => {
          throw new Error("kaboom");
        },
      },
    });
    const stdout = makeStream();
    const stderr = makeStream();
    const code = await ps.run([], {
      connect: async () => mock.asClient(),
      stdout,
      stderr,
      now: () => 0,
    });
    expect(code).toBe(1);
    expect(stderr.chunks.join("")).toContain("kaboom");
    expect(mock.closed).toBe(true);
  });

  it("forwards --all as { all: true } to run.ps and returns output", async () => {
    const mock = createMockClient({
      responders: { "run.ps": () => ({ runs: [] }) },
    });
    const stdout = makeStream();
    const stderr = makeStream();

    const code = await ps.run(["--all"], {
      connect: async () => mock.asClient(),
      stdout,
      stderr,
      now: () => 0,
    });

    expect(code).toBe(0);
    expect(mock.calls).toEqual([{ method: "run.ps", params: { all: true } }]);
    expect(stdout.chunks.join("")).toBe(formatPsTable([], 0) + "\n");
    expect(stderr.chunks.join("")).toBe("");
  });
});
