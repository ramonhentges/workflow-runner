import { describe, expect, it } from "bun:test";

import { createMockClient } from "../../infra/client/__tests__/mock-client.js";
import { formatDoctorReport } from "../../infra/client/format.js";
import type { DoctorReport, DoctorStatus } from "../../infra/daemon/protocol.js";
import * as doctor from "./doctor.js";

function makeStream() {
  const chunks: string[] = [];
  return { chunks, write: (s: string) => chunks.push(s) };
}

function makeReport(overrides: Partial<DoctorReport> = {}): DoctorReport {
  const ok: DoctorStatus = "ok";
  return {
    socket: { status: ok },
    lockfile: { status: ok },
    activeRuns: { status: ok, count: 0 },
    agentSubprocesses: { status: ok, count: 0 },
    diskUsageBytes: { status: ok, bytes: 0 },
    orphanPorts: { status: ok, count: 0 },
    ...overrides,
  };
}

describe("doctor.run", () => {
  it("invokes daemon.doctor, pipes through formatDoctorReport, and returns 0 when all OK", async () => {
    const report = makeReport();
    const mock = createMockClient({
      responders: { "daemon.doctor": () => report },
    });
    const stdout = makeStream();
    const stderr = makeStream();

    const code = await doctor.run([], {
      connect: async () => mock.asClient(),
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    expect(mock.calls).toEqual([{ method: "daemon.doctor", params: {} }]);
    expect(stdout.chunks.join("")).toBe(formatDoctorReport(report) + "\n");
    expect(stderr.chunks.join("")).toBe("");
    expect(mock.closed).toBe(true);
  });

  it("returns 1 when any subsystem reports FAIL", async () => {
    const report = makeReport({
      diskUsageBytes: { status: "fail", bytes: 9_999_999_999 },
    });
    const mock = createMockClient({
      responders: { "daemon.doctor": () => report },
    });
    const stdout = makeStream();
    const stderr = makeStream();

    const code = await doctor.run([], {
      connect: async () => mock.asClient(),
      stdout,
      stderr,
    });

    expect(code).toBe(1);
    expect(stdout.chunks.join("")).toBe(formatDoctorReport(report) + "\n");
    expect(stderr.chunks.join("")).toBe("");
    expect(mock.closed).toBe(true);
  });

  it("returns 0 on WARN-only reports (WARN is non-failing per V1)", async () => {
    const report = makeReport({
      agentSubprocesses: { status: "warn", count: 12 },
    });
    const mock = createMockClient({
      responders: { "daemon.doctor": () => report },
    });
    const stdout = makeStream();
    const stderr = makeStream();

    const code = await doctor.run([], {
      connect: async () => mock.asClient(),
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    expect(stdout.chunks.join("")).toBe(formatDoctorReport(report) + "\n");
  });

  it("flags FAIL in any individual subsystem (socket, lockfile, activeRuns, orphanPorts)", async () => {
    const subsystems: Array<Partial<DoctorReport>> = [
      { socket: { status: "fail" } },
      { lockfile: { status: "fail", detail: "stale pid 99" } },
      { activeRuns: { status: "fail", count: 1000 } },
      { orphanPorts: { status: "fail", count: 3 } },
    ];
    for (const partial of subsystems) {
      const report = makeReport(partial);
      const mock = createMockClient({
        responders: { "daemon.doctor": () => report },
      });
      const code = await doctor.run([], {
        connect: async () => mock.asClient(),
        stdout: makeStream(),
        stderr: makeStream(),
      });
      expect(code).toBe(1);
    }
  });

  it("on connection failure: prints the error and returns 1", async () => {
    const stdout = makeStream();
    const stderr = makeStream();
    const code = await doctor.run([], {
      connect: async () => {
        throw new Error("daemon unreachable");
      },
      stdout,
      stderr,
    });
    expect(code).toBe(1);
    expect(stderr.chunks.join("")).toContain("daemon unreachable");
  });

  it("returns 1 if daemon.doctor throws", async () => {
    const mock = createMockClient({
      responders: {
        "daemon.doctor": () => {
          throw new Error("kaboom");
        },
      },
    });
    const stdout = makeStream();
    const stderr = makeStream();
    const code = await doctor.run([], {
      connect: async () => mock.asClient(),
      stdout,
      stderr,
    });
    expect(code).toBe(1);
    expect(stderr.chunks.join("")).toContain("kaboom");
    expect(mock.closed).toBe(true);
  });

  it("rejects unexpected arguments without contacting the daemon", async () => {
    let connectCalls = 0;
    const stderr = makeStream();
    const code = await doctor.run(["--bogus"], {
      connect: async () => {
        connectCalls += 1;
        return createMockClient().asClient();
      },
      stdout: makeStream(),
      stderr,
    });
    expect(code).toBe(1);
    expect(connectCalls).toBe(0);
    expect(stderr.chunks.join("")).toContain("--bogus");
  });
});
