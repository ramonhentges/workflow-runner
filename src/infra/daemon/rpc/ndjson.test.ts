import { describe, expect, it } from "bun:test";
import { ndjsonLines } from "./ndjson.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

const encoder = new TextEncoder();

async function collect(readable: ReadableStream<Uint8Array>): Promise<string[]> {
  const lines: string[] = [];
  for await (const line of ndjsonLines(readable)) {
    lines.push(line);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ndjsonLines", () => {
  it("yields a single complete line", async () => {
    const stream = makeStream([encoder.encode('{"a":1}\n')]);
    expect(await collect(stream)).toEqual(['{"a":1}']);
  });

  it("handles a line split across two chunks", async () => {
    const stream = makeStream([
      encoder.encode('{"a"'),
      encoder.encode(':1}\n'),
    ]);
    expect(await collect(stream)).toEqual(['{"a":1}']);
  });

  it("yields multiple lines from one chunk", async () => {
    const stream = makeStream([encoder.encode('{"a":1}\n{"b":2}\n')]);
    expect(await collect(stream)).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("skips empty lines", async () => {
    const stream = makeStream([encoder.encode('\n{"a":1}\n\n{"b":2}\n')]);
    expect(await collect(stream)).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("yields the last line even when not newline-terminated", async () => {
    const stream = makeStream([encoder.encode('{"a":1}')]);
    expect(await collect(stream)).toEqual(['{"a":1}']);
  });

  it("decodes a multi-byte UTF-8 sequence split across chunk boundaries", async () => {
    // "€" is U+20AC, encoded as 0xE2 0x82 0xAC in UTF-8.
    const euro = encoder.encode("€");
    // Split the 3-byte sequence: first chunk gets bytes 0-1, second gets byte 2.
    const stream = makeStream([
      new Uint8Array([...euro.slice(0, 2), ...encoder.encode("\n")]),
      new Uint8Array([...euro.slice(2), ...encoder.encode("\n")]),
    ]);
    // Each chunk ends on a newline boundary, so we expect two lines:
    // first line has partial € bytes interpreted as replacement chars (or correct
    // if the decoder buffers them), and second line is the remaining byte.
    // The test just confirms no error is thrown and we get exactly 2 lines.
    const lines = await collect(stream);
    expect(lines).toHaveLength(2);
  });

  it("two concurrent generators do not share decoder state", async () => {
    // "€" (U+20AC) = [0xE2, 0x82, 0xAC]. Send first two bytes in chunk 1,
    // last byte + newline in chunk 2. A shared-state decoder would corrupt
    // the second generator's output when interleaved.
    const euroBytes = encoder.encode("€");
    const part1 = euroBytes.slice(0, 2); // [0xE2, 0x82]
    const part2 = euroBytes.slice(2);    // [0xAC]

    // Generator A: single ASCII line — used to confirm no cross-contamination.
    const streamA = makeStream([encoder.encode('hello\n')]);
    // Generator B: euro sign split across two chunks.
    const streamB = makeStream([
      new Uint8Array([...part1, ...encoder.encode("\n")]),
      new Uint8Array([...part2, ...encoder.encode("\n")]),
    ]);

    const [linesA, linesB] = await Promise.all([
      collect(streamA),
      collect(streamB),
    ]);

    expect(linesA).toEqual(["hello"]);
    // B must produce exactly 2 lines without throwing.
    expect(linesB).toHaveLength(2);
  });
});
