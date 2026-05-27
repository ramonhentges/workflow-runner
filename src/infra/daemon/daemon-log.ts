import {
  mkdir,
  open,
  rename,
  stat,
  type FileHandle,
} from "node:fs/promises";
import { dirname } from "node:path";

const DEFAULT_ROTATE_BYTES = 10 * 1024 * 1024;
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

export type DaemonLogLevel = "INFO" | "WARN" | "ERROR";

export interface DaemonLogRecord {
  level: DaemonLogLevel;
  event: string;
  [key: string]: unknown;
}

export interface DaemonLoggerOptions {
  /** Rotation threshold in bytes. Defaults to 10 MB. */
  rotateBytes?: number;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

/**
 * Append-only JSON-lines logger with a single rotation slot.
 *
 * When the live file would exceed `rotateBytes`, the existing file is renamed
 * to `<path>.1` (replacing any prior rotation) before the new line is written.
 * Failures are swallowed: the daemon must keep serving even when the log
 * partition is full or read-only.
 *
 * All disk I/O is async; writes are serialized through `#writeChain` so
 * callers can fire-and-forget `log()` without blocking the event loop.
 */
export class DaemonLogger {
  readonly #path: string;
  readonly #rotateBytes: number;
  readonly #now: () => number;
  #handle: FileHandle | null = null;
  #bytes = 0;
  #closed = false;
  #writeChain: Promise<void> = Promise.resolve();

  private constructor(path: string, options: DaemonLoggerOptions = {}) {
    this.#path = path;
    this.#rotateBytes = options.rotateBytes ?? DEFAULT_ROTATE_BYTES;
    this.#now = options.now ?? Date.now;
  }

  static async open(path: string, options: DaemonLoggerOptions = {}): Promise<DaemonLogger> {
    const logger = new DaemonLogger(path, options);
    try {
      await mkdir(dirname(path), { recursive: true, mode: DIR_MODE });
    } catch {}
    await logger.#openHandle();
    return logger;
  }

  log(record: DaemonLogRecord): void {
    if (this.#closed) return;
    const line = JSON.stringify({ ts: this.#now(), ...record }) + "\n";
    const buf = Buffer.from(line, "utf8");
    const write = this.#writeChain.then(() => this.#writeOne(buf));
    this.#writeChain = write.then(() => {}, () => {});
  }

  /** Drain pending writes, fsync, and close the live log handle. Safe to call multiple times. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#writeChain;
    if (this.#handle !== null) {
      try {
        await this.#handle.sync();
      } catch {}
      try {
        await this.#handle.close();
      } catch {}
      this.#handle = null;
    }
  }

  /** Current byte count of the live log (for tests). */
  get bytesWritten(): number {
    return this.#bytes;
  }

  async #openHandle(): Promise<void> {
    try {
      this.#handle = await open(this.#path, "a", FILE_MODE);
      try {
        this.#bytes = (await stat(this.#path)).size;
      } catch {
        this.#bytes = 0;
      }
    } catch {
      this.#handle = null;
    }
  }

  async #writeOne(buf: Buffer): Promise<void> {
    if (this.#handle === null) return;

    if (this.#bytes + buf.byteLength > this.#rotateBytes) {
      await this.#rotate();
    }

    if (this.#handle === null) return;
    try {
      await this.#handle.write(buf);
      this.#bytes += buf.byteLength;
    } catch {}
  }

  async #rotate(): Promise<void> {
    if (this.#handle !== null) {
      try {
        await this.#handle.close();
      } catch {}
      this.#handle = null;
    }
    try {
      await rename(this.#path, `${this.#path}.1`);
    } catch {}
    this.#bytes = 0;
    await this.#openHandle();
  }
}
