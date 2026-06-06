import { createRoute, z } from "@hono/zod-openapi";
import {
  IdeCatalogParamSchema,
  IdeCatalogSchema,
  WorkflowsQuerySchema,
  type IdeCatalog,
} from "../schema.js";
import { probeIdeCatalog } from "../../../infra/acp/ide-catalog.js";
import { UnknownIdeError } from "../../../infra/acp/ide-profile.js";
import type { ApiApp } from "../app.js";

const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});

export type IdeCatalogProbe = (ide: string, cwd: string) => Promise<IdeCatalog>;

const ideCatalogRoute = createRoute({
  method: "get",
  path: "/ide/:ide/catalog",
  request: {
    params: IdeCatalogParamSchema,
    query: WorkflowsQuerySchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: IdeCatalogSchema } },
      description: "Best-effort IDE catalog probe result",
    },
    400: {
      content: { "application/json": { schema: ApiErrorSchema } },
      description: "Unknown IDE or missing cwd query parameter",
    },
  },
});

export function registerIdeCatalogRoute(
  app: ApiApp,
  probe: IdeCatalogProbe = probeIdeCatalog,
): void {
  app.openapi(ideCatalogRoute, async (c) => {
    const { ide } = c.req.valid("param");
    const { cwd } = c.req.valid("query");

    if (!cwd) {
      return c.json({ code: "MISSING_CWD", message: "cwd query parameter is required" }, 400);
    }

    try {
      const catalog = await probe(ide, cwd);
      return c.json(catalog, 200);
    } catch (err) {
      if (err instanceof UnknownIdeError) {
        return c.json({ code: "UNKNOWN_IDE", message: err.message }, 400);
      }
      throw err;
    }
  });
}
