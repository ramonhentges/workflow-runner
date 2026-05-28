import { join } from "node:path";
import { homedir } from "node:os";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  writeSync,
  chmodSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import type { RunId, RunSnapshot, RunStatus } from "../../domain/run.js";

const SCHEMA_VERSION = 1;
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

type MetaJson = RunSnapshot & { schemaVersion: typeof SCHEMA_VERSION };

export interface RunStoreLogger {
  warn(message: string): void;
}

export class RunStoreError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RunStoreError";
  }
}

export interface RunStoreOptions {
  storageRoot?: string;
  logger?: RunStoreLogger;
}

export class RunStore {
  readonly storageRoot: string;
  readonly runsRoot: string;
  #logger: RunStoreLogger;

  constructor(options: RunStoreOptions = {}) {
    this.storageRoot = options.storageRoot ?? resolveStorageRoot();
    this.runsRoot = join(this.storageRoot, "runs");
    this.#logger = options.logger ?? console;
  }

  static resolveStorageRoot(env: NodeJS.ProcessEnv = process.env): string {
    return resolveStorageRoot(env);
  }

  async persist(snapshot: RunSnapshot): Promise<void> {
    this.#ensureRunsRoot();

    const runDir = this.#runDir(snapshot.id);
    ensurePrivateDir(runDir);

    const metaPath = this.#metaPath(snapshot.id);
    const tmpPath = this.#tmpPath(snapshot.id);
    const contents = `${JSON.stringify(toMetaJson(snapshot), null, 2)}\n`;

    let fd: number | undefined;
    try {
      fd = openSync(tmpPath, "w", FILE_MODE);
      writeSync(fd, contents);
      fsyncSync(fd);
    } catch (error) {
      throw new RunStoreError(`Failed to write run metadata at ${tmpPath}`, {
        cause: error,
      });
    } finally {
      if (fd !== undefined) {
        closeSync(fd);
      }
    }

    try {
      chmodSync(tmpPath, FILE_MODE);
      renameSync(tmpPath, metaPath);
      chmodSync(metaPath, FILE_MODE);
    } catch (error) {
      throw new RunStoreError(`Failed to install run metadata at ${metaPath}`, {
        cause: error,
      });
    }
  }

  async load(runId: RunId): Promise<RunSnapshot> {
    const metaPath = this.#metaPath(runId);
    const text = await readMetaText(metaPath);
    return parseMetaJson(metaPath, text);
  }

  async listAll(): Promise<RunSnapshot[]> {
    this.#ensureRunsRoot();

    const snapshots: RunSnapshot[] = [];
    for (const entry of readdirSync(this.runsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const metaPath = join(this.runsRoot, entry.name, "meta.json");
      try {
        const text = await readMetaText(metaPath);
        snapshots.push(parseMetaJson(metaPath, text));
      } catch (error) {
        this.#logger.warn(
          `Skipping run directory ${join(this.runsRoot, entry.name)}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return snapshots;
  }

  async discoverAndMarkOrphans(): Promise<RunSnapshot[]> {
    const snapshots = await this.listAll();
    const discovered: RunSnapshot[] = [];

    for (const snapshot of snapshots) {
      await this.#removeStrayTmp(snapshot.id);

      if (snapshot.status !== "running") {
        discovered.push(snapshot);
        continue;
      }

      const crashed: RunSnapshot = {
        ...snapshot,
        status: "crashed",
        endedAt: Date.now(),
        endReason: "daemon restart",
      };
      await this.persist(crashed);
      discovered.push(crashed);
    }

    return discovered;
  }

  #ensureRunsRoot(): void {
    ensurePrivateDir(this.storageRoot);
    ensurePrivateDir(this.runsRoot);
  }

  #runDir(runId: RunId): string {
    return join(this.runsRoot, runId);
  }

  #metaPath(runId: RunId): string {
    return join(this.#runDir(runId), "meta.json");
  }

  #tmpPath(runId: RunId): string {
    return join(this.#runDir(runId), "meta.json.tmp");
  }

  async #removeStrayTmp(runId: RunId): Promise<void> {
    await rm(this.#tmpPath(runId), { force: true });
  }
}

function resolveStorageRoot(env: NodeJS.ProcessEnv = process.env): string {
  const stateHome = env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
  return join(stateHome, "workflow-runner");
}

function ensurePrivateDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true, mode: DIR_MODE });
  }
  chmodSync(path, DIR_MODE);
}

async function readMetaText(metaPath: string): Promise<string> {
  try {
    return await Bun.file(metaPath).text();
  } catch (error) {
    throw new RunStoreError(`Failed to read run metadata at ${metaPath}`, {
      cause: error,
    });
  }
}

function toMetaJson(snapshot: RunSnapshot): MetaJson {
  return {
    schemaVersion: SCHEMA_VERSION,
    ...snapshot,
  };
}

function parseMetaJson(metaPath: string, text: string): RunSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new RunStoreError(`Malformed run metadata JSON at ${metaPath}`, {
      cause: error,
    });
  }

  if (!isRecord(parsed)) {
    throw new RunStoreError(`Malformed run metadata shape at ${metaPath}`);
  }

  if (parsed.schemaVersion !== SCHEMA_VERSION) {
    throw new RunStoreError(
      `Unsupported run metadata schemaVersion ${String(
        parsed.schemaVersion,
      )} at ${metaPath}`,
    );
  }

  validateSnapshotShape(metaPath, parsed);
  const { schemaVersion: _schemaVersion, ...snapshot } = parsed;
  return snapshot;
}

function validateSnapshotShape(
  metaPath: string,
  value: unknown,
): asserts value is MetaJson {
  if (!isRecord(value)) {
    throw new RunStoreError(`Malformed run metadata shape at ${metaPath}`);
  }

  const status = value.status;
  if (
    typeof value.id !== "string" ||
    typeof value.slug !== "string" ||
    typeof value.workflowPath !== "string" ||
    !isRunStatus(status) ||
    !isStepIdOrNull(value.currentStepId) ||
    !isStringArray(value.visitedStepIds) ||
    !isStringRecord(value.kickoffPrompts) ||
    typeof value.startedAt !== "number" ||
    (typeof value.endedAt !== "number" && value.endedAt !== null) ||
    (value.endReason !== undefined && typeof value.endReason !== "string")
  ) {
    throw new RunStoreError(`Malformed run metadata shape at ${metaPath}`);
  }

  if (status === "running" && value.endedAt !== null) {
    throw new RunStoreError(`Malformed running run metadata at ${metaPath}`);
  }
}

function isRunStatus(value: unknown): value is RunStatus {
  return (
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "crashed" ||
    value === "aborted"
  );
}

function isStepIdOrNull(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
