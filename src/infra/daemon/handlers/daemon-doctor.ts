import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { DoctorReport, DoctorStatus } from "../protocol.js";
import type { RunManager } from "../run-manager.js";
import type { RpcHandler } from "../rpc/server.js";
import { readLockfile, type LockfileStatus } from "../read-lockfile.js";

const SUBPROCESS_WARN_THRESHOLD = 8;
const DISK_WARN_THRESHOLD_BYTES = 1024 * 1024 * 1024; // 1 GB

export interface DaemonDoctorDeps {
  /**
   * Absolute path to the daemon storage root (contains `runs/`, `daemon.sock`,
   * and `daemon.lock`).
   */
  storageRoot: string;
  /** Counts currently active agent subprocesses (one per running run/step). */
  countActiveSubprocesses: () => number;
  /**
   * Counts ephemeral ports the daemon is holding that don't correspond to an
   * active run. V1 returns 0; integration with the per-run McpServer registry
   * happens once the daemon entry (task 11) is wired.
   */
  countOrphanPorts: () => number;
  /**
   * Optional override for the lockfile reader — wired by tests to inject a
   * deterministic LockfileStatus.
   */
  readLockfile?: (path: string) => Promise<LockfileStatus>;
  /**
   * Optional override for disk-usage measurement — wired by tests to inject a
   * deterministic byte total without touching the filesystem.
   */
  diskUsage?: (runsRoot: string) => Promise<number>;
}

export function createDaemonDoctorHandler(
  rm: RunManager,
  deps: DaemonDoctorDeps,
): RpcHandler<"daemon.doctor"> {
  const lockfilePath = join(deps.storageRoot, "daemon.lock");
  const runsRoot = join(deps.storageRoot, "runs");
  const readLock = deps.readLockfile ?? readLockfile;
  const measureDisk = deps.diskUsage ?? defaultDiskUsage;

  return async (): Promise<DoctorReport> => {
    // The fact that this handler was reached means the socket accepted us.
    const socket: { status: DoctorStatus } = { status: "ok" };

    const lockfile = lockfileSection(await readLock(lockfilePath));

    const activeRunCount = rm.list().filter((s) => s.status === "running").length;
    const activeRuns = { status: "ok" as DoctorStatus, count: activeRunCount };

    const subprocessCount = deps.countActiveSubprocesses();
    const agentSubprocesses = {
      status: (subprocessCount > SUBPROCESS_WARN_THRESHOLD ? "warn" : "ok") as
        DoctorStatus,
      count: subprocessCount,
    };

    const diskBytes = await measureDisk(runsRoot).catch(() => 0);
    const diskUsageBytes = {
      status: (diskBytes > DISK_WARN_THRESHOLD_BYTES ? "warn" : "ok") as
        DoctorStatus,
      bytes: diskBytes,
    };

    const orphanPortsCount = deps.countOrphanPorts();
    const orphanPorts = {
      status: (orphanPortsCount > 0 ? "warn" : "ok") as DoctorStatus,
      count: orphanPortsCount,
    };

    return {
      socket,
      lockfile,
      activeRuns,
      agentSubprocesses,
      diskUsageBytes,
      orphanPorts,
    };
  };
}

function lockfileSection(
  status: LockfileStatus,
): DoctorReport["lockfile"] {
  const section: DoctorReport["lockfile"] = {
    status: status.valid ? "ok" : "fail",
  };
  if (status.detail !== undefined) {
    section.detail = status.detail;
  }
  return section;
}

/**
 * Sums the size of every regular file under `runsRoot`, descending into
 * subdirectories. Missing directories return 0; unreadable entries are skipped.
 */
async function defaultDiskUsage(runsRoot: string): Promise<number> {
  let total = 0;
  const stack: string[] = [runsRoot];

  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true, encoding: "utf8" });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        try {
          total += (await stat(full)).size;
        } catch {}
      }
    }
  }

  return total;
}
