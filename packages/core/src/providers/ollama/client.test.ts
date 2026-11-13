/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OllamaClient } from './client.js';
import { OllamaErrorKind } from './errors.js';
import {
  doneFrame,
  startMockOllama,
  textFrame,
  toolCallFrame,
  type MockOllama,
} from './testing/mockOllamaServer.js';
import type { OllamaChatResponse } from './wireTypes.js';

let mock: MockOllama;
let client: OllamaClient;

beforeEach(async () => {
  mock = await startMockOllama();
  client = new OllamaClient({ endpoint: mock.url, streamIdleTimeoutMs: 300 });
});

afterEach(async () => {
  await mock.close();
});

async function drain(gen: AsyncIterable<OllamaChatResponse>) {
  const frames: OllamaChatResponse[] = [];
  for await (const f of gen) frames.push(f);
  return frames;
}

const req = {
  model: 'gemma4:12b',
  messages: [{ role: 'user' as const, content: 'hi' }],
  stream: true,
};

describe('OllamaClient metadata', () => {
  it('reads version, tags and show', async () => {
    expect(await client.version()).toBe('0.30.11');
    expect((await client.listModels()).map((m) => m.name)).toContain(
      'gemma4:12b',
    );
    const show = await client.showModel('gemma4:12b');
    expect(show.model_info?.['general.architecture']).toBe('gemma4');
  });

  it('maps a 404 from /api/show to MODEL_NOT_FOUND', async () => {
    await expect(client.showModel('nope:1b')).rejects.toMatchObject({
      kind: OllamaErrorKind.MODEL_NOT_FOUND,
    });
  });

  it('reports connection refused when no daemon is listening', async () => {
    await mock.close();
    const dead = new OllamaClient({ endpoint: mock.url });
    await expect(dead.version()).rejects.toMatchObject({
      kind: OllamaErrorKind.CONNECTION_REFUSED,
    });
  });

  it('rejects a responder that is not Ollama', async () => {
    const fake = new OllamaClient({
      fetch: async () => new Response('<html>hi</html>', { status: 200 }),
    });
    await expect(fake.version()).rejects.toMatchObject({
      kind: OllamaErrorKind.INVALID_RESPONSE,
    });
  });
});

describe('OllamaClient.chatStream', () => {
  it('yields frames assembled across 3-byte chunks', async () => {
    mock.enqueueChat({
      frames: [textFrame('Hel'), textFrame('lo é'), doneFrame()],
      chunkBytes: 3,
    });
    const frames = await drain(client.chatStream(req));
    expect(frames.map((f) => f.message?.content).join('')).toBe('Hello é');
    expect(frames.at(-1)?.done).toBe(true);
  });

  it('passes complete tool calls through', async () => {
    mock.enqueueChat({
      frames: [
        toolCallFrame({
          id: 'c1',
          name: 'read_file',
          args: { file_path: 'a' },
        }),
        doneFrame(),
      ],
    });
    const frames = await drain(client.chatStream(req));
    expect(frames[0].message?.tool_calls?.[0].function.name).toBe('read_file');
  });

  // Regression guard: a connection closed mid-answer must never look complete.
  it('throws STREAM_TRUNCATED when the stream ends without done', async () => {
    mock.enqueueChat({
      frames: [textFrame('partial'), textFrame('more'), doneFrame()],
      truncateAfterFrames: 1,
    });
    await expect(drain(client.chatStream(req))).rejects.toMatchObject({
      kind: OllamaErrorKind.STREAM_TRUNCATED,
    });
  });

  it('surfaces an in-band error frame as a classified error', async () => {
    mock.enqueueChat({
      frames: [
        textFrame('a'),
        {
          error: 'model requires more system memory (12 GiB) than is available',
        },
      ],
    });
    await expect(drain(client.chatStream(req))).rejects.toMatchObject({
      kind: OllamaErrorKind.RESOURCE_EXHAUSTED,
    });
  });

  it('maps HTTP 500 out-of-memory bodies to RESOURCE_EXHAUSTED', async () => {
    mock.enqueueChat({
      frames: [],
      status: 500,
      errorBody: { error: 'cudaMalloc failed: out of memory' },
    });
    await expect(drain(client.chatStream(req))).rejects.toMatchObject({
      kind: OllamaErrorKind.RESOURCE_EXHAUSTED,
      status: 500,
    });
  });

  it('reports MODEL_NOT_FOUND for an uninstalled model', async () => {
    await expect(
      drain(client.chatStream({ ...req, model: 'gemma4:31b' })),
    ).rejects.toMatchObject({
      kind: OllamaErrorKind.MODEL_NOT_FOUND,
    });
  });

  it('times out a stalled stream via the idle watchdog', async () => {
    mock.enqueueChat({
      frames: [textFrame('a'), textFrame('b'), doneFrame()],
      delayMs: 1000,
    });
    await expect(drain(client.chatStream(req))).rejects.toMatchObject({
      kind: OllamaErrorKind.TIMEOUT,
    });
  });

  it('reports user cancellation as CANCELLED, not TIMEOUT', async () => {
    mock.enqueueChat({
      frames: [textFrame('a'), textFrame('b'), doneFrame()],
      delayMs: 100,
    });
    const ac = new AbortController();
    const gen = client.chatStream(req, ac.signal);
    const first = await gen.next();
    expect(first.value?.message?.content).toBe('a');
    ac.abort();
    await expect(gen.next()).rejects.toMatchObject({
      kind: OllamaErrorKind.CANCELLED,
    });
  });

  it('forces stream:true and sends the request body verbatim otherwise', async () => {
    mock.enqueueChat({ frames: [doneFrame()] });
    await drain(
      client.chatStream({ ...req, stream: false, options: { num_ctx: 9000 } }),
    );
    expect(mock.chatRequests()[0].body).toMatchObject({
      stream: true,
      options: { num_ctx: 9000 },
    });
  });
});

describe('OllamaClient.chat (non-streamed)', () => {
  it('returns a single merged reply', async () => {
    mock.enqueueChat({
      frames: [textFrame('one '), textFrame('two'), doneFrame()],
    });
    const r = await client.chat(req);
    expect(r.message?.content).toBe('one two');
    expect(r.done).toBe(true);
  });
});

describe('OllamaClient.pullModel', () => {
  it('streams progress frames', async () => {
    const statuses: string[] = [];
    for await (const p of client.pullModel('gemma4:e2b'))
      statuses.push(p.status ?? '');
    expect(statuses.at(-1)).toBe('success');
  });
});
