import { describe, expect, it } from 'vitest';
import { SnagonError } from '../../src/lib/errors.ts';
import { parseNdjson } from '../../src/lib/provider/ndjson.ts';

function streamOf(pieces: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const value of parseNdjson(stream)) out.push(value);
  return out;
}

describe('parseNdjson', () => {
  it('yields one value per line', async () => {
    expect(await collect(streamOf(['{"a":1}\n{"a":2}\n']))).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('joins a line split across chunks', async () => {
    const chunks = ['{"mess', 'age":{"content":"xin"}}\n', '{"done":true}\n'];
    expect(await collect(streamOf(chunks))).toEqual([
      { message: { content: 'xin' } },
      { done: true },
    ]);
  });

  it('accepts CRLF, blank lines and a last line without a newline', async () => {
    expect(await collect(streamOf(['{"a":1}\r\n\r\n{"a":2}']))).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('does not break a multi-byte character split across chunks', async () => {
    const bytes = new TextEncoder().encode('{"t":"chào"}\n');
    const cut = 9; // between the two bytes of "à"
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, cut));
        controller.enqueue(bytes.slice(cut));
        controller.close();
      },
    });
    expect(await collect(stream)).toEqual([{ t: 'chào' }]);
  });

  it('throws E_OUTPUT on a malformed line', async () => {
    await expect(collect(streamOf(['{"a":1}\nnot json\n']))).rejects.toMatchObject({
      code: 'E_OUTPUT',
    });
    await expect(collect(streamOf(['{oops']))).rejects.toBeInstanceOf(SnagonError);
  });

  it('releases the stream when the consumer stops early', async () => {
    const stream = streamOf(['{"a":1}\n{"a":2}\n{"a":3}\n']);
    for await (const value of parseNdjson(stream)) {
      expect(value).toEqual({ a: 1 });
      break;
    }
    expect(stream.locked).toBe(false);
  });
});
