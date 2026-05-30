# WebSocket Protocol: `GET /runs/:id/attach`

Upgrade to `ws://127.0.0.1:<port>/runs/:id/attach`. The run id is the only routing
parameter; `runId` is implicit from the connection and is **not** repeated in frames.

## Query Parameters

| Parameter | Description |
|---|---|
| `fromSeq` | Resume: replay only events with `seq > fromSeq`. Omit for full history. |

## Server → Client Frames

All frames are JSON text. Discriminated by the `type` field.

| `type` | Shape | When sent |
|---|---|---|
| `snapshot` | `{ type: "snapshot", snapshot: RunDetail }` | Once on connect, before backlog. |
| `backlog` | `{ type: "backlog", entries: RunEvent[], truncated: boolean }` | Once on connect, after snapshot. `truncated: true` if the log exceeded the cap. |
| `event` | `{ type: "event", entry: RunEvent }` | Each live event while the run is active. |
| `status` | `{ type: "status", status: RunStatus }` | Each run-status transition. |
| `error` | `{ type: "error", code: string, message: string }` | Terminal protocol error; server closes after sending. |

**`RunEvent` shape:** `{ seq: number, ts: number, stepId: string | null, event: unknown }`

## Client → Server Frames

| `type` | Shape | Effect |
|---|---|---|
| `input` | `{ type: "input", message: string }` | Sends a user message to an interactive step. Rejected on non-interactive or terminal runs. |

## Resume (`fromSeq`)

Provide `?fromSeq=N` on the upgrade URL to receive only events with `seq > N`. The server
replays the filtered backlog, then streams live events from the current position. The
`truncated` flag on the `backlog` frame indicates that the backlog was capped before reaching
`fromSeq` (rare; no events are skipped in normal operation).

## Close Codes

| Code | Meaning |
|---|---|
| 1000 | Normal closure (client disconnect or run already terminal). |
| 1001 | Server going away (graceful daemon shutdown). |
| 1008 | Policy violation — malformed `input` frame or invalid `message`. |
| 1011 | Internal error. |

## Guardrails

- Maximum concurrent WS connections per daemon: 50. Connection refused with HTTP 503 beyond this.
- Idle timeout: 30 s with no frames in either direction.
- Outbound buffer cap: 256 frames. Slow consumers are closed with code 1008 on overflow.
