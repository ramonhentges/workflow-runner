import { describe, it, expect } from "bun:test";
import type { ClientSideConnection, NewSessionResponse } from "@agentclientprotocol/sdk";
import { resolveIdeProfile, availableModeIds, PROFILES } from "./ide-profiles.js";
import { UnknownIdeError } from "./ide-profile.js";
import { asSessionId, asStepId } from "../../domain/ids.js";
import type { Step } from "../../domain/workflow.js";

function makeStep(
  overrides: Partial<Pick<Step, "id" | "agent" | "model" | "variant">> = {},
): Step {
  return {
    id: asStepId(overrides.id ?? "test-step"),
    agent: overrides.agent ?? "test-agent",
    model: overrides.model ?? "test-model",
    ...(overrides.variant === undefined ? {} : { variant: overrides.variant }),
    mode: "autonomous",
    ide: "opencode",
    description: "test step",
    edges: [],
  };
}

function makeStubConnection(overrides: {
  setSessionMode?: (args: { sessionId: string; modeId: string }) => Promise<void>;
  unstable_setSessionModel?: (args: { sessionId: string; modelId: string }) => Promise<void>;
  setSessionConfigOption?: (args: {
    sessionId: string;
    configId: string;
    value: string;
  }) => Promise<unknown>;
} = {}): { conn: ClientSideConnection; calls: string[] } {
  const calls: string[] = [];
  const conn = {
    setSessionMode: overrides.setSessionMode ?? (async ({ modeId }: { sessionId: string; modeId: string }) => {
      calls.push(`setSessionMode:${modeId}`);
    }),
    unstable_setSessionModel: overrides.unstable_setSessionModel ?? (async ({ modelId }: { sessionId: string; modelId: string }) => {
      calls.push(`unstable_setSessionModel:${modelId}`);
    }),
    setSessionConfigOption: overrides.setSessionConfigOption ?? (async ({ configId, value }: { sessionId: string; configId: string; value: string }) => {
      calls.push(`setSessionConfigOption:${configId}:${value}`);
      return { configOptions: [] };
    }),
  } as unknown as ClientSideConnection;
  return { conn, calls };
}

// --- Registry tests ---

describe("resolveIdeProfile", () => {
  it("returns a profile with id 'opencode' for the 'opencode' ide", () => {
    const profile = resolveIdeProfile("opencode");
    expect(profile.id).toBe("opencode");
  });

  it("throws UnknownIdeError for an unregistered ide", () => {
    let err: unknown;
    try {
      resolveIdeProfile("nonsense");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(UnknownIdeError);
    expect((err as UnknownIdeError).message).toContain("nonsense");
  });

  it("throws UnknownIdeError for an empty string ide", () => {
    expect(() => resolveIdeProfile("")).toThrow(UnknownIdeError);
  });
});

// --- Integration: registry completeness ---

describe("PROFILES registry", () => {
  it("contains at least one entry and every entry has a non-empty spawn.command", () => {
    expect(PROFILES.size).toBeGreaterThan(0);
    for (const [id, profile] of PROFILES) {
      expect(typeof profile.spawn.command).toBe("string");
      expect(profile.spawn.command.length).toBeGreaterThan(0);
      expect(profile.id).toBe(id);
    }
  });

  it("'opencode' entry has spawn command 'opencode' and args ['acp']", () => {
    const profile = resolveIdeProfile("opencode");
    expect(profile.spawn.command).toBe("opencode");
    expect(profile.spawn.args).toEqual(["acp"]);
    expect(profile.spawn.env?.OPENCODE_ENABLE_QUESTION_TOOL).toBe("1");
  });

  it("'claude-code' entry spawns the claude-agent-acp adapter via npx", () => {
    const profile = resolveIdeProfile("claude-code");
    expect(profile.spawn.command).toBe("npx");
    expect(profile.spawn.args).toEqual([
      "-y",
      "@zed-industries/claude-code-acp",
    ]);
  });

  it("'codex' entry spawns the codex-acp adapter via npx", () => {
    const profile = resolveIdeProfile("codex");
    expect(profile.spawn.command).toBe("npx");
    expect(profile.spawn.args).toEqual(["-y", "@zed-industries/codex-acp"]);
  });

  it("'gemini' entry has spawn command 'gemini' and args ['--experimental-acp']", () => {
    const profile = resolveIdeProfile("gemini");
    expect(profile.spawn.command).toBe("gemini");
    expect(profile.spawn.args).toEqual(["--experimental-acp"]);
  });
});

// --- availableModeIds tests ---

describe("availableModeIds", () => {
  it("returns ids from modes.availableModes when present", () => {
    const session = {
      sessionId: "s1",
      modes: {
        availableModes: [{ id: "mode-alpha" }, { id: "mode-beta" }],
      },
    } as unknown as NewSessionResponse;

    expect(availableModeIds(session)).toEqual(["mode-alpha", "mode-beta"]);
  });

  it("prefers modes.availableModes over configOptions when both are present", () => {
    const session = {
      sessionId: "s1",
      modes: {
        availableModes: [{ id: "from-modes" }],
      },
      configOptions: [
        {
          type: "select",
          id: "mode",
          options: [{ value: "from-config" }],
        },
      ],
    } as unknown as NewSessionResponse;

    expect(availableModeIds(session)).toEqual(["from-modes"]);
  });

  it("falls back to configOptions 'mode' select when modes is absent", () => {
    const session = {
      sessionId: "s1",
      configOptions: [
        {
          type: "select",
          id: "mode",
          options: [{ value: "agent-x" }, { value: "agent-y" }],
        },
      ],
    } as unknown as NewSessionResponse;

    expect(availableModeIds(session)).toEqual(["agent-x", "agent-y"]);
  });

  it("falls back to configOptions matched by category 'mode' when id does not match", () => {
    const session = {
      sessionId: "s1",
      configOptions: [
        {
          type: "select",
          category: "mode",
          options: [{ value: "cat-agent" }],
        },
      ],
    } as unknown as NewSessionResponse;

    expect(availableModeIds(session)).toEqual(["cat-agent"]);
  });

  it("flattens grouped options when configOptions has groups", () => {
    const session = {
      sessionId: "s1",
      configOptions: [
        {
          type: "select",
          id: "mode",
          options: [
            { group: "g1", options: [{ value: "agent-a" }, { value: "agent-b" }] },
            { value: "agent-c" },
          ],
        },
      ],
    } as unknown as NewSessionResponse;

    expect(availableModeIds(session)).toEqual(["agent-a", "agent-b", "agent-c"]);
  });

  it("returns [] when neither modes nor configOptions is set", () => {
    const session = { sessionId: "s1" } as unknown as NewSessionResponse;
    expect(availableModeIds(session)).toEqual([]);
  });

  it("returns [] when modes.availableModes is empty and no configOptions", () => {
    const session = {
      sessionId: "s1",
      modes: { availableModes: [] },
    } as unknown as NewSessionResponse;
    expect(availableModeIds(session)).toEqual([]);
  });
});

// --- configureSession tests (all profiles) ---
//
// Every profile (opencode, claude-code, codex, gemini) now shares the
// *standard* (validating) configureSession helper: it rejects a step.agent
// that is not among the session's advertised mode ids, then sets the mode and
// model. Their behavior is identical, so the behavioral suite is parameterized
// over all four profiles rather than copied. Genuinely per-profile facts
// (spawn command/args) are asserted as a single case inside the loop.

const standardProfiles = [
  { ide: "opencode", command: "opencode", args: ["acp"], sessionId: "sess-1", agent: "architect-advisor", model: "big-pickle" },
  { ide: "claude-code", command: "npx", args: ["-y", "@zed-industries/claude-code-acp"], sessionId: "sess-cc-1", agent: "sonnet-coder", model: "claude-sonnet-4-6" },
  { ide: "codex", command: "npx", args: ["-y", "@zed-industries/codex-acp"], sessionId: "sess-cx-1", agent: "default", model: "o4-mini" },
  { ide: "gemini", command: "gemini", args: ["--experimental-acp"], sessionId: "sess-gm-1", agent: "gemini-agent", model: "gemini-2.5-pro" },
];

describe.each(standardProfiles)(
  "$ide profile (standard configureSession)",
  ({ ide, command, args, sessionId: sid, agent, model }) => {
    const sessionId = asSessionId(sid);

    it("resolves to its profile and has the expected spawn command/args", () => {
      const profile = resolveIdeProfile(ide);
      expect(profile.id).toBe(ide);
      expect(profile.spawn.command).toBe(command);
      expect(profile.spawn.args).toEqual(args);
    });

    it("calls setSessionMode with step.agent and model setter with step.model for a valid mode", async () => {
      const profile = resolveIdeProfile(ide);
      const session = {
        sessionId: sid,
        modes: { availableModes: [{ id: agent }] },
      } as unknown as NewSessionResponse;

      const { conn, calls } = makeStubConnection();
      const step = makeStep({ agent, model });

      await profile.configureSession({
        connection: conn,
        sessionId,
        session,
        step,
        log: () => {},
      });

      expect(calls).toContain(`setSessionMode:${agent}`);
      expect(calls).toContain(`unstable_setSessionModel:${model}`);
    });

    it("sets an advertised thought-level option to step.variant after the model", async () => {
      const profile = resolveIdeProfile(ide);
      const session = {
        sessionId: sid,
        configOptions: [
          {
            id: "reasoning-effort",
            name: "Reasoning effort",
            category: "thought_level",
            type: "select",
            currentValue: "medium",
            options: [
              { value: "low", name: "Low" },
              { value: "high", name: "High" },
            ],
          },
        ],
      } as unknown as NewSessionResponse;

      const { conn, calls } = makeStubConnection();
      const step = makeStep({ agent, model, variant: "high" });

      await profile.configureSession({
        connection: conn,
        sessionId,
        session,
        step,
        log: () => {},
      });

      expect(calls).toEqual([
        `setSessionMode:${agent}`,
        `unstable_setSessionModel:${model}`,
        "setSessionConfigOption:reasoning-effort:high",
      ]);
    });

    it("does not set a session config option when step.variant is omitted", async () => {
      const profile = resolveIdeProfile(ide);
      const session = {
        sessionId: sid,
        configOptions: [
          {
            id: "reasoning-effort",
            name: "Reasoning effort",
            category: "thought_level",
            type: "select",
            currentValue: "medium",
            options: [{ value: "high", name: "High" }],
          },
        ],
      } as unknown as NewSessionResponse;

      const { conn, calls } = makeStubConnection();

      await profile.configureSession({
        connection: conn,
        sessionId,
        session,
        step: makeStep({ agent, model }),
        log: () => {},
      });

      expect(calls).toEqual([
        `setSessionMode:${agent}`,
        `unstable_setSessionModel:${model}`,
      ]);
    });

    it("fails clearly when a configured variant has no advertised thought-level option", async () => {
      const profile = resolveIdeProfile(ide);
      const session = { sessionId: sid } as unknown as NewSessionResponse;

      await expect(
        profile.configureSession({
          connection: makeStubConnection().conn,
          sessionId,
          session,
          step: makeStep({ id: `step-${ide}-variant`, agent, model, variant: "high" }),
          log: () => {},
        }),
      ).rejects.toThrow(`Step 'step-${ide}-variant': cannot set model variant 'high'`);
    });

    it("wraps variant setter errors with the step and variant", async () => {
      const profile = resolveIdeProfile(ide);
      const session = {
        sessionId: sid,
        configOptions: [
          {
            id: "thought-level",
            name: "Thought level",
            category: "thought_level",
            type: "select",
            currentValue: "medium",
            options: [{ value: "high", name: "High" }],
          },
        ],
      } as unknown as NewSessionResponse;
      const { conn } = makeStubConnection({
        setSessionConfigOption: async () => {
          throw new Error("unsupported-value");
        },
      });

      await expect(
        profile.configureSession({
          connection: conn,
          sessionId,
          session,
          step: makeStep({ id: `step-${ide}-variant`, agent, model, variant: "high" }),
          log: () => {},
        }),
      ).rejects.toThrow(
        `Step 'step-${ide}-variant': failed to set model variant 'high'`,
      );
    });

    it("throws a step-named error when step.agent is not in the advertised mode ids", async () => {
      const profile = resolveIdeProfile(ide);
      const session = {
        sessionId: sid,
        modes: { availableModes: [{ id: "valid-persona" }] },
      } as unknown as NewSessionResponse;

      const { conn } = makeStubConnection();
      const step = makeStep({ id: `step-${ide}`, agent: "unknown-persona", model });

      let err: unknown;
      try {
        await profile.configureSession({
          connection: conn,
          sessionId,
          session,
          step,
          log: () => {},
        });
      } catch (e) {
        err = e;
      }

      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain(`step-${ide}`);
      expect((err as Error).message).toContain("unknown-persona");
      expect((err as Error).message).toContain("valid-persona");
    });

    it("succeeds and skips mode validation when no modes are advertised", async () => {
      const profile = resolveIdeProfile(ide);
      const session = { sessionId: sid } as unknown as NewSessionResponse;

      const { conn, calls } = makeStubConnection();
      const step = makeStep({ agent: "any-persona", model });

      await profile.configureSession({
        connection: conn,
        sessionId,
        session,
        step,
        log: () => {},
      });

      expect(calls).toContain("setSessionMode:any-persona");
      expect(calls).toContain(`unstable_setSessionModel:${model}`);
    });

    it("logs 'Mode set' and 'Model set' after successful calls", async () => {
      const profile = resolveIdeProfile(ide);
      const session = { sessionId: sid } as unknown as NewSessionResponse;

      const { conn } = makeStubConnection();
      const step = makeStep({ agent, model });
      const logged: string[] = [];

      await profile.configureSession({
        connection: conn,
        sessionId,
        session,
        step,
        log: (msg) => logged.push(msg),
      });

      expect(logged.some((m) => m.includes("Mode set") && m.includes(agent))).toBe(true);
      expect(logged.some((m) => m.includes("Model set") && m.includes(model))).toBe(true);
    });

    it("wraps setSessionMode errors with a step-named message", async () => {
      const profile = resolveIdeProfile(ide);
      const session = { sessionId: sid } as unknown as NewSessionResponse;

      const { conn } = makeStubConnection({
        setSessionMode: async () => { throw new Error("mode-unsupported"); },
      });
      const step = makeStep({ id: `step-${ide}-err`, agent: "unsupported-persona", model: "m" });

      let err: unknown;
      try {
        await profile.configureSession({
          connection: conn,
          sessionId,
          session,
          step,
          log: () => {},
        });
      } catch (e) {
        err = e;
      }

      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain(`step-${ide}-err`);
      expect((err as Error).message).toContain("unsupported-persona");
    });

    it("wraps unstable_setSessionModel errors with a step-named message", async () => {
      const profile = resolveIdeProfile(ide);
      const session = { sessionId: sid } as unknown as NewSessionResponse;

      const { conn } = makeStubConnection({
        unstable_setSessionModel: async () => { throw new Error("model-unsupported"); },
      });
      const step = makeStep({ id: `step-${ide}-m`, agent: "some-persona", model: "unsupported-model" });

      let err: unknown;
      try {
        await profile.configureSession({
          connection: conn,
          sessionId,
          session,
          step,
          log: () => {},
        });
      } catch (e) {
        err = e;
      }

      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain(`step-${ide}-m`);
      expect((err as Error).message).toContain("unsupported-model");
    });
  },
);
