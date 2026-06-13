import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { autoSpawnDaemon, buildDaemonSpawnArgs, daemonEntryPath } from "./spawn.js";

describe("autoSpawnDaemon", () => {
  it("exports a daemonEntryPath that resolves to an existing daemon entry file", () => {
    // Ends in .ts under `bun test` (source), .js when running from the bundle.
    // Null only in a compiled binary, which `bun test` never is.
    expect(daemonEntryPath).not.toBeNull();
    expect(daemonEntryPath).toMatch(/entry\.(ts|js)$/);
    expect(existsSync(daemonEntryPath!)).toBe(true);
  });

  describe("buildDaemonSpawnArgs", () => {
    it("passes the entry file (and optional storage root) in dev/bundled mode", () => {
      expect(buildDaemonSpawnArgs("/x/entry.ts")).toEqual(["/x/entry.ts"]);
      expect(buildDaemonSpawnArgs("/x/entry.ts", "/store")).toEqual([
        "/x/entry.ts",
        "/store",
      ]);
    });

    it("invokes the `daemon` subcommand when there is no entry file (compiled binary)", () => {
      expect(buildDaemonSpawnArgs(null)).toEqual(["daemon"]);
      expect(buildDaemonSpawnArgs(null, "/store")).toEqual([
        "daemon",
        "--storage-root",
        "/store",
      ]);
    });
  });

  it("writes the 'starting daemon' banner exactly once and spawns a detached child", () => {
    const dir = mkdtempSync(join(tmpdir(), "wfr-spawn-"));
    const markerPath = join(dir, "ran.txt");
    const fakeEntry = join(dir, "fake-entry.ts");
    writeFileSync(
      fakeEntry,
      `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(markerPath)}, "ok");\n`,
      "utf8",
    );

    const writes: string[] = [];
    const fakeStderr = { write: (chunk: string) => writes.push(chunk) };

    try {
      autoSpawnDaemon({ entryPath: fakeEntry, stderr: fakeStderr });
      expect(writes).toEqual(["workflow-runner: starting daemon\n"]);

      // Poll briefly for the child to finish writing the marker file.
      const deadline = Date.now() + 3000;
      while (!existsSync(markerPath) && Date.now() < deadline) {
        Bun.sleepSync(20);
      }
      expect(existsSync(markerPath)).toBe(true);
      expect(readFileSync(markerPath, "utf8")).toBe("ok");
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  });
});
