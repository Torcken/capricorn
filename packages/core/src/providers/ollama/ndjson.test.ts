/**
 * @license
 * Copyright 2026 Capricorn Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { parseNdjsonStream } from './ndjson.js';
import { OllamaErrorKind } from './errors.js';

const enc = new TextEncoder();

async function* chunks(...parts: Array<string | Uint8Array>) {
  for (const p of parts) yield typeof p === 'string' ? enc.encode(p) : p;
}

async function collect(gen: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const v of gen) out.push(v);
  return out;
}

describe('parseNdjsonStream', () => {
  it('parses several objects arriving in one chunk', async () => {
    expect(
      await collect(parseNdjsonStream(chunks('{"a":1}\n{"a":2}\n'))),
    ).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('reassembles a line split across chunks', async () => {
    expect(
      await collect(parseNdjsonStream(chunks('{"message":{"con', 'tent":"hi"}}\n'))),
    ).toEqual([{ message: { content: 'hi' } }]);
  });

  // Regression guard: naive per-chunk decoding turns split code points into
  // U+FFFD and corrupts non-ASCII model output.
  it('handles a multi-byte UTF-8 code point split across chunks', async () => {
    const bytes = enc.encode('{"t":"é🐐"}\n');
    const out = await collect(
      parseNdjsonStream(chunks(bytes.slice(0, 7), bytes.slice(7, 9), bytes.slice(9))),
    );
    expect(out).toEqual([{ t: 'é🐐' }]);
  });

  it('parses a final line with no trailing newline', async () => {
    expect(await collect(parseNdjsonStream(chunks('{"done":true}')))).toEqual([
      { done: true },
    ]);
  });

  it('skips blank keep-alive lines and CRLF endings', async () => {
    expect(
      await collect(parseNdjsonStream(chunks('\n{"a":1}\r\n\n', '{"a":2}\n'))),
    ).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('fails loudly on a malformed frame instead of skipping it', async () => {
    await expect(
      collect(parseNdjsonStream(chunks('{"a":1}\n{not json}\n'))),
    ).rejects.toMatchObject({ kind: OllamaErrorKind.INVALID_RESPONSE });
  });

  // Threat: a hostile or broken endpoint streaming an endless line to exhaust memory.
  it('bounds memory for a line without newline', async () => {
    await expect(
      collect(parseNdjsonStream(chunks('{"a":"', 'x'.repeat(200)), 100)),
    ).rejects.toMatchObject({ kind: OllamaErrorKind.INVALID_RESPONSE });
  });

  it('accepts a web ReadableStream', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode('{"x":1}\n'));
        c.close();
      },
    });
    expect(await collect(parseNdjsonStream(stream))).toEqual([{ x: 1 }]);
  });
});
