import { readFile } from "node:fs/promises";

export interface LockfileStatus {
  /** True iff the lockfile exists, parses as a valid PID, and the PID is alive. */
  valid: boolean;
  pid?: number;
  detail?: string;
}

/**
 * Reads the daemon lockfile and reports whether it represents a live owner.
 *
 * Returns:
 *  - `{valid: true, pid}` when the file exists and signal 0 to the PID succeeds.
 *  - `{valid: false, detail}` for any failure (missing file, malformed PID,
 *    dead PID, or permission denied).
 *
 * Never throws; the daemon-doctor handler always returns a doctor report.
 */
export async function readLockfile(path: string): Promise<LockfileStatus> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return { valid: false, detail: "lockfile missing" };
    }
    return {
      valid: false,
      detail: `lockfile unreadable: ${errorMessage(error)}`,
    };
  }

  const pid = Number.parseInt(text.trim(), 10);
  if (!Number.isFinite(pid) || pid <= 0) {
    return { valid: false, detail: "lockfile has malformed pid" };
  }

  try {
    process.kill(pid, 0);
    return { valid: true, pid };
  } catch (error) {
    if (isErrnoException(error) && error.code === "EPERM") {
      // The process exists but we cannot signal it — treat as live.
      return { valid: true, pid };
    }
    return { valid: false, pid, detail: "lockfile pid is dead" };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
