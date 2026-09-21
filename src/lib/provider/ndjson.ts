import { SnagonError } from '../errors.ts';

/**
 * Parses an NDJSON byte stream (Ollama's `application/x-ndjson`) line by line.
 * Tolerates chunks that split a line or a multi-byte character, CRLF, blank lines,
 * and a final line without a trailing newline. A non-JSON line → SnagonError('E_OUTPUT').
 */
export async function* parseNdjson(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<unknown, void, undefined> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) yield parseLine(line);
        newline = buffer.indexOf('\n');
      }
    }
    buffer += decoder.decode();
    const rest = buffer.trim();
    if (rest) yield parseLine(rest);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function parseLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    throw new SnagonError('E_OUTPUT', 'malformed NDJSON line', line.slice(0, 200));
  }
}
