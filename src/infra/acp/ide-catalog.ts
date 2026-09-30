import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import { Writable, Readable } from "node:stream";
import {
  methods,
  ndJsonStream,
  type ClientConnection,
} from "@agentclientprotocol/sdk";
import { createAcpClientApp } from "./acp-client.js";
import {
  resolveIdeProfile,
  availableModeIds,
  availableModelOptions,
} from "./ide-profiles.js";
import { UnknownIdeError } from "./ide-profile.js";

export interface IdeCatalogEntry {
  id: string;
  name: string;
}

export interface IdeCatalog {
  reachable: boolean;
  agents: IdeCatalogEntry[];
  models: IdeCatalogEntry[];
  reason?: string;
}

type SpawnFn = (
  cmd: string,
  args: string[],
  opts: SpawnOptions,
) => ChildProcess;

export async function probeIdeCatalog(
  ide: string,
  cwd: string,
  opts?: { timeoutMs?: number; spawnFn?: SpawnFn },
): Promise<IdeCatalog> {
  // Throws UnknownIdeError before entering try/catch — intentional.
  const profile = resolveIdeProfile(ide);

  const timeoutMs = opts?.timeoutMs ?? 10_000;
  const spawnFn = opts?.spawnFn ?? spawn;

  let agentProcess: ChildProcess | null = null;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  async function runProbe(): Promise<IdeCatalog> {
    agentProcess = spawnFn(profile.spawn.command, profile.spawn.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...globalThis.process.env, ...profile.spawn.env },
    });

    await new Promise<void>((resolve, reject) => {
      agentProcess!.once("error", (err) =>
        reject(
          new Error(
            `Failed to spawn '${profile.spawn.command}': ${String(err)}`,
          ),
        ),
      );
      agentProcess!.once("spawn", resolve);
    });

    const writable = Writable.toWeb(
      agentProcess.stdin!,
    ) as WritableStream<Uint8Array>;
    const readable = Readable.toWeb(
      agentProcess.stdout!,
    ) as ReadableStream<Uint8Array>;
    const stream = ndJsonStream(writable, readable);

    const app = createAcpClientApp({
      requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
    });

    const connection: ClientConnection = app.connect(stream);

    await connection.agent.request(methods.agent.initialize, {
      protocolVersion: 1,
      clientCapabilities: {},
    });

    const sessionResult = await connection.agent.request(
      methods.agent.session.new,
      { cwd, mcpServers: [] },
    );

    const standardModes = sessionResult.modes?.availableModes;
    const agents: IdeCatalogEntry[] =
      standardModes && standardModes.length > 0
        ? standardModes.map((m) => ({ id: m.id, name: m.name }))
        : availableModeIds(sessionResult).map((id) => ({ id, name: id }));

    const models: IdeCatalogEntry[] = availableModelOptions(sessionResult).map(
      ({ value, name }) => ({ id: value, name }),
    );

    return { reachable: true, agents, models };
  }

  const probePromise = runProbe();
  // Suppress potential unhandled rejection when timeout wins the race.
  probePromise.catch(() => {});

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error(`IDE probe timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([probePromise, timeoutPromise]);
  } catch (err) {
    if (err instanceof UnknownIdeError) throw err;
    return {
      reachable: false,
      agents: [],
      models: [],
      reason: String(err),
    };
  } finally {
    clearTimeout(timeoutHandle);
    if (agentProcess !== null) {
      await disposeProcess(agentProcess).catch(() => {});
    }
  }
}

async function disposeProcess(proc: ChildProcess): Promise<void> {
  if (proc.exitCode !== null) return;

  await new Promise<void>((resolve) => {
    const onExit = () => resolve();
    proc.once("exit", onExit);

    let killed: boolean;
    try {
      killed = proc.kill("SIGTERM");
    } catch {
      proc.off("exit", onExit);
      resolve();
      return;
    }

    if (!killed) {
      // kill() returns false when the process is already gone.
      proc.off("exit", onExit);
      resolve();
      return;
    }

    const killTimer = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        // already gone
      }
    }, 500);

    proc.once("exit", () => clearTimeout(killTimer));
  });
}
