import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DiscoveryFileSchema, type DiscoveryFile } from "../../app/api/schema.js";
import { RunStore } from "../daemon/run-store.js";

/** Filename of the daemon discovery file written in the storage root. */
export const DISCOVERY_FILENAME = "daemon.json";

/**
 * Read and validate `<storageRoot>/daemon.json`. Returns the parsed discovery
 * record, or `null` when the file is missing or malformed (e.g. a half-written
 * file or a leftover from an older format).
 */
export function readDiscoveryFile(
  storageRoot: string = RunStore.resolveStorageRoot(),
): DiscoveryFile | null {
  let raw: unknown;
  try {
    const text = readFileSync(join(storageRoot, DISCOVERY_FILENAME), "utf8");
    raw = JSON.parse(text || "null");
  } catch {
    return null;
  }
  const parsed = DiscoveryFileSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** True when a process with the given pid is alive (and signalable by us). */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the discovery record of a *live* daemon, or `null` if no daemon is
 * recorded or the recorded process is no longer alive (stale discovery file).
 */
export function runningDaemon(
  storageRoot?: string,
): DiscoveryFile | null {
  const discovery = readDiscoveryFile(storageRoot);
  if (discovery && isProcessAlive(discovery.pid)) return discovery;
  return null;
}
