import { describe, test } from "bun:test";

// F8 / ADR-002 — multi-attach broadcast with writer-slot handoff is Phase 2.
// V1 does not deliver the `event.run.writerSlot` notification beyond a
// constant stub, so this scenario is intentionally skipped until Phase 2.
describe("integration: multi-attach (Phase 2)", () => {
  test.skip("two subscribers see same events; writer slot promotes on first detach", () => {
    // TODO: implement when F8 (writer slot) lands. See ADR-002 and PRD F8.
  });
});
