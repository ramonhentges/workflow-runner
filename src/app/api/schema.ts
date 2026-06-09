import { z } from "zod";

export const RunStatusSchema = z.enum([
  "running",
  "completed",
  "failed",
  "crashed",
  "aborted",
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

// Wire shape of EventLogEntry (seq, ts, stepId, event).
// event is z.unknown() — validated structurally by the conformance test.
export const RunEventSchema = z.object({
  seq: z.number().int().positive(),
  ts: z.number(),
  stepId: z.string().nullable(),
  event: z.unknown(),
});
export type RunEvent = z.infer<typeof RunEventSchema>;

// List-row shape; mirrors RunListEntry from protocol.ts.
export const RunSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  workflowPath: z.string(),
  cwd: z.string().optional(),
  currentStepId: z.string().nullable(),
  status: RunStatusSchema,
  startedAt: z.number(),
  endedAt: z.number().nullable(),
  attachedCount: z.number().int().nonnegative(),
});
export type RunSummary = z.infer<typeof RunSummarySchema>;

// Detail shape; RunSnapshot listed fields + attachedCount.
export const RunDetailSchema = z.object({
  id: z.string(),
  slug: z.string(),
  workflowPath: z.string(),
  cwd: z.string().optional(),
  status: RunStatusSchema,
  currentStepId: z.string().nullable(),
  visitedStepIds: z.array(z.string()),
  startedAt: z.number(),
  endedAt: z.number().nullable(),
  attachedCount: z.number().int().nonnegative(),
});
export type RunDetail = z.infer<typeof RunDetailSchema>;

// Server → client WebSocket frames (ADR-004).
export const AttachFrameSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("snapshot"), snapshot: RunDetailSchema }),
  z.object({
    type: z.literal("backlog"),
    entries: z.array(RunEventSchema),
    truncated: z.boolean(),
  }),
  z.object({ type: z.literal("event"), entry: RunEventSchema }),
  z.object({ type: z.literal("status"), status: RunStatusSchema }),
  z.object({ type: z.literal("error"), code: z.string(), message: z.string() }),
]);
export type AttachFrame = z.infer<typeof AttachFrameSchema>;

// Client → server WebSocket frames.
export const InputFrameSchema = z.object({
  type: z.literal("input"),
  message: z.string().min(1),
});
export type InputFrame = z.infer<typeof InputFrameSchema>;

// Heartbeat frame: a live client sends these periodically so the server's idle
// timer (which closes quiet connections) does not reap a healthy interactive
// session while the user is reading or thinking. Carries no payload.
export const PingFrameSchema = z.object({
  type: z.literal("ping"),
});
export type PingFrame = z.infer<typeof PingFrameSchema>;

export const ClientFrameSchema = z.discriminatedUnion("type", [
  InputFrameSchema,
  PingFrameSchema,
]);
export type ClientFrame = z.infer<typeof ClientFrameSchema>;

export const StartRunRequestSchema = z.object({
  workflowPath: z.string().min(1),
  cwd: z.string().min(1),
});
export type StartRunRequest = z.infer<typeof StartRunRequestSchema>;

// GET /runs/:id/events query params — fromSeq coerced from query string.
export const EventsQuerySchema = z.object({
  fromSeq: z.coerce.number().int().nonnegative().optional(),
  stepId: z.string().min(1).optional(),
});
export type EventsQuery = z.infer<typeof EventsQuerySchema>;

export const EventsPageSchema = z.object({
  entries: z.array(RunEventSchema),
  truncated: z.boolean(),
});
export type EventsPage = z.infer<typeof EventsPageSchema>;

export const HealthReportSchema = z.object({
  status: z.literal("ok"),
  pid: z.number().int().positive(),
  uptimeMs: z.number().nonnegative(),
  activeRuns: z.number().int().nonnegative(),
  version: z.string(),
});
export type HealthReport = z.infer<typeof HealthReportSchema>;

// Written 0600 to daemon.json in the storage root (ADR-005).
export const DiscoveryFileSchema = z.object({
  pid: z.number().int().positive(),
  apiPort: z.number().int().positive(),
  socket: z.string(),
});
export type DiscoveryFile = z.infer<typeof DiscoveryFileSchema>;

// GET /workflows?cwd= (ADR-006).
export const WorkflowsQuerySchema = z.object({
  cwd: z.string().optional(),
});
export type WorkflowsQuery = z.infer<typeof WorkflowsQuerySchema>;

export const WorkflowItemSchema = z.object({
  name: z.string(),
  path: z.string(),
});
export type WorkflowItem = z.infer<typeof WorkflowItemSchema>;

export const WorkflowListSchema = z.object({
  workflows: z.array(WorkflowItemSchema),
});
export type WorkflowList = z.infer<typeof WorkflowListSchema>;

// Bare workflow name path param: no /, \, or .. sequences.
export const WorkflowNameParamSchema = z
  .string()
  .min(1)
  .refine(
    (v) => !v.includes("/") && !v.includes("\\") && !v.includes(".."),
    { message: "workflow name must be a safe bare filename" },
  );
export type WorkflowNameParam = z.infer<typeof WorkflowNameParamSchema>;

// POST /workflows body: { name, workflow }.
// workflow is z.unknown() — domain layer validates structure via Workflow.fromJson.
export const WorkflowCreateBodySchema = z.object({
  name: WorkflowNameParamSchema,
  workflow: z.unknown(),
});
export type WorkflowCreateBody = z.infer<typeof WorkflowCreateBodySchema>;

// PUT /workflows/:name body: { name?, workflow }.
export const WorkflowUpdateBodySchema = z.object({
  name: WorkflowNameParamSchema.optional(),
  workflow: z.unknown(),
});
export type WorkflowUpdateBody = z.infer<typeof WorkflowUpdateBodySchema>;

// GET /workflows/:name response.
export const WorkflowDocSchema = z.object({
  name: z.string(),
  path: z.string(),
  workflow: z.unknown(),
});
export type WorkflowDoc = z.infer<typeof WorkflowDocSchema>;

// GET /ide/:ide/catalog path param.
export const IdeCatalogParamSchema = z.object({
  ide: z.string().min(1),
});
export type IdeCatalogParam = z.infer<typeof IdeCatalogParamSchema>;

const IdeCatalogEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
});

// GET /ide/:ide/catalog response.
export const IdeCatalogSchema = z.object({
  reachable: z.boolean(),
  agents: z.array(IdeCatalogEntrySchema),
  models: z.array(IdeCatalogEntrySchema),
  reason: z.string().optional(),
});
export type IdeCatalog = z.infer<typeof IdeCatalogSchema>;
