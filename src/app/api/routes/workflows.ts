import { createRoute, z } from "@hono/zod-openapi";
import { promises as fsPromises } from "node:fs";
import { join } from "node:path";
import { WorkflowListSchema, WorkflowsQuerySchema, type WorkflowItem } from "../schema.js";
import { resolveGlobalWorkflowsDir, resolveScopedWorkflowsDir } from "./workflow-crud.js";
import type { ApiApp } from "../app.js";

const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});

const workflowsRoute = createRoute({
  method: "get",
  path: "/workflows",
  request: {
    query: WorkflowsQuerySchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: WorkflowListSchema } },
      description: "Combined project (requires cwd) and global workflow files, each tagged with scope",
    },
    400: {
      content: { "application/json": { schema: ApiErrorSchema } },
      description:
        "Invalid cwd (project workflows directory is a file or unreadable) AND no global workflows exist to fall back to. When globals are present, a degenerate project dir degrades to the global-only list (200) rather than erasing globals.",
    },
  },
});

/**
 * Reads `*.json` files directly under `dir` and tags each with `scope`. Returns
 * `ok: false` with `code: "INVALID"` when the directory exists but is a file
 * (ENOTDIR) or unreadable (EACCES); a missing directory (ENOENT) degrades to an
 * empty list. Other errors propagate (mapped to 500 by Hono).
 */
async function readScopedWorkflows(
  dir: string,
  scope: WorkflowItem["scope"],
): Promise<{ ok: true; items: WorkflowItem[] } | { ok: false; code: "INVALID" }> {
  let dirents;
  try {
    dirents = await fsPromises.readdir(dir, { withFileTypes: true });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "ENOENT") return { ok: true, items: [] };
    if (code === "ENOTDIR" || code === "EACCES") return { ok: false, code: "INVALID" };
    throw err;
  }

  const items = dirents
    .filter((e) => e.isFile() && e.name.endsWith(".json"))
    .map((e) => ({ name: e.name, path: join(dir, e.name), scope }));

  return { ok: true, items };
}

export function registerWorkflowsRoute(app: ApiApp): void {
  app.openapi(workflowsRoute, async (c) => {
    const { cwd } = c.req.valid("query");

    // Global portion — always included, independent of cwd (ADR-003 / TechSpec:
    // "global items are always included; they do not depend on cwd"). A missing
    // or unreadable global directory degrades to an empty portion (never an
    // error). Read first so a degenerate project directory cannot erase the
    // user's global workflows from the combined list.
    const global = await readScopedWorkflows(resolveGlobalWorkflowsDir(), "global");
    const globalItems: WorkflowItem[] = global.ok ? global.items : [];

    // Project portion — only when a cwd is supplied. Absent cwd is not an error;
    // it simply yields the global-only list.
    if (cwd) {
      const projectDir = resolveScopedWorkflowsDir("project", cwd);
      const project = await readScopedWorkflows(projectDir, "project");
      if (!project.ok) {
        // The project workflows path is a file (ENOTDIR) or unreadable (EACCES).
        // Since globals are always included, surface 400 INVALID_CWD only when
        // the broken project dir is the sole possible content — i.e. there are no
        // globals to fall back to ("no other recourse"). With globals present we
        // return the global-only list rather than erasing the user's globals.
        if (globalItems.length === 0) {
          return c.json({ code: "INVALID_CWD", message: `Invalid cwd: ${cwd}` }, 400);
        }
        return c.json({ workflows: globalItems }, 200);
      }
      return c.json({ workflows: [...project.items, ...globalItems] }, 200);
    }

    return c.json({ workflows: globalItems }, 200);
  });
}
