import type {
  NewSessionResponse,
  SessionConfigSelectOption,
  SessionConfigSelectGroup,
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

  const modeOption = result.configOptions?.find(
    (o) => o.type === "select" && (o.id === "mode" || o.category === "mode"),
  );
  if (!modeOption || modeOption.type !== "select") return [];

  return modeOption.options.flatMap((entry) =>
    "group" in entry
      ? (entry as SessionConfigSelectGroup).options.map((o) => o.value)
      : [(entry as SessionConfigSelectOption).value],
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
    await connection.unstable_setSessionModel({
      sessionId,
      modelId: step.model,
    });
    log(`Model set: ${step.model}`);
  } catch (err) {
    throw new Error(
      `Step '${step.id}': failed to set model '${step.model}': ${err}`,
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
