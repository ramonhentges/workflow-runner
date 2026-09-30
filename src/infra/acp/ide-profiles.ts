import type {
  NewSessionResponse,
  SessionConfigSelect,
  SessionConfigSelectGroup,
  SessionConfigSelectOption,
} from "@agentclientprotocol/sdk";
import { UnknownIdeError, type IdeProfile } from "./ide-profile.js";

/**
 * Extracts the set of valid mode (agent) ids from a `newSession` response.
 *
 * Standard ACP agents advertise modes via the `modes` field, but opencode leaves
 * that unset and instead exposes mode selection as a `configOptions` entry
 * (`id`/`category` of `"mode"`, a `select` whose option `value`s are the agent
 * names). We read the standard field first for forward-compatibility, then fall
 * back to the config option.
 */
export function availableModeIds(result: NewSessionResponse): string[] {
  const standard = result.modes?.availableModes?.map((m) => m.id);
  if (standard && standard.length > 0) return standard;

  const modeOption = findConfigSelect(result, "mode");
  if (!modeOption) return [];

  return flattenSelectOptions(modeOption.options).map((o) => o.value);
}

export function availableModelOptions(
  result: NewSessionResponse,
): Array<{ value: string; name: string }> {
  const modelOption = findConfigSelect(result, "model");
  if (!modelOption) return [];

  return flattenSelectOptions(modelOption.options).map((o) => ({
    value: o.value,
    name: o.name,
  }));
}

function findConfigSelect(
  result: NewSessionResponse,
  key: "mode" | "model",
): SessionConfigSelect | null {
  const option = result.configOptions?.find(
    (o) => o.type === "select" && (o.id === key || o.category === key),
  );
  if (!option || option.type !== "select") return null;
  return option;
}

function flattenSelectOptions(
  options: readonly (SessionConfigSelectOption | SessionConfigSelectGroup)[],
): Array<{ value: string; name: string }> {
  return options.flatMap((entry) =>
    "group" in entry
      ? entry.options.map((o) => ({ value: o.value, name: o.name }))
      : [{ value: entry.value, name: entry.name }],
  );
}

async function configureStandardSession({
  connection,
  sessionId,
  session,
  step,
  log,
}: Parameters<IdeProfile["configureSession"]>[0]): Promise<void> {
  const modeIds = availableModeIds(session);
  if (modeIds.length > 0 && !modeIds.includes(step.agent)) {
    throw new Error(
      `Step '${step.id}': agent '${step.agent}' is not a valid mode (available: ${modeIds.join(", ")})`,
    );
  }

  try {
    await connection.setSessionMode({ sessionId, modeId: step.agent });
  } catch (err) {
    throw new Error(
      `Step '${step.id}': failed to set agent '${step.agent}': ${err}`,
    );
  }
  log(`Mode set: ${step.agent}`);

  try {
    await connection.setSessionConfigOption({
      sessionId,
      configId: "model",
      value: step.model,
    });
    log(`Model set: ${step.model}`);
  } catch (err) {
    throw new Error(
      `Step '${step.id}': failed to set model '${step.model}': ${err}`,
    );
  }

  if (step.variant === undefined) return;

  const variantOption = session.configOptions?.find(
    (option) =>
      option.type === "select" &&
      (option.category === "thought_level" || option.id === "thought_level"),
  );
  if (!variantOption) {
    throw new Error(
      `Step '${step.id}': cannot set model variant '${step.variant}' because the agent did not advertise a thought-level option`,
    );
  }

  try {
    await connection.setSessionConfigOption({
      sessionId,
      configId: variantOption.id,
      value: step.variant,
    });
    log(`Model variant set: ${step.variant}`);
  } catch (err) {
    throw new Error(
      `Step '${step.id}': failed to set model variant '${step.variant}': ${err}`,
    );
  }
}

const opencodeProfile: IdeProfile = {
  id: "opencode",
  spawn: {
    command: "opencode",
    args: ["acp"],
    env: { OPENCODE_ENABLE_QUESTION_TOOL: "1" },
  },
  configureSession: configureStandardSession,
};

// Claude Code has no native ACP mode; it is driven through the maintained
// `@zed-industries/claude-code-acp` adapter, fetched/cached via npx. The
// underlying `claude` CLI must still be installed and authenticated.
const claudeCodeProfile: IdeProfile = {
  id: "claude-code",
  spawn: {
    command: "npx",
    args: ["-y", "@zed-industries/claude-code-acp"],
  },
  configureSession: configureStandardSession,
};

// Codex has no native ACP mode either; it is driven through the
// `@zed-industries/codex-acp` adapter via npx. The underlying `codex` CLI must
// be installed and authenticated.
const codexProfile: IdeProfile = {
  id: "codex",
  spawn: {
    command: "npx",
    args: ["-y", "@zed-industries/codex-acp"],
  },
  configureSession: configureStandardSession,
};

// Gemini CLI exposes ACP natively, but behind the `--experimental-acp` flag.
const geminiProfile: IdeProfile = {
  id: "gemini",
  spawn: {
    command: "gemini",
    args: ["--experimental-acp"],
  },
  configureSession: configureStandardSession,
};

export const PROFILES: ReadonlyMap<string, IdeProfile> = new Map([
  ["opencode", opencodeProfile],
  ["claude-code", claudeCodeProfile],
  ["codex", codexProfile],
  ["gemini", geminiProfile],
]);

export function resolveIdeProfile(ide: string): IdeProfile {
  const profile = PROFILES.get(ide);
  if (!profile) {
    throw new UnknownIdeError(`Unknown IDE: '${ide}'`);
  }
  return profile;
}
