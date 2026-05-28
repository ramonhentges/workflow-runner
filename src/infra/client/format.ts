import { basename } from "node:path";

import type {
  DoctorReport,
  DoctorStatus,
  RunListEntry,
} from "../daemon/protocol.js";

const MS_PER_SEC = 1000;
const MS_PER_MIN = 60 * MS_PER_SEC;
const MS_PER_HOUR = 60 * MS_PER_MIN;
const MS_PER_DAY = 24 * MS_PER_HOUR;

export function formatDuration(ms: number): string {
  const v = Math.max(0, Math.floor(ms));
  if (v < MS_PER_MIN) {
    return `${Math.floor(v / MS_PER_SEC)}s`;
  }
  if (v < MS_PER_HOUR) {
    const m = Math.floor(v / MS_PER_MIN);
    const s = Math.floor((v % MS_PER_MIN) / MS_PER_SEC);
    return `${m}m${pad2(s)}s`;
  }
  if (v < MS_PER_DAY) {
    const h = Math.floor(v / MS_PER_HOUR);
    const m = Math.floor((v % MS_PER_HOUR) / MS_PER_MIN);
    return `${h}h${pad2(m)}m`;
  }
  const d = Math.floor(v / MS_PER_DAY);
  const h = Math.floor((v % MS_PER_DAY) / MS_PER_HOUR);
  return `${d}d ${h}h`;
}

const PS_HEADERS = [
  "RUN",
  "SLUG",
  "WORKFLOW",
  "STEP",
  "STATUS",
  "ELAPSED",
  "ATTACHED",
] as const;
const PS_SEP = "  ";

export function formatPsTable(rows: readonly RunListEntry[], now?: number): string {
  const sorted = [...rows].sort(compareForPs);
  const dataRows = sorted.map((r) => [
    r.id,
    r.slug,
    basename(r.workflowPath),
    r.currentStepId ?? "-",
    r.status,
    formatElapsed(r, now),
    r.attachedCount > 0 ? "●" : "",
  ]);

  const widths = PS_HEADERS.map((h, i) => {
    let w = h.length;
    for (const row of dataRows) {
      if (row[i].length > w) w = row[i].length;
    }
    return w;
  });

  const lines: string[] = [renderPsRow(PS_HEADERS, widths)];
  for (const row of dataRows) lines.push(renderPsRow(row, widths));
  return lines.join("\n");
}

export function formatDoctorReport(report: DoctorReport): string {
  const entries: Array<{ name: string; status: DoctorStatus; detail: string }> = [
    { name: "socket", status: report.socket.status, detail: "" },
    {
      name: "lockfile",
      status: report.lockfile.status,
      detail: report.lockfile.detail ?? "",
    },
    {
      name: "activeRuns",
      status: report.activeRuns.status,
      detail: `count=${report.activeRuns.count}`,
    },
    {
      name: "agentSubprocesses",
      status: report.agentSubprocesses.status,
      detail: `count=${report.agentSubprocesses.count}`,
    },
    {
      name: "diskUsageBytes",
      status: report.diskUsageBytes.status,
      detail: `bytes=${report.diskUsageBytes.bytes}`,
    },
    {
      name: "orphanPorts",
      status: report.orphanPorts.status,
      detail: `count=${report.orphanPorts.count}`,
    },
  ];
  const nameW = entries.reduce((m, e) => Math.max(m, e.name.length), 0);
  const statusW = 4; // "WARN"/"FAIL" width; "OK" pads to 4 for alignment
  return entries
    .map((e) => {
      const status = e.status.toUpperCase().padEnd(statusW);
      const tail = e.detail ? `  ${e.detail}` : "";
      return `${e.name.padEnd(nameW)}  ${status}${tail}`.trimEnd();
    })
    .join("\n");
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function isActive(status: RunListEntry["status"]): boolean {
  return status === "running";
}

function compareForPs(a: RunListEntry, b: RunListEntry): number {
  const aActive = isActive(a.status);
  const bActive = isActive(b.status);
  if (aActive !== bActive) return aActive ? -1 : 1;
  const aTs = a.endedAt ?? a.startedAt;
  const bTs = b.endedAt ?? b.startedAt;
  return bTs - aTs;
}

function formatElapsed(r: RunListEntry, now?: number): string {
  const end = r.endedAt ?? now ?? r.startedAt;
  return formatDuration(Math.max(0, end - r.startedAt));
}

function renderPsRow(cells: readonly string[], widths: readonly number[]): string {
  const last = cells.length - 1;
  return cells
    .map((c, i) => (i === last ? c : c.padEnd(widths[i])))
    .join(PS_SEP)
    .trimEnd();
}
