import { describe, expect, it } from "bun:test";
import { mapError, ERROR_HTTP_STATUS } from "./error-map.js";
import { RunManagerError } from "../../infra/daemon/run-manager.js";
import { RpcErrorCode } from "../../infra/daemon/protocol.js";

// ---------------------------------------------------------------------------
// mapError — RunManagerError variants
// ---------------------------------------------------------------------------

describe("mapError RunManagerError", () => {
  it("maps WORKFLOW_RUN_ACTIVE to status 409 with code WORKFLOW_RUN_ACTIVE", () => {
    const err = new RunManagerError("WORKFLOW_RUN_ACTIVE", "workflow has active runs");
    const result = mapError(err);
    expect(result.status).toBe(409);
    expect(result.code).toBe("WORKFLOW_RUN_ACTIVE");
    expect(result.message).toBe("workflow has active runs");
  });

  it("maps WORKFLOW_EXISTS to status 409 with code WORKFLOW_EXISTS", () => {
    const err = new RunManagerError("WORKFLOW_EXISTS", "workflow already exists");
    const result = mapError(err);
    expect(result.status).toBe(409);
    expect(result.code).toBe("WORKFLOW_EXISTS");
    expect(result.message).toBe("workflow already exists");
  });

  it("maps UNKNOWN_RUN to status 404", () => {
    const err = new RunManagerError("UNKNOWN_RUN");
    const result = mapError(err);
    expect(result.status).toBe(404);
    expect(result.code).toBe("UNKNOWN_RUN");
  });

  it("maps CWD_INVALID to status 400", () => {
    const err = new RunManagerError("CWD_INVALID", "cwd is invalid");
    const result = mapError(err);
    expect(result.status).toBe(400);
    expect(result.code).toBe("CWD_INVALID");
  });

  it("maps NOT_A_GIT_REPO to status 400 with code NOT_A_GIT_REPO", () => {
    const err = new RunManagerError("NOT_A_GIT_REPO", "cwd is not a git repo");
    const result = mapError(err);
    expect(result.status).toBe(400);
    expect(result.code).toBe("NOT_A_GIT_REPO");
  });

  it("maps WORKTREE_CONFLICT to status 400 with code WORKTREE_CONFLICT", () => {
    const err = new RunManagerError("WORKTREE_CONFLICT", "worktree path is occupied");
    const result = mapError(err);
    expect(result.status).toBe(400);
    expect(result.code).toBe("WORKTREE_CONFLICT");
  });

  it("maps BRANCH_IN_USE to status 400 with code BRANCH_IN_USE", () => {
    const err = new RunManagerError("BRANCH_IN_USE", "branch is checked out elsewhere");
    const result = mapError(err);
    expect(result.status).toBe(400);
    expect(result.code).toBe("BRANCH_IN_USE");
  });
});

// ---------------------------------------------------------------------------
// ERROR_HTTP_STATUS — new code entries
// ---------------------------------------------------------------------------

describe("ERROR_HTTP_STATUS new entries", () => {
  it("maps WORKFLOW_RUN_ACTIVE numeric code to 409", () => {
    expect(ERROR_HTTP_STATUS[RpcErrorCode.WORKFLOW_RUN_ACTIVE]).toBe(409);
  });

  it("maps WORKFLOW_EXISTS numeric code to 409", () => {
    expect(ERROR_HTTP_STATUS[RpcErrorCode.WORKFLOW_EXISTS]).toBe(409);
  });

  it("maps NOT_A_GIT_REPO numeric code to 400", () => {
    expect(ERROR_HTTP_STATUS[RpcErrorCode.NOT_A_GIT_REPO]).toBe(400);
  });

  it("maps WORKTREE_CONFLICT numeric code to 400", () => {
    expect(ERROR_HTTP_STATUS[RpcErrorCode.WORKTREE_CONFLICT]).toBe(400);
  });

  it("maps BRANCH_IN_USE numeric code to 400", () => {
    expect(ERROR_HTTP_STATUS[RpcErrorCode.BRANCH_IN_USE]).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// mapError — non-RunManagerError variants
// ---------------------------------------------------------------------------

describe("mapError non-RunManagerError", () => {
  it("maps an unknown error to status 500", () => {
    const result = mapError(new Error("boom"));
    expect(result.status).toBe(500);
    expect(result.code).toBe("INTERNAL_ERROR");
  });

  it("maps a plain string throw to 500", () => {
    const result = mapError("something went wrong");
    expect(result.status).toBe(500);
    expect(result.code).toBe("INTERNAL_ERROR");
    expect(result.message).toBe("something went wrong");
  });
});
