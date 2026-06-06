import { resolve } from "node:path";
import type { RunId, RunSnapshot } from "../../../domain/run.js";

/**
 * Returns the id of the active (running) run for the given workflow path,
 * or null if no such run exists. Only "running" status blocks; terminal
 * statuses (completed/failed/crashed/aborted) do not.
 *
 * `workflowPath` is expected to be an absolute, resolved path (the CRUD
 * handlers pass `resolveWorkflowFile(cwd, name)`). A stored snapshot path,
 * however, may be non-canonical: the CLI `start` command stores the path
 * exactly as the user typed it (e.g. the relative `workflows/who-is.json`),
 * so raw string equality would miss CLI-started runs and let a web delete or
 * rename disrupt a live run. Resolve the stored path against its `cwd` before
 * comparing so both sides are absolute. Absolute comparison stays correct
 * across projects: two projects' `workflows/x.json` resolve to distinct
 * absolute paths, so this introduces no false positives.
 *
 * Pure function — pass RunManager.list({ includeOldTerminal: true }) as snapshots.
 */
export function findActiveRunForWorkflow(
  snapshots: RunSnapshot[],
  workflowPath: string,
): RunId | null {
  for (const snap of snapshots) {
    if (snap.status !== "running") {
      continue;
    }
    const snapFile = resolve(snap.cwd ?? "", snap.workflowPath);
    if (snapFile === workflowPath) {
      return snap.id;
    }
  }
  return null;
}
