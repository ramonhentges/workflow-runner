import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { asStepId } from "../../domain/ids.js";
import {
  asRunId,
  asRunSlug,
  type RunId,
  type RunSnapshot,
} from "../../domain/run.js";
import { RunStore, RunStoreError } from "./run-store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("RunStore", () => {
  it("persists meta.json with schemaVersion 1 and mode 0600", async () => {
    const root = await tempRoot();
    const store = new RunStore({ storageRoot: root });
    const snapshot = snapshotFor("run12345");

    await store.persist(snapshot);

    const metaPath = join(root, "runs", "run12345", "meta.json");
    const meta = JSON.parse(await Bun.file(metaPath).text());
    expect(meta).toEqual({ schemaVersion: 1, ...snapshot });
    expect(mode(metaPath)).toBe(0o600);
  });

  it("round-trips persist followed by load", async () => {
    const root = await tempRoot();
    const store = new RunStore({ storageRoot: root });
    const snapshot = snapshotFor("run12345", {
      currentStepId: asStepId("step-1"),
      visitedStepIds: [asStepId("step-1")],
      kickoffPrompts: { "step-1": "prompt" },
    });

    await store.persist(snapshot);

    expect(await store.load(snapshot.id)).toEqual(snapshot);
  });

  it("round-trips worktreePath and branch through persist and load", async () => {
    const root = await tempRoot();
    const store = new RunStore({ storageRoot: root });
    const snapshot = snapshotFor("run12345", {
      cwd: "/repo",
      worktreePath: "/repo-feature",
      branch: "feature/x",
    });

    await store.persist(snapshot);

    const loaded = await store.load(snapshot.id);
    expect(loaded).toEqual(snapshot);
    expect(loaded.worktreePath).toBe("/repo-feature");
    expect(loaded.branch).toBe("feature/x");
  });

  it("throws a typed error naming the missing meta path", async () => {
    const root = await tempRoot();
    const store = new RunStore({ storageRoot: root });
    const id = asRunId("missing1");

    await expect(store.load(id)).rejects.toBeInstanceOf(RunStoreError);
    await expect(store.load(id)).rejects.toThrow(
      join(root, "runs", "missing1", "meta.json"),
    );
  });

  it("rejects unsupported schema versions with a typed error", async () => {
    const root = await tempRoot();
    const store = new RunStore({ storageRoot: root });
    const snapshot = snapshotFor("run12345");
    await writeMeta(root, snapshot.id, { schemaVersion: 2, ...snapshot });

    await expect(store.load(snapshot.id)).rejects.toBeInstanceOf(RunStoreError);
    await expect(store.load(snapshot.id)).rejects.toThrow(/schemaVersion 2/);
  });

  it("rejects malformed JSON with a typed error naming the file path", async () => {
    const root = await tempRoot();
    const store = new RunStore({ storageRoot: root });
    const id = asRunId("run12345");
    const metaPath = join(root, "runs", id, "meta.json");
    await mkdir(join(root, "runs", id), { recursive: true, mode: 0o700 });
    await writeFile(metaPath, "{not json", { mode: 0o600 });

    await expect(store.load(id)).rejects.toBeInstanceOf(RunStoreError);
    await expect(store.load(id)).rejects.toThrow(metaPath);
  });

  it("lists valid run snapshots and skips missing or malformed metadata with warnings", async () => {
    const root = await tempRoot();
    const warnings: string[] = [];
    const store = new RunStore({
      storageRoot: root,
      logger: { warn: (message) => warnings.push(message) },
    });
    const first = snapshotFor("run11111");
    const second = snapshotFor("run22222", { status: "completed", endedAt: 2 });
    await store.persist(first);
    await store.persist(second);
    await mkdir(join(root, "runs", "missing-meta"), {
      recursive: true,
      mode: 0o700,
    });
    await mkdir(join(root, "runs", "bad-meta"), {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(join(root, "runs", "bad-meta", "meta.json"), "{bad", {
      mode: 0o600,
    });

    const listed = await store.listAll();

    expect(
      listed.sort((a, b) => String(a.id).localeCompare(String(b.id))),
    ).toEqual([first, second]);
    expect(warnings).toHaveLength(2);
    expect(warnings.join("\n")).toContain("missing-meta");
    expect(warnings.join("\n")).toContain("bad-meta");
  });

  it("marks running snapshots as crashed on discovery and persists post-update state", async () => {
    const root = await tempRoot();
    const store = new RunStore({ storageRoot: root });
    const runningA = snapshotFor("run11111", { startedAt: 1 });
    const completed = snapshotFor("run22222", {
      status: "completed",
      startedAt: 1,
      endedAt: 2,
    });
    const runningB = snapshotFor("run33333", { startedAt: 1 });
    await store.persist(runningA);
    await store.persist(completed);
    await store.persist(runningB);

    const discovered = await store.discoverAndMarkOrphans();

    const byId = new Map(discovered.map((snapshot) => [snapshot.id, snapshot]));
    expect(byId.get(runningA.id)).toMatchObject({
      status: "crashed",
      endReason: "daemon restart",
    });
    expect(byId.get(runningB.id)).toMatchObject({
      status: "crashed",
      endReason: "daemon restart",
    });
    expect(byId.get(completed.id)).toEqual(completed);
    expect(byId.get(runningA.id)?.endedAt).toBeNumber();
    expect((await store.load(runningA.id)).status).toBe("crashed");
    expect((await store.load(runningB.id)).endReason).toBe("daemon restart");
  });

  it("does not change already-crashed runs when discovery is called twice", async () => {
    const root = await tempRoot();
    const store = new RunStore({ storageRoot: root });
    const running = snapshotFor("run11111", { startedAt: 1 });
    await store.persist(running);

    const first = (await store.discoverAndMarkOrphans())[0]!;
    const second = (await store.discoverAndMarkOrphans())[0]!;

    expect(second).toEqual(first);
  });

  it("creates storage and runs directories lazily with mode 0700", async () => {
    const root = await tempRoot();
    await rm(root, { recursive: true, force: true });
    const store = new RunStore({ storageRoot: root });

    await store.persist(snapshotFor("run12345"));

    expect(mode(root)).toBe(0o700);
    expect(mode(join(root, "runs"))).toBe(0o700);
    expect(mode(join(root, "runs", "run12345"))).toBe(0o700);
  });

  it("resolves storage root from XDG_STATE_HOME or the home fallback without mutating env", () => {
    expect(
      RunStore.resolveStorageRoot({
        XDG_STATE_HOME: "/tmp/state-home",
      } as NodeJS.ProcessEnv),
    ).toBe("/tmp/state-home/workflow-runner");

    expect(RunStore.resolveStorageRoot({} as NodeJS.ProcessEnv)).toMatch(
      /\/\.local\/state\/workflow-runner$/,
    );
  });

  it("ignores a stray meta.json.tmp file when loading", async () => {
    const root = await tempRoot();
    const store = new RunStore({ storageRoot: root });
    const snapshot = snapshotFor("run12345");
    await store.persist(snapshot);
    await writeFile(join(root, "runs", snapshot.id, "meta.json.tmp"), "{partial", {
      mode: 0o600,
    });

    expect(await store.load(snapshot.id)).toEqual(snapshot);
  });

  it("cleans stray meta.json.tmp files during discovery", async () => {
    const root = await tempRoot();
    const store = new RunStore({ storageRoot: root });
    const snapshot = snapshotFor("run12345", {
      status: "completed",
      endedAt: 2,
    });
    const tmpPath = join(root, "runs", snapshot.id, "meta.json.tmp");
    await store.persist(snapshot);
    await writeFile(tmpPath, "{partial", { mode: 0o600 });

    await store.discoverAndMarkOrphans();

    expect(existsSync(tmpPath)).toBe(false);
  });

  it("leaves meta.json absent when a child process crashes before rename", async () => {
    const root = await tempRoot();
    const id = "run12345";

    const subprocess = Bun.spawn(
      [
        "bun",
        "--eval",
        `
          import { mkdirSync, openSync, writeSync, fsyncSync } from "node:fs";
          import { join } from "node:path";
          const root = process.argv[1];
          const id = process.argv[2];
          const dir = join(root, "runs", id);
          mkdirSync(dir, { recursive: true, mode: 0o700 });
          const fd = openSync(join(dir, "meta.json.tmp"), "w", 0o600);
          writeSync(fd, "{partial");
          fsyncSync(fd);
          process.kill(process.pid, "SIGKILL");
        `,
        root,
        id,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );

    await subprocess.exited;

    const metaPath = join(root, "runs", id, "meta.json");
    expect(existsSync(metaPath)).toBe(false);
    expect(existsSync(join(root, "runs", id, "meta.json.tmp"))).toBe(true);
  });

  it("keeps previous valid meta.json when a child process crashes before rename", async () => {
    const root = await tempRoot();
    const store = new RunStore({ storageRoot: root });
    const snapshot = snapshotFor("run12345");
    await store.persist(snapshot);

    const subprocess = Bun.spawn(
      [
        "bun",
        "--eval",
        `
          import { openSync, writeSync, fsyncSync } from "node:fs";
          import { join } from "node:path";
          const root = process.argv[1];
          const id = process.argv[2];
          const fd = openSync(join(root, "runs", id, "meta.json.tmp"), "w", 0o600);
          writeSync(fd, "{partial");
          fsyncSync(fd);
          process.kill(process.pid, "SIGKILL");
        `,
        root,
        snapshot.id,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );

    await subprocess.exited;

    expect(await store.load(snapshot.id)).toEqual(snapshot);
  });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "workflow-runner-store-"));
  roots.push(root);
  return root;
}

function snapshotFor(
  id: string,
  overrides: Partial<RunSnapshot> = {},
): RunSnapshot {
  return {
    id: asRunId(id),
    slug: asRunSlug(`${id}-slug`),
    workflowPath: `/tmp/${id}.json`,
    status: "running",
    currentStepId: null,
    visitedStepIds: [],
    kickoffPrompts: {},
    startedAt: 1,
    endedAt: null,
    ...overrides,
  };
}

async function writeMeta(
  root: string,
  id: RunId,
  value: Record<string, unknown>,
): Promise<void> {
  const runDir = join(root, "runs", id);
  await mkdir(runDir, { recursive: true, mode: 0o700 });
  await writeFile(join(runDir, "meta.json"), `${JSON.stringify(value)}\n`, {
    mode: 0o600,
  });
}

function mode(path: string): number {
  return statSync(path).mode & 0o777;
}
