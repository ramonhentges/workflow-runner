import { describe, it, expect } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { probeIdeCatalog } from "./ide-catalog.js";
import { UnknownIdeError } from "./ide-profile.js";

// ---------------------------------------------------------------------------
// Fake process helpers
// ---------------------------------------------------------------------------

interface StubAcpOptions {
  modes?: { id: string; name: string }[];
  models?: { modelId: string; name: string }[];
  configOptions?: unknown[];
}

/**
 * Creates a fake ChildProcess that speaks ndjson ACP over its stdin/stdout.
 * It responds to `initialize` and `session/new` with canned results.
 */
function makeStubAcpProcess(opts: StubAcpOptions): {
  process: ChildProcess;
  killCalls: string[];
} {
  const stdinPipe = new PassThrough();
  const stdoutPipe = new PassThrough();
  const stderrPipe = new PassThrough();
  const killCalls: string[] = [];

  const proc = new EventEmitter() as unknown as ChildProcess;
  (proc as unknown as Record<string, unknown>).stdin = stdinPipe;
  (proc as unknown as Record<string, unknown>).stdout = stdoutPipe;
  (proc as unknown as Record<string, unknown>).stderr = stderrPipe;
  (proc as unknown as Record<string, unknown>).exitCode = null;
  (proc as unknown as Record<string, unknown>).kill = (signal?: string) => {
    const sig = signal ?? "SIGTERM";
    killCalls.push(sig);
    if ((proc as unknown as Record<string, unknown>).exitCode !== null)
      return false;
    (proc as unknown as Record<string, unknown>).exitCode = 0;
    setImmediate(() => (proc as unknown as EventEmitter).emit("exit", 0, sig));
    stdinPipe.destroy();
    stdoutPipe.push(null);
    return true;
  };

  // Parse and respond to incoming ndjson ACP requests.
  let buffer = "";
  stdinPipe.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed) as { id: unknown; method: string };
        let result: unknown;

        if (msg.method === "initialize") {
          result = { protocolVersion: 1, agentCapabilities: {} };
        } else if (msg.method === "session/new") {
          result = {
            sessionId: "stub-session-1",
            modes:
              opts.modes && opts.modes.length > 0
                ? {
                    availableModes: opts.modes,
                    currentModeId: opts.modes[0]?.id ?? "",
                  }
                : null,
            models:
              opts.models && opts.models.length > 0
                ? {
                    availableModels: opts.models,
                    currentModelId: opts.models[0]?.modelId ?? "",
                  }
                : null,
            configOptions: opts.configOptions ?? null,
          };
        }

        if (result !== undefined) {
          const response =
            JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\n";
          stdoutPipe.push(Buffer.from(response));
        }
      } catch {
        // ignore malformed input
      }
    }
  });

  setImmediate(() => (proc as unknown as EventEmitter).emit("spawn"));
  return { process: proc, killCalls };
}

/**
 * Creates a fake ChildProcess that emits an error after spawn starts,
 * simulating a missing binary or exec failure.
 */
function makeErrorProcess(err: Error): ChildProcess {
  const proc = new EventEmitter() as unknown as ChildProcess;
  (proc as unknown as Record<string, unknown>).stdin = null;
  (proc as unknown as Record<string, unknown>).stdout = new EventEmitter();
  (proc as unknown as Record<string, unknown>).stderr = new EventEmitter();
  (proc as unknown as Record<string, unknown>).exitCode = null;
  (proc as unknown as Record<string, unknown>).kill = () => false;
  setImmediate(() => (proc as unknown as EventEmitter).emit("error", err));
  return proc;
}

/**
 * Creates a fake ChildProcess that spawns but never writes to stdout,
 * simulating a hung or unresponsive IDE.
 */
function makeHangProcess(): { process: ChildProcess; killCalls: string[] } {
  const stdinPipe = new PassThrough();
  const stdoutPipe = new PassThrough();
  const stderrPipe = new PassThrough();
  const killCalls: string[] = [];

  const proc = new EventEmitter() as unknown as ChildProcess;
  (proc as unknown as Record<string, unknown>).stdin = stdinPipe;
  (proc as unknown as Record<string, unknown>).stdout = stdoutPipe;
  (proc as unknown as Record<string, unknown>).stderr = stderrPipe;
  (proc as unknown as Record<string, unknown>).exitCode = null;
  (proc as unknown as Record<string, unknown>).kill = (signal?: string) => {
    const sig = signal ?? "SIGTERM";
    killCalls.push(sig);
    if ((proc as unknown as Record<string, unknown>).exitCode !== null)
      return false;
    (proc as unknown as Record<string, unknown>).exitCode = 0;
    setImmediate(() => (proc as unknown as EventEmitter).emit("exit", 0, sig));
    stdinPipe.destroy();
    stdoutPipe.push(null);
    return true;
  };

  // Never write to stdoutPipe — the process "hangs".
  stdinPipe.resume(); // drain stdin to avoid backpressure

  setImmediate(() => (proc as unknown as EventEmitter).emit("spawn"));
  return { process: proc, killCalls };
}

function makeStubSpawnFn(stub: ChildProcess) {
  return (_cmd: string, _args: string[], _opts: SpawnOptions): ChildProcess =>
    stub;
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

describe("probeIdeCatalog", () => {
  it("returns reachable:true with mapped agents and models on a successful probe", async () => {
    const { process: stub } = makeStubAcpProcess({
      modes: [
        { id: "agent-1", name: "Agent One" },
        { id: "agent-2", name: "Agent Two" },
      ],
      models: [
        { modelId: "model-x", name: "Model X" },
        { modelId: "model-y", name: "Model Y" },
      ],
    });

    const result = await probeIdeCatalog("opencode", "/tmp", {
      spawnFn: makeStubSpawnFn(stub),
    });

    expect(result.reachable).toBe(true);
    expect(result.agents).toEqual([
      { id: "agent-1", name: "Agent One" },
      { id: "agent-2", name: "Agent Two" },
    ]);
    expect(result.models).toEqual([
      { id: "model-x", name: "Model X" },
      { id: "model-y", name: "Model Y" },
    ]);
    expect(result.reason).toBeUndefined();
  });

  it("disposes the subprocess after a successful probe", async () => {
    const { process: stub, killCalls } = makeStubAcpProcess({
      modes: [{ id: "a", name: "A" }],
      models: [],
    });

    await probeIdeCatalog("opencode", "/tmp", {
      spawnFn: makeStubSpawnFn(stub),
    });

    expect(killCalls.length).toBeGreaterThan(0);
  });

  it("returns reachable:false with a reason when spawnFn emits an error", async () => {
    const result = await probeIdeCatalog("opencode", "/tmp", {
      spawnFn: () => makeErrorProcess(new Error("ENOENT: no such file")),
    });

    expect(result.reachable).toBe(false);
    expect(result.agents).toEqual([]);
    expect(result.models).toEqual([]);
    expect(result.reason).toContain("ENOENT");
  });

  it("does not throw when spawnFn emits an error", async () => {
    await expect(
      probeIdeCatalog("opencode", "/tmp", {
        spawnFn: () => makeErrorProcess(new Error("exec error")),
      }),
    ).resolves.toMatchObject({ reachable: false });
  });

  it("returns reachable:false on timeout and kills the subprocess", async () => {
    const { process: stub, killCalls } = makeHangProcess();

    const result = await probeIdeCatalog("opencode", "/tmp", {
      spawnFn: makeStubSpawnFn(stub),
      timeoutMs: 50,
    });

    expect(result.reachable).toBe(false);
    expect(result.reason).toContain("timed out");
    expect(killCalls.length).toBeGreaterThan(0);
  });

  it("throws UnknownIdeError for an unknown ide id", async () => {
    await expect(
      probeIdeCatalog("ghost-ide", "/tmp"),
    ).rejects.toBeInstanceOf(UnknownIdeError);
  });

  it("throws UnknownIdeError and does not spawn for an unknown ide id", async () => {
    const spawnCalls: string[] = [];
    const spawnFn = (cmd: string): ChildProcess => {
      spawnCalls.push(cmd);
      return makeErrorProcess(new Error("should not reach"));
    };

    await expect(
      probeIdeCatalog("unknown-ide-xyz", "/tmp", { spawnFn }),
    ).rejects.toBeInstanceOf(UnknownIdeError);

    expect(spawnCalls).toHaveLength(0);
  });

  it("reads opencode-style configOptions mode advertisement via availableModeIds", async () => {
    // opencode does not advertise modes via the standard `modes` field;
    // instead it uses a `configOptions` entry with id/category "mode".
    const { process: stub } = makeStubAcpProcess({
      modes: [], // no standard modes field
      models: [],
      configOptions: [
        {
          type: "select",
          id: "mode",
          category: "mode",
          name: "Mode",
          currentValue: "claude-sonnet",
          options: [
            { value: "claude-sonnet", name: "Claude Sonnet" },
            { value: "claude-opus", name: "Claude Opus" },
          ],
        },
      ],
    });

    const result = await probeIdeCatalog("opencode", "/tmp", {
      spawnFn: makeStubSpawnFn(stub),
    });

    expect(result.reachable).toBe(true);
    expect(result.agents.map((a) => a.id)).toEqual([
      "claude-sonnet",
      "claude-opus",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Integration tests — end-to-end against a stub ndjson ACP process
// ---------------------------------------------------------------------------

describe("probeIdeCatalog (integration: stub ndjson process)", () => {
  it("full flow: initialize → newSession → agents+models returned → process disposed", async () => {
    const { process: stub, killCalls } = makeStubAcpProcess({
      modes: [
        { id: "default", name: "Default" },
        { id: "turbo", name: "Turbo" },
      ],
      models: [
        { modelId: "gpt-4o", name: "GPT-4o" },
        { modelId: "gpt-4", name: "GPT-4" },
      ],
    });

    const result = await probeIdeCatalog("opencode", "/workspace", {
      spawnFn: makeStubSpawnFn(stub),
    });

    expect(result.reachable).toBe(true);
    expect(result.agents).toHaveLength(2);
    expect(result.models).toHaveLength(2);
    expect(result.agents[0]).toEqual({ id: "default", name: "Default" });
    expect(result.models[0]).toEqual({ id: "gpt-4o", name: "GPT-4o" });

    // Subprocess must be disposed after the probe completes.
    expect(killCalls.length).toBeGreaterThan(0);
  });

  it("no agents or models returned when IDE advertises neither", async () => {
    const { process: stub } = makeStubAcpProcess({
      modes: [],
      models: [],
      configOptions: [],
    });

    const result = await probeIdeCatalog("claude-code", "/home/user", {
      spawnFn: makeStubSpawnFn(stub),
    });

    expect(result.reachable).toBe(true);
    expect(result.agents).toEqual([]);
    expect(result.models).toEqual([]);
  });

  it("subprocess is disposed even when the probe times out", async () => {
    const { process: stub, killCalls } = makeHangProcess();

    await probeIdeCatalog("opencode", "/tmp", {
      spawnFn: makeStubSpawnFn(stub),
      timeoutMs: 30,
    });

    expect(killCalls.length).toBeGreaterThan(0);
  });
});
