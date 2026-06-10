import { createRoute, z } from "@hono/zod-openapi";
import { promises as fs } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import {
  WorkflowsQuerySchema,
  WorkflowNameParamSchema,
  WorkflowCreateBodySchema,
  WorkflowUpdateBodySchema,
  WorkflowDocSchema,
  WorkflowScopeSchema,
  type WorkflowScope,
} from "../schema.js";
import { Workflow, WorkflowConfigError } from "../../../domain/workflow.js";
import { mapError } from "../error-map.js";
import { findActiveRunForWorkflow } from "./workflow-run-guard.js";
import type { ApiApp } from "../app.js";
import type { RunManager } from "../../../infra/daemon/run-manager.js";

const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveWorkflowsDir(cwd: string): string {
  return join(resolve(cwd), "workflows");
}

/**
 * Resolves the global workflows directory from the daemon storage root (ADR-002):
 * `(XDG_STATE_HOME ?? ~/.local/state)/workflow-runner/workflows`. Independent of
 * any `cwd`. Mirrors `resolveStorageRoot` in `infra/daemon/run-store.ts`.
 */
export function resolveGlobalWorkflowsDir(env: NodeJS.ProcessEnv = process.env): string {
  const stateHome = env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
  return join(stateHome, "workflow-runner", "workflows");
}

/**
 * Single source of truth for directory selection by scope (ADR-003). Returns the
 * global dir for `"global"` (ignoring `cwd`) and `<cwd>/workflows` for
 * `"project"`. Throws `WorkflowConfigError` when project scope is requested
 * without a `cwd`.
 */
export function resolveScopedWorkflowsDir(
  scope: WorkflowScope,
  cwd: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (scope === "global") return resolveGlobalWorkflowsDir(env);
  if (!cwd) throw new WorkflowConfigError("cwd is required for project scope");
  return resolveWorkflowsDir(cwd);
}

/**
 * Resolves the absolute path for `<dir>/<name>.json` within an already-resolved
 * workflows directory (project or global). Throws if the result would escape
 * `dir` (defense-in-depth; the name is already validated by
 * WorkflowNameParamSchema before reaching handlers).
 */
export function resolveWorkflowFileInDir(dir: string, name: string): string {
  const file = join(dir, `${name}.json`);
  // OS-portable containment check: the resolved file must be a direct child of
  // `dir`. `relative` escapes (starts with "..") or returns an absolute path
  // when `name` would break out of the workflows directory; a separator in the
  // result means it nested into a subdirectory. Using `path.sep`/`relative`
  // avoids the POSIX-only hard-coded "/" comparison. Throws WorkflowConfigError
  // (mapped to 400 WORKFLOW_INVALID) rather than a bare Error (500).
  const rel = relative(dir, file);
  if (rel.startsWith("..") || isAbsolute(rel) || rel.includes(sep)) {
    throw new WorkflowConfigError(`Unsafe workflow name: ${name}`);
  }
  return file;
}

/**
 * Resolves the absolute path for `<cwd>/workflows/<name>.json`. Thin wrapper
 * over {@link resolveWorkflowFileInDir} for project-scope callers and tests.
 */
export function resolveWorkflowFile(cwd: string, name: string): string {
  return resolveWorkflowFileInDir(resolveWorkflowsDir(cwd), name);
}

export async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const dir = dirname(filePath);
  const tmpFile = join(dir, `.tmp-${randomBytes(8).toString("hex")}`);
  try {
    await fs.writeFile(tmpFile, JSON.stringify(data, null, 2), "utf-8");
    await fs.rename(tmpFile, filePath);
  } catch (err) {
    await fs.unlink(tmpFile).catch(() => {});
    throw err;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves the target directory and effective scope for a CRUD request
 * (ADR-003). Scope defaults to `"project"` when the query omits it. Returns
 * `ok: false` for project scope without a `cwd` so the handler can emit the
 * `MISSING_CWD` error; global scope never needs a `cwd`.
 */
function resolveScopeTarget(
  scope: WorkflowScope | undefined,
  cwd: string | undefined,
): { ok: true; scope: WorkflowScope; dir: string } | { ok: false } {
  const effective = scope ?? "project";
  if (effective === "project" && !cwd) return { ok: false };
  return { ok: true, scope: effective, dir: resolveScopedWorkflowsDir(effective, cwd) };
}

// ---------------------------------------------------------------------------
// Route definitions
// ---------------------------------------------------------------------------

const getWorkflowRoute = createRoute({
  method: "get",
  path: "/workflows/:name",
  request: {
    params: z.object({ name: WorkflowNameParamSchema }),
    query: WorkflowsQuerySchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: WorkflowDocSchema } },
      description: "Workflow file content",
    },
    400: {
      content: { "application/json": { schema: ApiErrorSchema } },
      description: "Bad name or missing cwd",
    },
    404: {
      content: { "application/json": { schema: ApiErrorSchema } },
      description: "Workflow not found",
    },
  },
});

const createWorkflowRoute = createRoute({
  method: "post",
  path: "/workflows",
  request: {
    query: WorkflowsQuerySchema,
    body: {
      content: { "application/json": { schema: WorkflowCreateBodySchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: WorkflowDocSchema } },
      description: "Workflow created",
    },
    400: {
      content: { "application/json": { schema: ApiErrorSchema } },
      description: "Invalid workflow or name",
    },
    409: {
      content: { "application/json": { schema: ApiErrorSchema } },
      description: "Workflow with that name already exists",
    },
  },
});

const updateWorkflowRoute = createRoute({
  method: "put",
  path: "/workflows/:name",
  request: {
    params: z.object({ name: WorkflowNameParamSchema }),
    query: WorkflowsQuerySchema,
    body: {
      content: { "application/json": { schema: WorkflowUpdateBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: WorkflowDocSchema } },
      description: "Workflow updated",
    },
    400: {
      content: { "application/json": { schema: ApiErrorSchema } },
      description: "Invalid workflow",
    },
    404: {
      content: { "application/json": { schema: ApiErrorSchema } },
      description: "Workflow not found",
    },
    409: {
      content: { "application/json": { schema: ApiErrorSchema } },
      description: "Rename target exists or run is active",
    },
  },
});

const deleteWorkflowRoute = createRoute({
  method: "delete",
  path: "/workflows/:name",
  request: {
    params: z.object({ name: WorkflowNameParamSchema }),
    query: WorkflowsQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ deleted: z.string(), scope: WorkflowScopeSchema }),
        },
      },
      description: "Workflow deleted",
    },
    400: {
      content: { "application/json": { schema: ApiErrorSchema } },
      description: "Bad name or missing cwd",
    },
    404: {
      content: { "application/json": { schema: ApiErrorSchema } },
      description: "Workflow not found",
    },
    409: {
      content: { "application/json": { schema: ApiErrorSchema } },
      description: "Run is active — cannot delete",
    },
  },
});

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerWorkflowCrudRoutes(app: ApiApp, rm: RunManager): void {
  // GET /workflows/:name — read one
  app.openapi(getWorkflowRoute, async (c) => {
    const { name } = c.req.valid("param");
    const { cwd, scope } = c.req.valid("query");

    const target = resolveScopeTarget(scope, cwd);
    if (!target.ok) {
      return c.json({ code: "MISSING_CWD", message: "cwd query parameter is required" }, 400);
    }

    const file = resolveWorkflowFileInDir(target.dir, name);

    let content: string;
    try {
      content = await fs.readFile(file, "utf-8");
    } catch (err) {
      if ((err as { code?: string }).code === "ENOENT") {
        return c.json({ code: "NOT_FOUND", message: `Workflow not found: ${name}` }, 404);
      }
      throw err;
    }

    let workflow: unknown;
    try {
      workflow = JSON.parse(content) as unknown;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json(
        { code: "WORKFLOW_MALFORMED", message: `Workflow file is not valid JSON: ${message}` },
        400,
      );
    }
    return c.json({ name, path: file, scope: target.scope, workflow }, 200);
  });

  // POST /workflows — create
  app.openapi(createWorkflowRoute, async (c) => {
    const { cwd, scope } = c.req.valid("query");

    const target = resolveScopeTarget(scope, cwd);
    if (!target.ok) {
      return c.json({ code: "MISSING_CWD", message: "cwd query parameter is required" }, 400);
    }

    const body = c.req.valid("json");
    const { name, workflow: workflowData } = body;

    try {
      Workflow.fromJson(workflowData);
    } catch (err) {
      const { status, code, message } = mapError(err);
      return c.json({ code, message }, status as 400);
    }

    // Lazily create the target directory (project or global; ADR-002) on first write.
    await fs.mkdir(target.dir, { recursive: true });
    const file = resolveWorkflowFileInDir(target.dir, name);

    if (await fileExists(file)) {
      return c.json({ code: "WORKFLOW_EXISTS", message: `Workflow already exists: ${name}` }, 409);
    }

    await writeJsonAtomic(file, workflowData);
    return c.json({ name, path: file, scope: target.scope, workflow: workflowData }, 201);
  });

  // PUT /workflows/:name — update / rename
  app.openapi(updateWorkflowRoute, async (c) => {
    const { name } = c.req.valid("param");
    const { cwd, scope } = c.req.valid("query");

    const target = resolveScopeTarget(scope, cwd);
    if (!target.ok) {
      return c.json({ code: "MISSING_CWD", message: "cwd query parameter is required" }, 400);
    }

    const body = c.req.valid("json");
    const { name: newName, workflow: workflowData } = body;

    const file = resolveWorkflowFileInDir(target.dir, name);

    if (!await fileExists(file)) {
      return c.json({ code: "NOT_FOUND", message: `Workflow not found: ${name}` }, 404);
    }

    const isRename = newName !== undefined && newName !== name;

    if (isRename) {
      const snapshots = rm.list({ includeOldTerminal: true });
      const activeRunId = findActiveRunForWorkflow(snapshots, file);
      if (activeRunId !== null) {
        return c.json({
          code: "WORKFLOW_RUN_ACTIVE",
          message: `Cannot rename ${name}: a run is active`,
        }, 409);
      }
    }

    try {
      Workflow.fromJson(workflowData);
    } catch (err) {
      const { status, code, message } = mapError(err);
      return c.json({ code, message }, status as 400);
    }

    const targetName = newName ?? name;
    const targetFile = resolveWorkflowFileInDir(target.dir, targetName);

    if (isRename && await fileExists(targetFile)) {
      return c.json({ code: "WORKFLOW_EXISTS", message: `Workflow already exists: ${newName}` }, 409);
    }

    await writeJsonAtomic(targetFile, workflowData);

    if (isRename) {
      await fs.unlink(file);
    }

    return c.json({ name: targetName, path: targetFile, scope: target.scope, workflow: workflowData }, 200);
  });

  // DELETE /workflows/:name — delete
  app.openapi(deleteWorkflowRoute, async (c) => {
    const { name } = c.req.valid("param");
    const { cwd, scope } = c.req.valid("query");

    const target = resolveScopeTarget(scope, cwd);
    if (!target.ok) {
      return c.json({ code: "MISSING_CWD", message: "cwd query parameter is required" }, 400);
    }

    const file = resolveWorkflowFileInDir(target.dir, name);

    if (!await fileExists(file)) {
      return c.json({ code: "NOT_FOUND", message: `Workflow not found: ${name}` }, 404);
    }

    const snapshots = rm.list({ includeOldTerminal: true });
    const activeRunId = findActiveRunForWorkflow(snapshots, file);
    if (activeRunId !== null) {
      return c.json({
        code: "WORKFLOW_RUN_ACTIVE",
        message: `Cannot delete ${name}: a run is active`,
      }, 409);
    }

    await fs.unlink(file);
    return c.json({ deleted: name, scope: target.scope }, 200);
  });
}
