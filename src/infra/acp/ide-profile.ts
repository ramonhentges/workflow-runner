import type { ClientSideConnection, NewSessionResponse } from "@agentclientprotocol/sdk";
import type { Step } from "../../domain/workflow.js";
import type { SessionId } from "../../domain/ids.js";

export interface IdeSpawnSpec {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface IdeProfile {
  readonly id: string;
  readonly spawn: IdeSpawnSpec;
  configureSession(args: {
    connection: ClientSideConnection;
    sessionId: SessionId;
    session: NewSessionResponse;
    step: Step;
    log: (msg: string, color?: string) => void;
  }): Promise<void>;
}

export class UnknownIdeError extends Error {}
