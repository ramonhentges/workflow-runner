import type { NewSessionResponse } from "@agentclientprotocol/sdk";
import type { Step } from "../../domain/workflow.js";
import type { SessionId } from "../../domain/ids.js";

export interface IdeSpawnSpec {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/**
 * The session-config subset of the ACP `ClientContext` that
 * `configureSession` needs. Kept as a narrow interface so profiles and their
 * tests stay independent of the SDK connection type.
 */
export interface SessionConfigConnection {
  setSessionMode(args: {
    sessionId: SessionId;
    modeId: string;
  }): Promise<unknown>;
  setSessionConfigOption(args: {
    sessionId: SessionId;
    configId: string;
    value: string;
  }): Promise<unknown>;
}

export interface IdeProfile {
  readonly id: string;
  readonly spawn: IdeSpawnSpec;
  configureSession(args: {
    connection: SessionConfigConnection;
    sessionId: SessionId;
    session: NewSessionResponse;
    step: Step;
    log: (msg: string, color?: string) => void;
  }): Promise<void>;
}

export class UnknownIdeError extends Error {}
