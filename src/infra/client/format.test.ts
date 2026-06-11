import { describe, expect, it } from "bun:test";

import { asStepId, type StepId } from "../../domain/ids.js";
import { asRunId, asRunSlug } from "../../domain/run.js";
import type { DoctorReport, RunListEntry } from "../daemon/protocol.js";
import { formatDoctorReport, formatDuration, formatPsTable } from "./format.js";

describe("formatDuration", () => {
  it("returns '0s' for 0", () => {
    expect(formatDuration(0)).toBe("0s");
  });

  it("returns '42s' for 42_000ms", () => {
    expect(formatDuration(42_000)).toBe("42s");
  });

  it("returns '3m12s' for 192_000ms", () => {
    expect(formatDuration(192_000)).toBe("3m12s");
  });

  it("zero-pads the seconds digit (1m05s)", () => {
    expect(formatDuration(65_000)).toBe("1m05s");
  });

  it("returns '1h04m' for 3_840_000ms (zero-padded minute)", () => {
    expect(formatDuration(3_840_000)).toBe("1h04m");
  });

  it("returns '2d 3h' for 183_600_000ms", () => {
    expect(formatDuration(183_600_000)).toBe("2d 3h");
  });

  it("clamps negative input to 0s", () => {
    expect(formatDuration(-1)).toBe("0s");
  });
});

function makeRow(overrides: Partial<RunListEntry> = {}): RunListEntry {
  return {
    id: asRunId("fk2a9xeh"),
    slug: asRunSlug("brave-otter"),
    workflowPath: "/abs/path/to/who-is.json",
    currentStepId: asStepId("step-2") as StepId,
    status: "running",
    startedAt: 1_000_000,
    endedAt: null,
    attachedCount: 1,
    ...overrides,
  };
}

describe("formatPsTable", () => {
  it("returns a header-only table when rows is empty", () => {
    const out = formatPsTable([]);
    const lines = out.split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("RUN");
    expect(lines[0]).toContain("SLUG");
    expect(lines[0]).toContain("WORKFLOW");
    expect(lines[0]).toContain("STEP");
    expect(lines[0]).toContain("STATUS");
    expect(lines[0]).toContain("ELAPSED");
    expect(lines[0]).toContain("ATTACHED");
  });

  it("renders header + 1 data row for a single running entry; shows ● when attached", () => {
    const out = formatPsTable([makeRow()], 1_000_000 + 192_000);
    const lines = out.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("fk2a9xeh");
    expect(lines[1]).toContain("brave-otter");
    expect(lines[1]).toContain("who-is.json");
    expect(lines[1]).toContain("step-2");
    expect(lines[1]).toContain("running");
    expect(lines[1]).toContain("3m12s");
    expect(lines[1]).toContain("●");
  });

  it("renders an empty ATTACHED cell when attachedCount is 0", () => {
    const out = formatPsTable([makeRow({ attachedCount: 0 })], 1_192_000);
    const lines = out.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).not.toContain("●");
  });

  it("sorts active runs before terminal-state runs even when input order is reversed", () => {
    const completed = makeRow({
      id: asRunId("aaaaaaaa"),
      slug: asRunSlug("calm-badger"),
      status: "completed",
      startedAt: 900_000,
      endedAt: 1_200_000,
      attachedCount: 0,
    });
    const running = makeRow({
      id: asRunId("bbbbbbbb"),
      slug: asRunSlug("brave-otter"),
      status: "running",
      startedAt: 500_000,
      endedAt: null,
      attachedCount: 1,
    });
    const out = formatPsTable([completed, running], 1_500_000);
    const lines = out.split("\n");
    expect(lines[1]).toContain("brave-otter");
    expect(lines[2]).toContain("calm-badger");
  });

  it("shows only the workflow basename, not the full path", () => {
    const out = formatPsTable(
      [makeRow({ workflowPath: "/deeply/nested/dir/who-is.json" })],
      1_000_000,
    );
    expect(out).toContain("who-is.json");
    expect(out).not.toContain("/deeply");
    expect(out).not.toContain("nested");
  });

  it("keeps each row under 80 visible columns for typical inputs", () => {
    const rows: RunListEntry[] = [
      makeRow({
        id: asRunId("fk2a9xeh"),
        slug: asRunSlug("brave-otter"),
        workflowPath: "/x/who-is.json",
        currentStepId: asStepId("step-2"),
        status: "running",
        attachedCount: 1,
      }),
      makeRow({
        id: asRunId("8x3kmn4p"),
        slug: asRunSlug("wise-fox"),
        workflowPath: "/x/feature-a.json",
        currentStepId: asStepId("step-1"),
        status: "running",
        attachedCount: 0,
      }),
      makeRow({
        id: asRunId("2j5q8nx9"),
        slug: asRunSlug("calm-badger"),
        workflowPath: "/x/quick-task.json",
        currentStepId: asStepId("step-3"),
        status: "completed",
        startedAt: 800_000,
        endedAt: 1_062_000,
        attachedCount: 0,
      }),
    ];
    const out = formatPsTable(rows, 1_192_000);
    for (const line of out.split("\n")) {
      expect(line.length).toBeLessThan(80);
    }
  });

  it("renders '-' when currentStepId is null", () => {
    const out = formatPsTable([makeRow({ currentStepId: null })], 1_000_000);
    expect(out.split("\n")[1]).toContain("-");
  });

  it("uses endedAt for terminal-state elapsed and ignores `now`", () => {
    const row = makeRow({
      status: "completed",
      startedAt: 0,
      endedAt: 42_000,
      attachedCount: 0,
    });
    const out = formatPsTable([row], 9_999_999);
    expect(out).toContain("42s");
  });

  it("is stable byte-for-byte for the same input", () => {
    const rows = [makeRow()];
    expect(formatPsTable(rows, 1_192_000)).toBe(formatPsTable(rows, 1_192_000));
  });

  it("renders a branch/worktree continuation line for an isolated run", () => {
    const out = formatPsTable(
      [
        makeRow({
          branch: "feature-x",
          worktreePath: "/repos/myapp-feature-x",
        }),
      ],
      1_192_000,
    );
    const lines = out.split("\n");
    // header + row + continuation line
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("brave-otter");
    // The branch/worktree do not become new columns on the primary row.
    expect(lines[1]).not.toContain("feature-x");
    expect(lines[2]).toContain("feature-x");
    expect(lines[2]).toContain("/repos/myapp-feature-x");
  });

  it("leaves a non-isolated row unchanged (no continuation line)", () => {
    const isolated = makeRow({
      id: asRunId("aaaaaaaa"),
      slug: asRunSlug("iso-otter"),
      status: "running",
      startedAt: 900_000,
      branch: "feature-x",
      worktreePath: "/repos/myapp-feature-x",
    });
    const plain = makeRow({
      id: asRunId("bbbbbbbb"),
      slug: asRunSlug("plain-fox"),
      status: "running",
      startedAt: 500_000,
    });
    const out = formatPsTable([isolated, plain], 1_500_000);
    const lines = out.split("\n");
    // header + isolated row + its continuation line + plain row (no continuation)
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain("iso-otter");
    expect(lines[2]).toContain("feature-x");
    expect(lines[3]).toContain("plain-fox");
    expect(lines[3]).not.toContain("↳");
  });
});

function okReport(): DoctorReport {
  return {
    socket: { status: "ok" },
    lockfile: { status: "ok" },
    activeRuns: { status: "ok", count: 2 },
    agentSubprocesses: { status: "ok", count: 1 },
    diskUsageBytes: { status: "ok", bytes: 12_345 },
    orphanPorts: { status: "ok", count: 0 },
  };
}

describe("formatDoctorReport", () => {
  it("produces one block per subsystem with OK markers", () => {
    const out = formatDoctorReport(okReport());
    const lines = out.split("\n");
    expect(lines).toHaveLength(6);
    expect(lines[0]).toContain("socket");
    expect(lines[0]).toContain("OK");
    expect(lines[1]).toContain("lockfile");
    expect(lines[1]).toContain("OK");
    expect(lines[2]).toContain("activeRuns");
    expect(lines[2]).toContain("OK");
    expect(lines[3]).toContain("agentSubprocesses");
    expect(lines[4]).toContain("diskUsageBytes");
    expect(lines[5]).toContain("orphanPorts");
  });

  it("includes WARN marker and the supplied detail text", () => {
    const report: DoctorReport = {
      ...okReport(),
      lockfile: { status: "warn", detail: "pid 1234 not running" },
    };
    const out = formatDoctorReport(report);
    const lockfileLine = out.split("\n").find((l) => l.startsWith("lockfile"));
    expect(lockfileLine).toBeDefined();
    expect(lockfileLine!).toContain("WARN");
    expect(lockfileLine!).toContain("pid 1234 not running");
  });

  it("renders FAIL for a failing subsystem", () => {
    const report: DoctorReport = {
      ...okReport(),
      socket: { status: "fail" },
    };
    const out = formatDoctorReport(report);
    expect(out.split("\n")[0]).toContain("FAIL");
  });

  it("includes numeric details for count-bearing subsystems", () => {
    const out = formatDoctorReport(okReport());
    expect(out).toContain("count=2");
    expect(out).toContain("count=1");
    expect(out).toContain("bytes=12345");
    expect(out).toContain("count=0");
  });

  it("is stable byte-for-byte for the same input", () => {
    expect(formatDoctorReport(okReport())).toBe(formatDoctorReport(okReport()));
  });
});
