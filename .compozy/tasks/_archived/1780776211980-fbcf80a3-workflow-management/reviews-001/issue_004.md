---
provider: manual
pr:
round: 1
round_created_at: 2026-06-05T13:25:26Z
status: resolved
file: web/src/features/workflows/WorkflowDraftSchema.ts
line: 24
severity: low
author: claude-code
provider_ref:
---

# Issue 004: Web file-name validation drifts from the server's basename rule

## Review Comment

The web draft schema validates the file name with:

```ts
fileName: z.string().min(1, 'File name is required')
  .regex(/^[^/\\]+$/, 'File name cannot contain / or \\'),
```

This rejects `/` and `\` but still accepts `..`, `.`, and names like `..foo`
that contain `..`. The server's `WorkflowNameParamSchema`
(`src/app/api/schema.ts`) is stricter — it rejects any name containing `..` in
addition to `/` and `\`. So a user who types `..` (or a name containing `..`)
passes client validation, submits, and only then gets a server `400`.

The server is correctly authoritative (ADR-004), so this is not a safety hole.
But it works against the PRD's "validate before save / inline, specific
feedback" goal (Core Feature #5, UX considerations): the client should mirror
the server's basename rule so the author gets instant feedback on an illegal
name instead of a round-trip error. Severity low because it only affects an
uncommon input and degrades gracefully.

Suggested fix: tighten the `fileName` regex/refine to also reject `..` (mirror
`WorkflowNameParamSchema`), and add a schema test for it.

## Triage

- Decision: `valid`
- Notes:
  - Confirmed the drift: `WorkflowDraftSchema.fileName` (web) used
    `.regex(/^[^/\\]+$/)`, which rejects `/` and `\` but accepts `..`, `.`,
    and names like `..foo`. The server's `WorkflowNameParamSchema`
    (`src/app/api/schema.ts:126`) rejects any name containing `/`, `\`, or
    `..`. So a name containing `..` passed client validation and only failed
    server-side with a `400` round-trip.
  - Root cause: the client basename rule did not mirror the server's `..`
    exclusion, working against the PRD's "validate before save / inline,
    specific feedback" goal (not a safety hole — the server is authoritative
    per ADR-004).
  - Fix: added `.refine(v => !v.includes('..'), 'File name cannot contain ".."')`
    to the `fileName` chain so the client now mirrors the server's three
    exclusions (`/`, `\`, `..`). Added two schema tests covering `fileName`
    equal to `..` and containing `..` (`..foo`).
  - Verified: web typecheck + the full web test suite pass.
