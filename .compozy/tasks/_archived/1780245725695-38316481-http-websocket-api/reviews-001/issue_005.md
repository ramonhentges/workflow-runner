---
provider: manual
pr:
round: 1
round_created_at: 2026-05-30T12:34:08Z
status: resolved
file: src/app/api/routes/health.ts
line: 23
severity: low
author: claude-code
provider_ref:
---

# Issue 005: Health `version` resolution uses a source-tree-relative path fragile under build/

## Review Comment

`readVersion` locates `package.json` by walking up a fixed number of directory
levels from the module URL:

```ts
// src/app/api/routes/health.ts:23
const url = new URL("../../../../package.json", import.meta.url);
const pkg = (await Bun.file(url).json()) as { version?: unknown };
```

The `../../../../` depth is correct for `src/app/api/routes/health.ts` →
repo root, but it assumes the runtime directory layout matches the source tree.
`bun run build` compiles to `./build/`, where the relative depth from the emitted
module to a co-located `package.json` may differ, so the lookup can silently miss
and fall back to `"0.0.0"`. The health endpoint is the documented liveness probe
and `version` is part of its contract (`HealthReportSchema`), so a built daemon
quietly reporting `0.0.0` weakens that signal.

Suggested fix: resolve the version more robustly — e.g. read it from an
import-time constant injected at build, import the package.json directly (Bun
supports JSON imports) so the bundler resolves it, or resolve relative to a known
storage/install root rather than a hand-counted `../` depth. Add/extend a test
that asserts the built artifact reports the real version, not the `0.0.0`
fallback.

## Triage

- Decision: `valid`
- Notes: Confirmed. The build target is `bun build --target=node` which emits flat bundles at `build/index.js` and `build/daemon-entry.js`. From those flat paths, the hand-counted `../../../../package.json` relative to `import.meta.url` resolves 4 levels above the repo root — producing a wrong path and silently falling back to `"0.0.0"`. Root cause: path depth assumptions only hold in source-tree layout, not in the flat bundle output.

  Fix applied: replaced the runtime `readVersion()` function with a static `import pkg from "../../../../package.json" with { type: "json" }`. Bun's bundler inlines the JSON at compile time, making the version a build-time constant independent of any runtime path resolution. Also added `"resolveJsonModule": true` to `tsconfig.json` (required for TypeScript NodeNext mode to accept JSON imports). The `VERSION` constant now reads from the imported object with the same fallback guard.

  Verified that `"0.1.0"` appears in `build/daemon-entry.js` after build, confirming the value is inlined correctly.
