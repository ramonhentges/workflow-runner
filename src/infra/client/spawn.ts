import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// In the bundled build, import.meta.url points to build/index.js, so the
// source-relative path ../daemon/entry.ts does not exist on disk. A second
// bundle (daemon-entry.js) is emitted next to the main bundle by the build
// script; prefer that when present so spawning works from either context.
//
// In a `bun build --compile` single binary neither file exists on disk (the
// sources are embedded), so resolveDaemonEntry returns null and the daemon is
// instead launched via the binary's own `daemon` subcommand (see autoSpawnDaemon).
function resolveDaemonEntry(): string | null {
  const bundled = fileURLToPath(new URL("./daemon-entry.js", import.meta.url));
  if (existsSync(bundled)) return bundled;
  const source = fileURLToPath(new URL("../daemon/entry.ts", import.meta.url));
  if (existsSync(source)) return source;
  return null;
}

/**
 * Absolute path to the daemon entry, or null when running as a compiled binary
 * (no entry file on disk — the daemon runs via the `daemon` subcommand instead).
 */
export const daemonEntryPath: string | null = resolveDaemonEntry();

export interface AutoSpawnOptions {
  storageRoot?: string;
  /** Daemon entry file, or null to spawn the compiled binary's `daemon` subcommand. */
  entryPath?: string | null;
  execPath?: string;
  stderr?: { write(chunk: string): unknown };
}

/**
 * Build the argv passed to the spawned daemon process.
 *
 * - With an entry file on disk (dev/bundled): `[entry, storageRoot?]`.
 * - Compiled binary (entry === null): re-invoke our own `daemon` subcommand,
 *   forwarding the explicit storage root via `--storage-root`.
 */
export function buildDaemonSpawnArgs(
  entry: string | null,
  storageRoot?: string,
): string[] {
  if (entry === null) {
    return storageRoot ? ["daemon", "--storage-root", storageRoot] : ["daemon"];
  }
  return storageRoot ? [entry, storageRoot] : [entry];
}

/**
 * Fork the daemon as a detached child process and return immediately.
 * Caller is responsible for polling the socket; the lockfile inside the daemon
 * prevents a second daemon from starting if one is already up.
 *
 * Prints `workflow-runner: starting daemon` to stderr exactly once per call.
 */
export function autoSpawnDaemon(opts: AutoSpawnOptions = {}): void {
  // Distinguish "not provided" (undefined → use module default) from an
  // explicit null (compiled-binary mode, used in tests).
  const entry = opts.entryPath !== undefined ? opts.entryPath : daemonEntryPath;
  const exec = opts.execPath ?? process.execPath;
  const stderr = opts.stderr ?? process.stderr;

  stderr.write("workflow-runner: starting daemon\n");

  const args = buildDaemonSpawnArgs(entry, opts.storageRoot);

  const child = spawn(exec, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}
