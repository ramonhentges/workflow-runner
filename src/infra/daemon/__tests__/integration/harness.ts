import { existsSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Subprocess } from "bun";

import { connect, type DaemonClient } from "../../../client/client.js";

const HARNESS_ENTRY = new URL("../../entry.ts", import.meta.url).pathname;
const DEFAULT_READY_TIMEOUT_MS = 10000;
const SOCKET_FILENAME = "daemon.sock";

export interface HarnessOptions {
  /** Additional env vars to set on the spawned daemon process. */
  env?: Record<string, string>;
  /** How long to wait for the daemon socket to appear before giving up. */
  readyTimeoutMs?: number;
}

export interface Harness {
  storageRoot: string;
  socketPath: string;
  daemon: Subprocess;
  client: DaemonClient;
  cleanup: () => Promise<void>;
}

/**
 * Spin up an isolated daemon process backed by a fresh temp `XDG_STATE_HOME`,
 * with the fixture session factory enabled, and return a connected
 * `DaemonClient` plus a `cleanup()` function the test must call in `afterEach`.
 *
 * `cleanup()` closes the client, signals the daemon, waits up to 2 s for it to
 * exit (escalating to SIGKILL), and removes the temp directory. It is safe to
 * call multiple times.
 */
export async function startDaemonHarness(opts: HarnessOptions = {}): Promise<Harness> {
  const tempDir = mkdtempSync(join(tmpdir(), "wfr-it-"));
  const storageRoot = join(tempDir, "workflow-runner");
  const socketPath = join(storageRoot, SOCKET_FILENAME);

  const daemon = Bun.spawn({
    cmd: ["bun", HARNESS_ENTRY],
    env: {
      ...process.env,
      NODE_ENV: "test",
      WORKFLOW_RUNNER_FAKE_FACTORY: "1",
      XDG_STATE_HOME: tempDir,
      ...opts.env,
    },
    stdout: "ignore",
    stderr: "pipe",
  });

  let client: DaemonClient | null = null;
  let cleanedUp = false;

  const cleanup = async (): Promise<void> => {
    if (cleanedUp) return;
    cleanedUp = true;
    try {
      await client?.close();
    } catch {}
    await stopDaemon(daemon);
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  };

  try {
    await waitForSocket(socketPath, opts.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS, daemon);
    client = await connect({ storageRoot });
    return { storageRoot, socketPath, daemon, client, cleanup };
  } catch (err) {
    await cleanup();
    throw err;
  }
}

async function waitForSocket(
  socketPath: string,
  timeoutMs: number,
  daemon: Subprocess,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(socketPath)) return;
    if (daemon.exitCode !== null) {
      throw new Error(
        `daemon exited prematurely with code ${daemon.exitCode} before socket ${socketPath} appeared`,
      );
    }
    await sleep(25);
  }
  throw new Error(`daemon socket ${socketPath} did not appear within ${timeoutMs}ms`);
}

async function stopDaemon(daemon: Subprocess): Promise<void> {
  if (daemon.exitCode !== null) return;
  try {
    daemon.kill("SIGTERM");
  } catch {}
  const exited = await Promise.race([
    daemon.exited.then(() => true),
    sleep(2000).then(() => false),
  ]);
  if (!exited) {
    try {
      daemon.kill("SIGKILL");
    } catch {}
    await daemon.exited.catch(() => {});
  }
}

export async function killDaemon(daemon: Subprocess, signal: "SIGKILL" | "SIGTERM" = "SIGKILL"): Promise<void> {
  if (daemon.exitCode !== null) return;
  try {
    daemon.kill(signal);
  } catch {}
  await daemon.exited.catch(() => {});
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll an async predicate until it returns truthy or the deadline elapses.
 * Returns the predicate's last truthy value, or throws on timeout.
 */
export async function waitFor<T>(
  predicate: () => Promise<T | null | undefined> | T | null | undefined,
  opts: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const intervalMs = opts.intervalMs ?? 25;
  const deadline = Date.now() + timeoutMs;
  let last: T | null | undefined;
  while (Date.now() < deadline) {
    last = await predicate();
    if (last) return last;
    await sleep(intervalMs);
  }
  throw new Error(
    `waitFor${opts.label ? ` (${opts.label})` : ""} timed out after ${timeoutMs}ms`,
  );
}

export interface FakeStep {
  id: string;
  description: string;
  mode?: "interactive" | "autonomous";
  edges?: Array<{ next_step: string; intent?: string }>;
}

/**
 * Write a minimal valid workflow JSON file under `dir` for use with the
 * fixture session factory. Returns the absolute path.
 */
export async function writeFakeWorkflow(
  dir: string,
  id: string,
  steps: FakeStep[],
): Promise<string> {
  const json = {
    id,
    name: id,
    description: id,
    version: "1",
    steps: steps.map((s) => ({
      id: s.id,
      agent: "fake-agent/AGENT",
      model: "fake/model",
      mode: s.mode ?? "autonomous",
      ide: "fake",
      description: s.description,
      edges: (s.edges ?? []).map((e) => ({
        next_step: e.next_step,
        intent: e.intent ?? "",
      })),
    })),
  };

  const path = join(dir, `${id}.json`);
  await Bun.write(path, JSON.stringify(json, null, 2));
  return path;
}
