import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// In the bundled build, import.meta.url points to build/index.js, so the
// source-relative path ../daemon/entry.ts does not exist on disk. A second
// bundle (daemon-entry.js) is emitted next to the main bundle by the build
// script; prefer that when present so spawning works from either context.
function resolveDaemonEntry(): string {
  const bundled = fileURLToPath(new URL("./daemon-entry.js", import.meta.url));
  if (existsSync(bundled)) return bundled;
  return fileURLToPath(new URL("../daemon/entry.ts", import.meta.url));
}

/** Absolute path to the daemon entry, resolved once at module load. */
export const daemonEntryPath: string = resolveDaemonEntry();

export interface AutoSpawnOptions {
  storageRoot?: string;
  entryPath?: string;
  execPath?: string;
  stderr?: { write(chunk: string): unknown };
}

/**
 * Fork the daemon as a detached child process and return immediately.
 * Caller is responsible for polling the socket; the lockfile inside the daemon
 * prevents a second daemon from starting if one is already up.
 *
 * Prints `workflow-runner: starting daemon` to stderr exactly once per call.
 */
export function autoSpawnDaemon(opts: AutoSpawnOptions = {}): void {
  const entry = opts.entryPath ?? daemonEntryPath;
  const exec = opts.execPath ?? process.execPath;
  const stderr = opts.stderr ?? process.stderr;

  stderr.write("workflow-runner: starting daemon\n");

  const args = opts.storageRoot ? [entry, opts.storageRoot] : [entry];
  const child = spawn(exec, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}
