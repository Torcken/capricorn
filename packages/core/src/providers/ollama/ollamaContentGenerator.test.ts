/**
 * @license
 * Copyright 2026 Capricorn Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GenerateContentResponse } from '@google/genai';
import { OllamaClient } from './client.js';
import { OllamaContentGenerator, type OllamaGeneratorSettings } from './ollamaContentGenerator.js';
import { OllamaErrorKind } from './errors.js';
import {
  doneFrame,
  startMockOllama,
  textFrame,
  toolCallFrame,
  type MockOllama,
} from './testing/mockOllamaServer.js';
import { LlmRole } from '../../telemetry/llmRole.js';

let mock: MockOllama;
let active: string;

function generator(overrides: Partial<OllamaGeneratorSettings> = {}) {
  return new OllamaContentGenerator(
    new OllamaClient({ endpoint: mock.url, streamIdleTimeoutMs: 500 }),
    {
      getActiveModel: () => active,
      numCtx: 32768,
      think: 'auto',
      retryBaseDelayMs: 1,
      ...overrides,
    },
  );
}

async function collect(gen: AsyncGenerator<GenerateContentResponse>) {
  const out: GenerateContentResponse[] = [];
  for await (const c of gen) out.push(c);
  return out;
}

const TOOLS = [
  {
    functionDeclarations: [
      { name: 'read_file', description: 'Read a file', parametersJsonSchema: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] } },
    ],
  },
];

beforeEach(async () => {
  mock = await startMockOllama();
  active = 'gemma4:12b';
});

afterEach(async () => {
  await mock.close();
});

describe('OllamaContentGenerator model resolution', () => {
  // Core safety property: upstream Gemini model names are always served by
  // the active verified Gemma 4 model, never by anything else.
  it.each(['gemini-2.5-flash-lite', 'auto-gemini-3', 'gemini-3-pro-preview', ''])(
    'serves upstream alias %j with the active Gemma model',
    async (alias) => {
      mock.enqueueChat({ frames: [textFrame('hi'), doneFrame()] });
      await collect(
        await generator().generateContentStream({ model: alias, contents: 'x' }, 'p', LlmRole.MAIN),
      );
      expect(mock.chatRequests()[0].body).toMatchObject({ model: 'gemma4:12b' });
    },
  );

  it.each([
    ['qwen3:8b', 'wrong family'],
    ['gemma4:fake', 'misleading alias'],
    ['gemma4:31b-cloud', 'cloud model'],
  ])('refuses %s (%s) without sending a chat request', async (model) => {
    await expect(
      generator().generateContentStream({ model, contents: 'x' }, 'p', LlmRole.MAIN),
    ).rejects.toMatchObject({ kind: OllamaErrorKind.MODEL_NOT_ALLOWED });
    expect(mock.chatRequests()).toHaveLength(0);
  });

  it('refuses when the active model itself is not Gemma 4', async () => {
    active = 'qwen3:8b';
    await expect(
      generator().generateContent({ model: 'gemini-2.5-pro', contents: 'x' }, 'p', LlmRole.MAIN),
    ).rejects.toMatchObject({ kind: OllamaErrorKind.MODEL_NOT_ALLOWED });
    expect(mock.chatRequests()).toHaveLength(0);
  });

  it('reports a missing model as MODEL_NOT_FOUND', async () => {
    active = 'gemma4:31b';
    await expect(
      generator().generateContent({ model: 'auto', contents: 'x' }, 'p', LlmRole.MAIN),
    ).rejects.toMatchObject({ kind: OllamaErrorKind.MODEL_NOT_FOUND });
  });
});

describe('OllamaContentGenerator streaming', () => {
  it('converts a tool-call turn and attaches finishReason + usage at the end', async () => {
    mock.enqueueChat({
      frames: [
        textFrame('Let me look.'),
        toolCallFrame({ id: 'c1', name: 'read_file', args: { file_path: 'README.md' } }, { id: 'c2', name: 'read_file', args: { file_path: 'b.md' } }),
        doneFrame({ prompt: 100, output: 20 }),
      ],
      chunkBytes: 5,
    });
    const chunks = await collect(
      await generator().generateContentStream(
        { model: 'gemma4:12b', contents: 'read', config: { tools: TOOLS, systemInstruction: 'sys' } },
        'p',
        LlmRole.MAIN,
      ),
    );
    const calls = chunks.flatMap((c) => c.functionCalls ?? []);
    expect(calls.map((c) => [c.id, c.name, c.args])).toEqual([
      ['c1', 'read_file', { file_path: 'README.md' }],
      ['c2', 'read_file', { file_path: 'b.md' }],
    ]);
    const last = chunks.at(-1)!;
    expect(last.candidates?.[0].finishReason).toBe('STOP');
    expect(last.usageMetadata?.promptTokenCount).toBe(100);

    const body = mock.chatRequests()[0].body as Record<string, unknown>;
    expect(body).toMatchObject({
      stream: true,
      options: { num_ctx: 32768 },
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'read' },
      ],
    });
    expect((body['tools'] as unknown[]).length).toBe(1);
  });

  it('caps num_ctx at the model maximum', async () => {
    mock.enqueueChat({ frames: [doneFrame()] });
    await collect(
      await generator({ numCtx: 10_000_000 }).generateContentStream({ model: 'auto', contents: 'x' }, 'p', LlmRole.MAIN),
    );
    const last = mock.chatRequests().at(-1)!.body as { options: { num_ctx: number } };
    expect(last.options.num_ctx).toBe(262144);
  });

  it('retries a stream that fails before producing output', async () => {
    mock.enqueueChat(
      { frames: [textFrame('x'), doneFrame()], truncateAfterFrames: 0 },
      { frames: [textFrame('recovered'), doneFrame()] },
    );
    const chunks = await collect(
      await generator().generateContentStream({ model: 'auto', contents: 'x' }, 'p', LlmRole.MAIN),
    );
    expect(chunks.map((c) => c.text ?? '').join('')).toBe('recovered');
    expect(mock.chatRequests()).toHaveLength(2);
  });

  // Regression guard: retrying after partial output would duplicate text.
  it('does not retry once output has been yielded', async () => {
    mock.enqueueChat(
      { frames: [textFrame('partial'), textFrame('x'), doneFrame()], truncateAfterFrames: 1, delayMs: 50 },
      { frames: [textFrame('should not be used'), doneFrame()] },
    );
    const gen = await generator().generateContentStream({ model: 'auto', contents: 'x' }, 'p', LlmRole.MAIN);
    await expect(collect(gen)).rejects.toBeDefined();
    expect(mock.chatRequests()).toHaveLength(1);
  });

  it('does not retry non-retryable errors such as out-of-memory', async () => {
    mock.enqueueChat({ frames: [], status: 500, errorBody: { error: 'out of memory' } });
    const gen = await generator().generateContentStream({ model: 'auto', contents: 'x' }, 'p', LlmRole.MAIN);
    await expect(collect(gen)).rejects.toMatchObject({ kind: OllamaErrorKind.RESOURCE_EXHAUSTED });
    expect(mock.chatRequests()).toHaveLength(1);
  });

  it('propagates cancellation through the abort signal', async () => {
    mock.enqueueChat({ frames: [textFrame('a'), textFrame('b'), textFrame('c'), doneFrame()], delayMs: 100 });
    const ac = new AbortController();
    const gen = await generator().generateContentStream(
      { model: 'auto', contents: 'x', config: { abortSignal: ac.signal } },
      'p',
      LlmRole.MAIN,
    );
    await gen.next();
    ac.abort();
    await expect(gen.next()).rejects.toMatchObject({ kind: OllamaErrorKind.CANCELLED });
  });
});

describe('OllamaContentGenerator thinking', () => {
  const send = async (settings: Partial<OllamaGeneratorSettings>, model: string, includeThoughts?: boolean) => {
    active = model;
    mock.enqueueChat({ frames: [doneFrame()] });
    await collect(
      await generator(settings).generateContentStream(
        { model: 'auto', contents: 'x', config: includeThoughts === undefined ? {} : { thinkingConfig: { includeThoughts } } },
        'p',
        LlmRole.MAIN,
      ),
    );
    return mock.chatRequests().at(-1)!.body as { think?: boolean };
  };

  it('follows the request in auto mode', async () => {
    expect((await send({}, 'gemma4:12b', true)).think).toBe(true);
    expect((await send({}, 'gemma4:12b', false)).think).toBe(false);
  });

  it('honours forced modes', async () => {
    expect((await send({ think: 'off' }, 'gemma4:12b', true)).think).toBe(false);
    expect((await send({ think: 'on' }, 'gemma4:12b')).think).toBe(true);
  });

  // Ollama rejects `think` for models without the capability.
  it('omits think for models without the thinking capability', async () => {
    expect((await send({ think: 'on' }, 'gemma4:e4b')).think).toBeUndefined();
  });

  it('emits thinking as thought parts, separate from the answer text', async () => {
    mock.enqueueChat({
      frames: [{ message: { role: 'assistant', content: '', thinking: 'reasoning' }, done: false }, textFrame('answer'), doneFrame()],
    });
    const chunks = await collect(
      await generator().generateContentStream({ model: 'auto', contents: 'x' }, 'p', LlmRole.MAIN),
    );
    const parts = chunks.flatMap((c) => c.candidates?.[0].content?.parts ?? []);
    expect(parts.filter((p) => p.thought).map((p) => p.text)).toEqual(['reasoning']);
    // The SDK `.text` getter excludes thoughts, so reasoning never leaks as answer text.
    expect(chunks.map((c) => c.text ?? '').join('')).toBe('answer');
  });
});

describe('OllamaContentGenerator non-streamed, tokens and embeddings', () => {
  it('returns a converted single response', async () => {
    mock.enqueueChat({ frames: [textFrame('{"a":1}'), doneFrame()] });
    const r = await generator().generateContent(
      { model: 'gemini-2.5-flash', contents: 'json please', config: { responseMimeType: 'application/json', responseJsonSchema: { type: 'object' } } },
      'p',
      LlmRole.UTILITY_TOOL,
    );
    expect(r.text).toBe('{"a":1}');
    expect(mock.chatRequests()[0].body).toMatchObject({ stream: false, format: { type: 'object' } });
  });

  it('estimates tokens locally without any network call', async () => {
    const before = mock.requests.length;
    const r = await generator().countTokens({ model: 'auto', contents: 'a'.repeat(400) });
    expect(r.totalTokens).toBeGreaterThan(50);
    expect(mock.requests.length).toBe(before);
  });

  it('refuses embeddings instead of fabricating vectors', async () => {
    await expect(generator().embedContent({ model: 'x', contents: 'a' })).rejects.toMatchObject({
      kind: OllamaErrorKind.MODEL_NOT_ALLOWED,
    });
  });
});
