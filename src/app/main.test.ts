import { describe, expect, it } from "bun:test";

import { main, type CommandRun } from "./main.js";

function makeStream() {
  const chunks: string[] = [];
  return {
    chunks,
    write: (s: string) => {
      chunks.push(s);
    },
    text: () => chunks.join(""),
  };
}

interface CallLog {
  name: string;
  argv: string[];
}

function makeCommands(
  log: CallLog[],
  overrides: Partial<Record<string, number>> = {},
): Record<string, CommandRun> {
  const names = [
    "daemon",
    "start",
    "attach",
    "ps",
    "send",
    "retry-step",
    "stop",
    "doctor",
  ];
  const out: Record<string, CommandRun> = {};
  for (const name of names) {
    out[name] = async (argv) => {
      log.push({ name, argv });
      return overrides[name] ?? 0;
    };
  }
  return out;
}

describe("main dispatcher", () => {
  it("dispatches `ps` to the ps command and returns its exit code", async () => {
    const calls: CallLog[] = [];
    const stdout = makeStream();
    const stderr = makeStream();
    const code = await main(["bun", "src/index.ts", "ps"], {
      commands: makeCommands(calls, { ps: 7 }),
      stdout,
      stderr,
      readVersion: () => "0.0.0",
    });
    expect(code).toBe(7);
    expect(calls).toEqual([{ name: "ps", argv: [] }]);
    expect(stderr.text()).toBe("");
  });

  it("forwards remaining argv to the `start` command", async () => {
    const calls: CallLog[] = [];
    const stdout = makeStream();
    const stderr = makeStream();
    const code = await main(
      ["bun", "src/index.ts", "start", "wf.json", "--detach"],
      {
        commands: makeCommands(calls),
        stdout,
        stderr,
        readVersion: () => "0.0.0",
      },
    );
    expect(code).toBe(0);
    expect(calls).toEqual([
      { name: "start", argv: ["wf.json", "--detach"] },
    ]);
    expect(stderr.text()).toBe("");
  });

  it("--help prints the usage block to stdout, returns 0, and invokes no command", async () => {
    const calls: CallLog[] = [];
    const stdout = makeStream();
    const stderr = makeStream();
    const code = await main(["bun", "src/index.ts", "--help"], {
      commands: makeCommands(calls),
      stdout,
      stderr,
      readVersion: () => "0.0.0",
    });
    expect(code).toBe(0);
    expect(calls).toEqual([]);
    const text = stdout.text();
    expect(text).toContain("Usage: workflow-runner");
    for (const name of [
      "start",
      "attach",
      "detach",
      "ps",
      "send",
      "retry-step",
      "stop",
      "doctor",
      "daemon",
    ]) {
      expect(text).toContain(name);
    }
    expect(stderr.text()).toBe("");
  });

  it("-h is treated identically to --help", async () => {
    const calls: CallLog[] = [];
    const stdout = makeStream();
    const stderrShort = makeStream();
    const stdoutLong = makeStream();
    const stderrLong = makeStream();

    const shortCode = await main(["bun", "src/index.ts", "-h"], {
      commands: makeCommands(calls),
      stdout,
      stderr: stderrShort,
      readVersion: () => "0.0.0",
    });
    const longCode = await main(["bun", "src/index.ts", "--help"], {
      commands: makeCommands(calls),
      stdout: stdoutLong,
      stderr: stderrLong,
      readVersion: () => "0.0.0",
    });

    expect(shortCode).toBe(0);
    expect(longCode).toBe(0);
    expect(stdout.text()).toBe(stdoutLong.text());
    expect(calls).toEqual([]);
  });

  it("no-args prints usage and returns 0", async () => {
    const calls: CallLog[] = [];
    const stdout = makeStream();
    const stderr = makeStream();
    const code = await main(["bun", "src/index.ts"], {
      commands: makeCommands(calls),
      stdout,
      stderr,
      readVersion: () => "0.0.0",
    });
    expect(code).toBe(0);
    expect(calls).toEqual([]);
    expect(stdout.text()).toContain("Usage: workflow-runner");
    expect(stderr.text()).toBe("");
  });

  it("--version prints the version (ending in a digit) and returns 0", async () => {
    const stdout = makeStream();
    const stderr = makeStream();
    const code = await main(["bun", "src/index.ts", "--version"], {
      stdout,
      stderr,
      readVersion: () => "1.2.3",
    });
    expect(code).toBe(0);
    expect(stdout.text()).toBe("1.2.3\n");
    expect(stderr.text()).toBe("");
    expect(/[0-9]\n?$/.test(stdout.text())).toBe(true);
  });

  it("default version reader returns the package.json version", async () => {
    const stdout = makeStream();
    const stderr = makeStream();
    const code = await main(["bun", "src/index.ts", "--version"], {
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    const printed = stdout.text().trim();
    expect(printed.length).toBeGreaterThan(0);
    expect(/[0-9]$/.test(printed)).toBe(true);
  });

  it("unknown subcommand writes a hint to stderr and returns 1", async () => {
    const calls: CallLog[] = [];
    const stdout = makeStream();
    const stderr = makeStream();
    const code = await main(["bun", "src/index.ts", "doesnotexist"], {
      commands: makeCommands(calls),
      stdout,
      stderr,
      readVersion: () => "0.0.0",
    });
    expect(code).toBe(1);
    expect(calls).toEqual([]);
    const err = stderr.text();
    expect(err).toContain("unknown subcommand 'doesnotexist'");
    expect(err).toContain("workflow-runner --help");
    expect(stdout.text()).toBe("");
  });

  it("`detach` writes the documentation-only message, returns 0, and dispatches no command", async () => {
    const calls: CallLog[] = [];
    const stdout = makeStream();
    const stderr = makeStream();
    const code = await main(["bun", "src/index.ts", "detach"], {
      commands: makeCommands(calls),
      stdout,
      stderr,
      readVersion: () => "0.0.0",
    });
    expect(code).toBe(0);
    expect(calls).toEqual([]);
    expect(stdout.text()).toBe(
      "detach is performed inside the TUI with /detach; this command is for documentation only\n",
    );
    expect(stderr.text()).toBe("");
  });

  it("dispatches each registered subcommand by name with the correct argv slice", async () => {
    const cases: Array<[string, string[]]> = [
      ["daemon", []],
      ["attach", ["abc12"]],
      ["send", ["abc12", "hello"]],
      ["retry-step", ["abc12"]],
      ["stop", ["abc12"]],
      ["doctor", []],
    ];
    for (const [name, rest] of cases) {
      const calls: CallLog[] = [];
      const stdout = makeStream();
      const stderr = makeStream();
      const code = await main(["bun", "src/index.ts", name, ...rest], {
        commands: makeCommands(calls),
        stdout,
        stderr,
        readVersion: () => "0.0.0",
      });
      expect(code).toBe(0);
      expect(calls).toEqual([{ name, argv: rest }]);
    }
  });
});
