import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readLockfile } from "./read-lockfile.js";

describe("readLockfile", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "lockfile-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns valid=false when the lockfile is missing", async () => {
    const result = await readLockfile(join(dir, "missing.lock"));
    expect(result.valid).toBe(false);
    expect(result.detail).toContain("missing");
  });

  it("returns valid=true and the pid when the lockfile holds a live pid", async () => {
    const path = join(dir, "daemon.lock");
    await writeFile(path, String(process.pid));

    const result = await readLockfile(path);
    expect(result.valid).toBe(true);
    expect(result.pid).toBe(process.pid);
  });

  it("returns valid=false when the lockfile holds a malformed pid", async () => {
    const path = join(dir, "daemon.lock");
    await writeFile(path, "not-a-number\n");

    const result = await readLockfile(path);
    expect(result.valid).toBe(false);
    expect(result.detail).toContain("malformed");
  });

  it("returns valid=false when the lockfile pid is dead", async () => {
    const path = join(dir, "daemon.lock");
    // PID 999999 is virtually guaranteed to be unused on a fresh test host.
    await writeFile(path, "999999");

    const result = await readLockfile(path);
    expect(result.valid).toBe(false);
    expect(result.pid).toBe(999999);
    expect(result.detail).toContain("dead");
  });
});
