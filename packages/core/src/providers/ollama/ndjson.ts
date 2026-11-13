/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Incremental newline-delimited JSON (NDJSON) decoder for
 * Ollama streaming responses.
 *
 * Ollama streams `/api/chat` and `/api/pull` as one JSON object per line.
 * The HTTP body, however, arrives in arbitrary byte chunks, so a chunk may:
 *   - contain several complete lines,
 *   - end in the middle of a line (or even mid UTF-8 code point),
 *   - contain only a fragment of one very long line.
 *
 * State machine (per call to {@link parseNdjsonStream}):
 *   `buffer` holds decoded text not yet terminated by `\n`. For each chunk we
 *   append decoded text, split on `\n`, emit every complete line and keep the
 *   final (possibly empty) fragment in `buffer`. At end-of-stream any
 *   non-blank remainder is parsed as a final line, because some proxies strip
 *   the trailing newline.
 *
 * Invariants:
 *   - Every emitted value is the result of `JSON.parse` on exactly one line.
 *   - No line is ever emitted twice or partially.
 *   - Memory is bounded by `maxLineBytes`; an attacker-controlled or buggy
 *     endpoint cannot make us buffer an unbounded line.
 */

import { OllamaError, OllamaErrorKind } from './errors.js';

/** Default cap on a single NDJSON line (16 MiB) — far above any real frame. */
export const DEFAULT_MAX_NDJSON_LINE_CHARS = 16 * 1024 * 1024;

/**
 * Decodes a byte stream into parsed JSON values, one per line.
 *
 * @param body The response body stream.
 * @param maxLineChars Upper bound for a buffered line, in UTF-16 code units.
 * @yields Each parsed line as `unknown`: callers must validate the shape,
 *   because the stream comes from outside the process.
 * @throws {OllamaError} `INVALID_RESPONSE` on malformed JSON or an oversized
 *   line. Transport errors from the underlying reader propagate unchanged so
 *   the caller can normalize them with its abort-signal context.
 */
export async function* parseNdjsonStream(
  body: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>,
  maxLineChars = DEFAULT_MAX_NDJSON_LINE_CHARS,
): AsyncGenerator<unknown, void, undefined> {
  // `stream: true` keeps incomplete multi-byte sequences inside the decoder
  // between chunks instead of emitting U+FFFD replacement characters.
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  for await (const chunk of toAsyncIterable(body)) {
    buffer += decoder.decode(chunk, { stream: true });
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      const parsed = parseLine(line);
      if (parsed !== SKIP) {
        yield parsed;
      }
      newlineIndex = buffer.indexOf('\n');
    }
    if (buffer.length > maxLineChars) {
      throw new OllamaError(
        OllamaErrorKind.INVALID_RESPONSE,
        `Ollama stream line exceeded ${maxLineChars} characters without a newline.`,
      );
    }
  }

  // Flush the decoder (emits any dangling partial code point as U+FFFD, which
  // will then fail JSON parsing loudly rather than silently corrupt text).
  buffer += decoder.decode();
  const parsed = parseLine(buffer);
  if (parsed !== SKIP) {
    yield parsed;
  }
}

/** Sentinel for blank lines (keep-alives / trailing newline). */
const SKIP: unique symbol = Symbol('skip');

function parseLine(line: string): unknown {
  const trimmed = line.trim();
  if (trimmed === '') {
    return SKIP;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch (e) {
    // Do not echo the full line: it may contain model output with user code.
    throw new OllamaError(
      OllamaErrorKind.INVALID_RESPONSE,
      `Ollama returned a malformed stream frame (${trimmed.length} chars).`,
      { cause: e },
    );
  }
}

/**
 * Web `ReadableStream` is async-iterable in Node >= 18, but its TypeScript
 * lib typing is not always; normalize both representations.
 */
function toAsyncIterable(
  body: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>,
): AsyncIterable<Uint8Array> {
  if (Symbol.asyncIterator in body) {
    return body;
  }
  return readerIterable(body);
}

/** Adapts a web stream without async-iterator support via its reader. */
function readerIterable(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator]() {
      const reader = stream.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          if (value) yield value;
        }
      } finally {
        reader.releaseLock();
      }
    },
  };
}
