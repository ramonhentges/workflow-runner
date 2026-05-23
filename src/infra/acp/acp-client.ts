import type {
  SessionNotification,
  RequestPermissionRequest,
  RequestPermissionResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
  ReadTextFileRequest,
  ReadTextFileResponse,
} from "@agentclientprotocol/sdk";

export interface ClientHandlers {
  log: (msg: string, color?: string) => void;
  requestPermission: (
    params: RequestPermissionRequest,
  ) => Promise<RequestPermissionResponse>;
  sessionUpdate?: (params: SessionNotification) => Promise<void>;
  writeTextFile?: (
    params: WriteTextFileRequest,
  ) => Promise<WriteTextFileResponse>;
  readTextFile?: (params: ReadTextFileRequest) => Promise<ReadTextFileResponse>;
}

export class AcpClient {
  constructor(private handlers: ClientHandlers) {}

  requestPermission(
    params: RequestPermissionRequest,
  ): Promise<RequestPermissionResponse> {
    return this.handlers.requestPermission(params);
  }

  sessionUpdate(params: SessionNotification): Promise<void> {
    return this.handlers.sessionUpdate?.(params) ?? Promise.resolve();
  }

  writeTextFile(
    params: WriteTextFileRequest,
  ): Promise<WriteTextFileResponse> {
    return this.handlers.writeTextFile?.(params) ?? Promise.resolve({});
  }

  readTextFile(
    params: ReadTextFileRequest,
  ): Promise<ReadTextFileResponse> {
    return (
      this.handlers.readTextFile?.(params) ?? Promise.resolve({ content: "" })
    );
  }
}
