import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { autoSpawnDaemon, daemonEntryPath } from "./spawn.js";

describe("autoSpawnDaemon", () => {
  it("exports a daemonEntryPath that resolves to an existing daemon entry file", () => {
    // Ends in .ts under `bun test` (source), .js when running from the bundle.
    expect(daemonEntryPath).toMatch(/entry\.(ts|js)$/);
    expect(existsSync(daemonEntryPath)).toBe(true);
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
