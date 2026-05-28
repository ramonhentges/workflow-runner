import { describe, expect, it } from "bun:test";
import { asRunId, asRunSlug } from "./run.js";
import {
  ADJECTIVES,
  ANIMALS,
  generateRunId,
  generateSlug,
  parseIdentifier,
} from "./run-id.js";

describe("run id generation", () => {
  it("returns exactly 8 lowercase Crockford base32 characters", () => {
    const id = generateRunId();

    expect(id).toMatch(/^[0-9a-hjkmnp-tv-z]{8}$/);
  });

  it("is deterministic with an injected string source", () => {
    const rand = () => "fixed-uuid-string-here";

    expect(generateRunId(rand)).toBe(generateRunId(rand));
  });

  it("uses UUID hex as the random byte source", () => {
    expect(String(generateRunId(() => "00000000-0000-0000-0000-000000000000"))).toBe(
      "00000000",
    );
  });
});

describe("slug generation", () => {
  it("returns an adjective-animal slug", () => {
    expect(generateSlug()).toMatch(/^[a-z]+-[a-z]+$/);
  });

  it("is deterministic with an injected number source", () => {
    expect(String(generateSlug(() => 0))).toBe(`${ADJECTIVES[0]}-${ANIMALS[0]}`);
  });

  it("keeps wordlists unique and shell-friendly", () => {
    expect(new Set(ADJECTIVES).size).toBe(ADJECTIVES.length);
    expect(new Set(ANIMALS).size).toBe(ANIMALS.length);
    expect(ADJECTIVES.length).toBeGreaterThanOrEqual(150);
    expect(ANIMALS.length).toBeGreaterThanOrEqual(150);

    for (const word of [...ADJECTIVES, ...ANIMALS]) {
      expect(word).toMatch(/^[a-z]+$/);
    }
  });
});

describe("parseIdentifier", () => {
  it("matches an id prefix", () => {
    expect(
      parseIdentifier("kf2", [
        { id: asRunId("kf2a9xeh"), slug: asRunSlug("brave-otter") },
      ]),
    ).toEqual({ kind: "id", match: asRunId("kf2a9xeh") });
  });

  it("matches a slug prefix", () => {
    expect(
      parseIdentifier("brave", [
        { id: asRunId("kf2a9xeh"), slug: asRunSlug("brave-otter") },
      ]),
    ).toEqual({ kind: "slug", match: asRunId("kf2a9xeh") });
  });

  it("matches a full slug", () => {
    expect(
      parseIdentifier("brave-otter", [
        { id: asRunId("kf2a9xeh"), slug: asRunSlug("brave-otter") },
      ]),
    ).toEqual({ kind: "slug", match: asRunId("kf2a9xeh") });
  });

  it("returns ambiguous when a prefix matches multiple candidates", () => {
    expect(
      parseIdentifier("k", [
        { id: asRunId("kf2a9xeh"), slug: asRunSlug("brave-otter") },
        { id: asRunId("k83mnp4q"), slug: asRunSlug("wise-fox") },
      ]),
    ).toEqual({
      kind: "ambiguous",
      candidates: [asRunId("kf2a9xeh"), asRunId("k83mnp4q")],
    });
  });

  it("returns not-found when no id or slug matches", () => {
    expect(
      parseIdentifier("zzz", [
        { id: asRunId("kf2a9xeh"), slug: asRunSlug("brave-otter") },
      ]),
    ).toEqual({ kind: "not-found" });
  });

  it("matches case-insensitively", () => {
    expect(
      parseIdentifier("BRAVE", [
        { id: asRunId("kf2a9xeh"), slug: asRunSlug("brave-otter") },
      ]),
    ).toEqual({ kind: "slug", match: asRunId("kf2a9xeh") });
  });

  it("returns not-found for empty input even when candidates exist", () => {
    expect(
      parseIdentifier("", [
        { id: asRunId("kf2a9xeh"), slug: asRunSlug("brave-otter") },
        { id: asRunId("k83mnp4q"), slug: asRunSlug("wise-fox") },
      ]),
    ).toEqual({ kind: "not-found" });
  });
});
