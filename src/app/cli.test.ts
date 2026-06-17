import { describe, expect, it } from "bun:test";

import {
  parseAttachArgs,
  parseDaemonArgs,
  parseDoctorArgs,
  parsePsArgs,
  parseRetryStepArgs,
  parseSendArgs,
  parseStartArgs,
  parseStopArgs,
} from "./cli.js";

describe("parseStartArgs", () => {
  it("parses a workflow path with detach defaulting to false", () => {
    const result = parseStartArgs(["wf.json"]);
    expect(result).toEqual({
      ok: true,
      value: { workflowPath: "wf.json", detach: false },
    });
  });

  it("parses --detach", () => {
    const result = parseStartArgs(["wf.json", "--detach"]);
    expect(result).toEqual({
      ok: true,
      value: { workflowPath: "wf.json", detach: true },
    });
  });

  it("parses -d", () => {
    const result = parseStartArgs(["wf.json", "-d"]);
    expect(result).toEqual({
      ok: true,
      value: { workflowPath: "wf.json", detach: true },
    });
  });

  it("accepts the flag before the positional", () => {
    const result = parseStartArgs(["--detach", "wf.json"]);
    expect(result).toEqual({
      ok: true,
      value: { workflowPath: "wf.json", detach: true },
    });
  });

  it("returns an error when the workflow path is missing", () => {
    const result = parseStartArgs([]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/workflow path/i);
    }
  });

  it("rejects unknown flags", () => {
    const result = parseStartArgs(["wf.json", "--bogus"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("--bogus");
    }
  });

  it("rejects extra positional arguments", () => {
    const result = parseStartArgs(["wf.json", "extra"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("extra");
    }
  });

  it("parses --branch <name> alongside the workflow path", () => {
    const result = parseStartArgs(["wf.json", "--branch", "feature-x"]);
    expect(result).toEqual({
      ok: true,
      value: { workflowPath: "wf.json", detach: false, branch: "feature-x" },
    });
  });

  it("parses --branch together with --detach", () => {
    const result = parseStartArgs(["wf.json", "--branch", "feature-x", "--detach"]);
    expect(result).toEqual({
      ok: true,
      value: { workflowPath: "wf.json", detach: true, branch: "feature-x" },
    });
  });

  it("parses the --branch=<name> form", () => {
    const result = parseStartArgs(["wf.json", "--branch=feature-x"]);
    expect(result).toEqual({
      ok: true,
      value: { workflowPath: "wf.json", detach: false, branch: "feature-x" },
    });
  });

  it("returns an error when --branch is given without a value", () => {
    const result = parseStartArgs(["wf.json", "--branch"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/--branch requires a value/);
    }
  });

  it("returns an error when --branch is immediately followed by a flag", () => {
    const result = parseStartArgs(["wf.json", "--branch", "--detach"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/--branch requires a value/);
    }
  });

  it("omits branch from the parsed value when --branch is absent", () => {
    const result = parseStartArgs(["wf.json"]);
    expect(result).toEqual({
      ok: true,
      value: { workflowPath: "wf.json", detach: false },
    });
    if (result.ok && "value" in result) {
      expect("branch" in result.value).toBe(false);
    }
  });

  it("parses --prompt <text> alongside the workflow path", () => {
    const result = parseStartArgs(["wf.json", "--prompt", "hello"]);
    expect(result).toEqual({
      ok: true,
      value: { workflowPath: "wf.json", detach: false, initialPrompt: "hello" },
    });
  });

  it("parses the --prompt=<text> form", () => {
    const result = parseStartArgs(["wf.json", "--prompt=hello"]);
    expect(result).toEqual({
      ok: true,
      value: { workflowPath: "wf.json", detach: false, initialPrompt: "hello" },
    });
  });

  it("returns an error when --prompt is given without a value", () => {
    const result = parseStartArgs(["wf.json", "--prompt"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/--prompt requires a value/);
    }
  });

  it("returns an error when --prompt= is given an empty value", () => {
    const result = parseStartArgs(["wf.json", "--prompt="]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/--prompt requires a value/);
    }
  });

  it("returns an error when --prompt is immediately followed by a flag", () => {
    const result = parseStartArgs(["wf.json", "--prompt", "--branch"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/--prompt requires a value/);
    }
  });

  it("treats '-' as a valid --prompt value (stdin sentinel) with --branch and -d", () => {
    const result = parseStartArgs([
      "wf.json",
      "--prompt",
      "-",
      "--branch",
      "b",
      "-d",
    ]);
    expect(result).toEqual({
      ok: true,
      value: {
        workflowPath: "wf.json",
        detach: true,
        branch: "b",
        initialPrompt: "-",
      },
    });
  });

  it("keeps the '@<path>' file sentinel as the raw --prompt value", () => {
    const result = parseStartArgs(["wf.json", "--prompt", "@/tmp/brief.md"]);
    expect(result).toEqual({
      ok: true,
      value: {
        workflowPath: "wf.json",
        detach: false,
        initialPrompt: "@/tmp/brief.md",
      },
    });
  });

  it("omits initialPrompt from the parsed value when --prompt is absent", () => {
    const result = parseStartArgs(["wf.json"]);
    if (result.ok && "value" in result) {
      expect("initialPrompt" in result.value).toBe(false);
    }
  });

  it("returns help when --help is present", () => {
    expect(parseStartArgs(["--help"])).toEqual({ ok: true, help: true });
  });

  it("returns help when -h is present", () => {
    expect(parseStartArgs(["-h"])).toEqual({ ok: true, help: true });
  });
});

describe("parseStopArgs", () => {
  it("parses a run id", () => {
    expect(parseStopArgs(["abc12345"])).toEqual({
      ok: true,
      value: { runId: "abc12345" },
    });
  });

  it("returns an error when the run id is missing", () => {
    const result = parseStopArgs([]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/run id/i);
    }
  });

  it("rejects extra arguments", () => {
    const result = parseStopArgs(["abc", "extra"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("extra");
    }
  });

  it("rejects an id-like flag", () => {
    const result = parseStopArgs(["--bogus"]);
    expect(result.ok).toBe(false);
  });

  it("returns help on --help", () => {
    expect(parseStopArgs(["--help"])).toEqual({ ok: true, help: true });
  });

  it("returns help on -h", () => {
    expect(parseStopArgs(["-h"])).toEqual({ ok: true, help: true });
  });
});

describe("parseRetryStepArgs", () => {
  it("parses a run id", () => {
    expect(parseRetryStepArgs(["abc"])).toEqual({
      ok: true,
      value: { runId: "abc" },
    });
  });

  it("requires a run id", () => {
    const result = parseRetryStepArgs([]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/run id/i);
    }
  });

  it("rejects extra arguments", () => {
    const result = parseRetryStepArgs(["abc", "extra"]);
    expect(result.ok).toBe(false);
  });

  it("returns help on --help", () => {
    expect(parseRetryStepArgs(["--help"])).toEqual({ ok: true, help: true });
  });

  it("returns help on -h", () => {
    expect(parseRetryStepArgs(["-h"])).toEqual({ ok: true, help: true });
  });
});

describe("parsePsArgs", () => {
  it("returns all=false by default", () => {
    expect(parsePsArgs([])).toEqual({ ok: true, value: { all: false } });
  });

  it("parses --all", () => {
    expect(parsePsArgs(["--all"])).toEqual({
      ok: true,
      value: { all: true },
    });
  });

  it("parses -a", () => {
    expect(parsePsArgs(["-a"])).toEqual({
      ok: true,
      value: { all: true },
    });
  });

  it("rejects unknown arguments", () => {
    const result = parsePsArgs(["--bogus"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("--bogus");
    }
  });

  it("returns help on --help", () => {
    expect(parsePsArgs(["--help"])).toEqual({ ok: true, help: true });
  });

  it("returns help on -h", () => {
    expect(parsePsArgs(["-h"])).toEqual({ ok: true, help: true });
  });
});

describe("parseAttachArgs", () => {
  it("returns runId=null when no positional is given", () => {
    expect(parseAttachArgs([])).toEqual({
      ok: true,
      value: { runId: null },
    });
  });

  it("parses a run id positional", () => {
    expect(parseAttachArgs(["abc"])).toEqual({
      ok: true,
      value: { runId: "abc" },
    });
  });

  it("rejects unknown flags", () => {
    const result = parseAttachArgs(["--bogus"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("--bogus");
    }
  });

  it("rejects extra positional arguments", () => {
    const result = parseAttachArgs(["abc", "extra"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("extra");
    }
  });

  it("returns help on --help", () => {
    expect(parseAttachArgs(["--help"])).toEqual({ ok: true, help: true });
  });

  it("returns help on -h", () => {
    expect(parseAttachArgs(["-h"])).toEqual({ ok: true, help: true });
  });
});

describe("parseSendArgs", () => {
  it("parses an inline message", () => {
    expect(parseSendArgs(["abc", "hello world"])).toEqual({
      ok: true,
      value: { runId: "abc", message: "hello world", fromStdin: false },
    });
  });

  it("treats '-' as a stdin signal with empty inline message", () => {
    expect(parseSendArgs(["abc", "-"])).toEqual({
      ok: true,
      value: { runId: "abc", message: "", fromStdin: true },
    });
  });

  it("requires both a run id and a message", () => {
    const result = parseSendArgs(["abc"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/run id and message/i);
    }
  });

  it("rejects extra arguments", () => {
    const result = parseSendArgs(["abc", "hi", "extra"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("extra");
    }
  });

  it("rejects a flag-shaped run id", () => {
    const result = parseSendArgs(["--bogus", "hi"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("--bogus");
    }
  });

  it("returns help on --help", () => {
    expect(parseSendArgs(["--help"])).toEqual({ ok: true, help: true });
  });

  it("returns help on -h", () => {
    expect(parseSendArgs(["-h"])).toEqual({ ok: true, help: true });
  });
});

describe("parseDoctorArgs", () => {
  it("accepts an empty argv", () => {
    expect(parseDoctorArgs([])).toEqual({ ok: true, value: {} });
  });

  it("rejects any extra argument", () => {
    const result = parseDoctorArgs(["extra"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("extra");
    }
  });

  it("returns help on --help", () => {
    expect(parseDoctorArgs(["--help"])).toEqual({ ok: true, help: true });
  });

  it("returns help on -h", () => {
    expect(parseDoctorArgs(["-h"])).toEqual({ ok: true, help: true });
  });
});

describe("parseDaemonArgs", () => {
  it("accepts an empty argv", () => {
    expect(parseDaemonArgs([])).toEqual({ ok: true, value: {} });
  });

  it("rejects any extra argument", () => {
    const result = parseDaemonArgs(["extra"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("extra");
    }
  });

  it("returns help on --help", () => {
    expect(parseDaemonArgs(["--help"])).toEqual({ ok: true, help: true });
  });

  it("returns help on -h", () => {
    expect(parseDaemonArgs(["-h"])).toEqual({ ok: true, help: true });
  });

  it("parses --host 0.0.0.0 into DaemonArgs.bindHost", () => {
    const result = parseDaemonArgs(["--host", "0.0.0.0"]);
    expect(result).toEqual({
      ok: true,
      value: { bindHost: "0.0.0.0" },
    });
  });

  it("parses --host=0.0.0.0 into DaemonArgs.bindHost", () => {
    const result = parseDaemonArgs(["--host=0.0.0.0"]);
    expect(result).toEqual({
      ok: true,
      value: { bindHost: "0.0.0.0" },
    });
  });

  it("parsing an IP address like 192.168.1.100 does not trigger port validation", () => {
    const result = parseDaemonArgs(["--host", "192.168.1.100"]);
    expect(result).toEqual({
      ok: true,
      value: { bindHost: "192.168.1.100" },
    });
  });

  it("empty argv produces undefined bindHost", () => {
    const result = parseDaemonArgs([]);
    expect(result).toEqual({ ok: true, value: {} });
  });

  it("--api-port and --host can be combined", () => {
    const result = parseDaemonArgs(["--api-port", "8080", "--host", "0.0.0.0"]);
    expect(result).toEqual({
      ok: true,
      value: { apiPort: 8080, bindHost: "0.0.0.0" },
    });
  });

  it("--storage-root and --host can be combined", () => {
    const result = parseDaemonArgs(["--storage-root", "/tmp/data", "--host", "0.0.0.0"]);
    expect(result).toEqual({
      ok: true,
      value: { storageRoot: "/tmp/data", bindHost: "0.0.0.0" },
    });
  });

  it("returns an error when --host is given without a value", () => {
    const result = parseDaemonArgs(["--host"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/--host requires a value/);
    }
  });
});

describe("argv non-mutation", () => {
  const parsers = [
    { name: "parseStartArgs", fn: parseStartArgs, argv: ["wf.json", "--detach"] },
    { name: "parseStopArgs", fn: parseStopArgs, argv: ["abc"] },
    { name: "parseRetryStepArgs", fn: parseRetryStepArgs, argv: ["abc"] },
    { name: "parsePsArgs", fn: parsePsArgs, argv: ["--all"] },
    { name: "parseAttachArgs", fn: parseAttachArgs, argv: ["abc"] },
    { name: "parseSendArgs", fn: parseSendArgs, argv: ["abc", "-"] },
    { name: "parseDoctorArgs", fn: parseDoctorArgs, argv: [] as string[] },
    { name: "parseDaemonArgs", fn: parseDaemonArgs, argv: [] as string[] },
  ];

  for (const { name, fn, argv } of parsers) {
    it(`${name} does not mutate its argv argument`, () => {
      const snapshot = [...argv];
      fn(argv);
      expect(argv).toEqual(snapshot);
    });
  }
});
