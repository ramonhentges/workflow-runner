import { client, methods, type ClientApp } from "@agentclientprotocol/sdk";
import type {
  SessionNotification,
  RequestPermissionRequest,
  RequestPermissionResponse,
} from "@agentclientprotocol/sdk";

export interface AcpClientHandlers {
  requestPermission: (
    params: RequestPermissionRequest,
  ) => Promise<RequestPermissionResponse>;
  sessionUpdate?: (notification: SessionNotification) => void;
  writeTextFile?: (path: string, content: string) => Promise<void>;
  readTextFile?: (path: string) => Promise<string>;
}

export function createAcpClientApp(handlers: AcpClientHandlers): ClientApp {
  return client({ name: "workflow-runner" })
    .onRequest(methods.client.session.requestPermission, (ctx) =>
      handlers.requestPermission(ctx.params),
    )
    .onNotification(methods.client.session.update, (ctx) => {
      handlers.sessionUpdate?.(ctx.params);
    })
    .onRequest(methods.client.fs.writeTextFile, async (ctx) => {
      await handlers.writeTextFile?.(ctx.params.path, ctx.params.content);
    })
    .onRequest(methods.client.fs.readTextFile, async (ctx) => {
      const content = (await handlers.readTextFile?.(ctx.params.path)) ?? "";
      return { content };
    });
}
