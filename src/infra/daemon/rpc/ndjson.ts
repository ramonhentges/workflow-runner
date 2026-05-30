/**
 * Splits a ReadableStream<Uint8Array> into lines on '\n'.
 * Handles partial lines across chunk boundaries.
 * Empty lines are skipped.
 */
export async function* ndjsonLines(
  readable: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  const reader = readable.getReader();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        const trimmed = buffer.trim();
        if (trimmed) yield trimmed;
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop()!;
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) yield trimmed;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
