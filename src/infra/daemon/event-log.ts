import { existsSync } from "node:fs";
import {
  mkdir,
  open,
  readdir,
  rename,
  stat,
  type FileHandle,
} from "node:fs/promises";
import { join } from "node:path";
import type { StepId } from "../../domain/ids.js";
import type { RunnerEvent } from "../../domain/runner.js";

export const EVENT_LOG_RING_LIMIT = 1000;
export const EVENT_LOG_ROTATE_BYTES = 50 * 1024 * 1024;
export const EVENT_LOG_BACKLOG_LIMIT = 10000;

const ACTIVE_LOG = "events.jsonl";
const ROTATED_LOG_PATTERN = /^events\.(\d+)\.jsonl$/;

export interface EventLogEntry {
  seq: number;
  ts: number;
  stepId: StepId | null;
  event: RunnerEvent;
}

export interface ReadEventsSinceResult {
  entries: EventLogEntry[];
  truncated: boolean;
}

export class EventLogError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "EventLogError";
  }
}

export class EventLogWriteError extends EventLogError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "EventLogWriteError";
  }
}

export class EventLogReadError extends EventLogError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "EventLogReadError";
  }
}

export class EventLog {
  readonly runDir: string;

  #activePath: string;
  #handle: FileHandle;
  #lastSeq: number;
  #ring: EventLogEntry[];
  #closed = false;
  #writeChain: Promise<void> = Promise.resolve();
  #activeBytes: number;
  #rotateBytes: number;

  private constructor(args: {
    runDir: string;
    activePath: string;
    handle: FileHandle;
    lastSeq: number;
    activeBytes: number;
    rotateBytes: number;
  }) {
    this.runDir = args.runDir;
    this.#activePath = args.activePath;
    this.#handle = args.handle;
    this.#lastSeq = args.lastSeq;
    this.#ring = [];
    this.#activeBytes = args.activeBytes;
    this.#rotateBytes = args.rotateBytes;
  }

  static async open(runDir: string, rotateBytes = EVENT_LOG_ROTATE_BYTES): Promise<EventLog> {
    try {
      await mkdir(runDir, { recursive: true, mode: 0o700 });
      const activePath = join(runDir, ACTIVE_LOG);
      const lastSeq = await highestExistingSeq(runDir);
      const handle = await open(activePath, "a", 0o600);
      const activeBytes = await activeLogSize(activePath);
      return new EventLog({ runDir, activePath, handle, lastSeq, activeBytes, rotateBytes });
    } catch (error) {
      throw new EventLogWriteError(`Failed to open event log in ${runDir}`, {
        cause: error,
      });
    }
  }

  async append(
    event: RunnerEvent,
    stepId: StepId | null,
  ): Promise<EventLogEntry | null> {
    this.#assertOpen();

    if (event.type === "stream" && event.kind === "thought") {
      return null;
    }

    const write = this.#writeChain.then(() => this.#appendPersisted(event, stepId));
    this.#writeChain = write.then(
      () => {},
      () => {},
    );
    return write;
  }

  async #appendPersisted(
    event: RunnerEvent,
    stepId: StepId | null,
  ): Promise<EventLogEntry> {
    this.#assertOpen();
    await this.#rotateIfNeeded();

    const entry: EventLogEntry = {
      seq: this.#lastSeq + 1,
      ts: Date.now(),
      stepId,
      event,
    };

    const line = `${JSON.stringify(entry)}\n`;
    try {
      await this.#handle.write(line);
      await this.#handle.sync();
    } catch (error) {
      throw new EventLogWriteError(
        `Failed to append event log entry to ${this.#activePath}`,
        { cause: error },
      );
    }

    this.#activeBytes += Buffer.byteLength(line);
    this.#lastSeq = entry.seq;
    this.#appendToRing(entry);
    return entry;
  }

  currentStepBacklog(currentStepId: StepId): EventLogEntry[] | null {
    const bannerIndex = findLastBannerIndex(this.#ring, currentStepId);
    if (bannerIndex === -1) {
      return null;
    }
    return this.#ring.slice(bannerIndex);
  }

  async readBackwardForCurrentStep(
    currentStepId: StepId,
  ): Promise<EventLogEntry[]> {
    this.#assertOpen();

    const files = await logFilesNewestFirst(this.runDir);
    const suffix: EventLogEntry[] = [];

    for (const file of files) {
      const entries = await readEntries(file.path);
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i]!;
        if (isBannerForStep(entry, currentStepId)) {
          return entries.slice(i).concat(suffix);
        }
      }
      suffix.unshift(...entries);
    }

    return [];
  }

  async readEventsSince(fromSeq: number): Promise<ReadEventsSinceResult> {
    this.#assertOpen();

    // Fast path: if fromSeq is within the ring, return just the ring entries.
    // Ring has at most 1000 entries, so this avoids disk I/O for common reconnect case.
    // Only use fast path if ring's oldest entry is at or before fromSeq (ring covers the range).
    if (this.#ring.length > 0 && this.#ring[0]!.seq <= fromSeq + 1) {
      return { entries: this.#ring.filter(e => e.seq > fromSeq), truncated: false };
    }

    const files = await logFilesOldestFirst(this.runDir);
    const result: EventLogEntry[] = [];
    let canAppendAllRemaining = false;

    for (const file of files) {
      const entries = await readEntries(file.path);

      if (entries.length === 0) {
        continue;
      }

      // Skip files where all entries are older than fromSeq.
      if (entries[entries.length - 1]!.seq <= fromSeq) {
        continue;
      }

      // Once this file's first entry > fromSeq, all subsequent files also > fromSeq
      // (since seq is monotonic across files and files are ordered).
      if (entries[0]!.seq > fromSeq) {
        canAppendAllRemaining = true;
      }

      if (canAppendAllRemaining) {
        result.push(...entries);
      } else {
        // This file spans the boundary; filter entry-by-entry.
        for (const entry of entries) {
          if (entry.seq > fromSeq) {
            result.push(entry);
          }
        }
      }

      // Hard cap: prevent OOM on extreme disconnects. Signal truncation to caller.
      if (result.length >= EVENT_LOG_BACKLOG_LIMIT) {
        return { entries: result, truncated: true };
      }
    }

    return { entries: result, truncated: false };
  }

  async flush(): Promise<void> {
    await this.#writeChain;
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }

    try {
      await this.#writeChain;
      await this.#handle.sync();
      await this.#handle.close();
      this.#closed = true;
    } catch (error) {
      throw new EventLogWriteError(`Failed to close event log ${this.#activePath}`, {
        cause: error,
      });
    }
  }

  async #rotateIfNeeded(): Promise<void> {
    if (this.#activeBytes <= this.#rotateBytes) {
      return;
    }

    try {
      await this.#handle.sync();

      const rotatedPath = await nextRotatedPath(this.runDir);
      await rename(this.#activePath, rotatedPath);
      await this.#handle.close();
      this.#handle = await open(this.#activePath, "a", 0o600);
      this.#activeBytes = 0;
    } catch (error) {
      throw new EventLogWriteError(`Failed to rotate event log ${this.#activePath}`, {
        cause: error,
      });
    }
  }

  #appendToRing(entry: EventLogEntry): void {
    if (entry.event.type === "banner") {
      this.#ring = [];
    }

    this.#ring.push(entry);
    while (this.#ring.length > EVENT_LOG_RING_LIMIT) {
      this.#ring.shift();
    }
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new EventLogWriteError(`Event log is closed: ${this.#activePath}`);
    }
  }
}

async function activeLogSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return 0;
    }
    throw error;
  }
}

async function highestExistingSeq(runDir: string): Promise<number> {
  const files = await logFilesOldestFirst(runDir);
  let highest = 0;

  for (const file of files) {
    for (const entry of await readEntries(file.path)) {
      highest = Math.max(highest, entry.seq);
    }
  }

  return highest;
}

async function readEntries(path: string): Promise<EventLogEntry[]> {
  let text: string;
  try {
    text = await Bun.file(path).text();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw new EventLogReadError(`Failed to read event log ${path}`, {
      cause: error,
    });
  }

  const entries: EventLogEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new EventLogReadError(`Malformed event log JSON in ${path}`, {
        cause: error,
      });
    }

    if (!isEventLogEntry(parsed)) {
      throw new EventLogReadError(`Malformed event log entry in ${path}`);
    }
    entries.push(parsed);
  }

  return entries;
}

async function logFilesNewestFirst(runDir: string): Promise<LogFile[]> {
  return (await logFilesOldestFirst(runDir)).reverse();
}

async function logFilesOldestFirst(runDir: string): Promise<LogFile[]> {
  const files: LogFile[] = [];

  let entries: string[];
  try {
    entries = await readdir(runDir);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw new EventLogReadError(`Failed to list event log directory ${runDir}`, {
      cause: error,
    });
  }

  for (const entry of entries) {
    if (entry === ACTIVE_LOG) {
      files.push({ path: join(runDir, entry), rotation: Number.POSITIVE_INFINITY });
      continue;
    }

    const match = ROTATED_LOG_PATTERN.exec(entry);
    if (match) {
      files.push({ path: join(runDir, entry), rotation: Number(match[1]) });
    }
  }

  files.sort((a, b) => a.rotation - b.rotation);
  return files;
}

async function nextRotatedPath(runDir: string): Promise<string> {
  const files = await logFilesOldestFirst(runDir);
  const maxRotation = files
    .map(f => f.rotation)
    .filter(r => Number.isFinite(r))
    .reduce((a, b) => Math.max(a, b), 0);
  return join(runDir, `events.${maxRotation + 1}.jsonl`);
}

function findLastBannerIndex(entries: EventLogEntry[], stepId: StepId): number {
  for (let index = entries.length - 1; index >= 0; index--) {
    if (isBannerForStep(entries[index]!, stepId)) {
      return index;
    }
  }
  return -1;
}

function isBannerForStep(entry: EventLogEntry, stepId: StepId): boolean {
  return (
    entry.event.type === "banner" &&
    (entry.stepId === stepId || entry.event.step.id === stepId)
  );
}

function isEventLogEntry(value: unknown): value is EventLogEntry {
  if (!isRecord(value)) {
    return false;
  }

  const seq = value.seq;
  return (
    typeof seq === "number" &&
    Number.isInteger(seq) &&
    seq > 0 &&
    typeof value.ts === "number" &&
    (typeof value.stepId === "string" || value.stepId === null) &&
    isRecord(value.event) &&
    typeof value.event.type === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

interface LogFile {
  path: string;
  rotation: number;
}
