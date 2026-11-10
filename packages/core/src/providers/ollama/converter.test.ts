/**
 * @license
 * Copyright 2026 Capricorn Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { FinishReason, Type, type Content } from '@google/genai';
import {
  MALFORMED_ARGS_MARKER,
  createToolCallIdAllocator,
  frameToResponse,
  geminiSchemaToJsonSchema,
  normalizeArguments,
  toFunctionCall,
  toOllamaFormat,
  toOllamaMessages,
  toOllamaOptions,
  toOllamaTools,
} from './converter.js';

describe('toOllamaMessages', () => {
  it('prepends the system instruction and maps roles', () => {
    const msgs = toOllamaMessages(
      [
        { role: 'user', parts: [{ text: 'hi' }] },
        { role: 'model', parts: [{ text: 'hello' }] },
      ],
      { parts: [{ text: 'You are Capricorn.' }] },
    );
    expect(msgs).toEqual([
      { role: 'system', content: 'You are Capricorn.' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
  });

  it('accepts bare strings and parts like the genai SDK', () => {
    expect(toOllamaMessages('just text')).toEqual([
      { role: 'user', content: 'just text' },
    ]);
  });

  // The adjacency invariant: each tool result must follow the assistant
  // message that requested it, and keep its call id for correlation.
  it('converts a parallel tool-call round trip preserving order and ids', () => {
    const history: Content[] = [
      { role: 'user', parts: [{ text: 'read both' }] },
      {
        role: 'model',
        parts: [
          { text: 'Reading.' },
          { functionCall: { id: 'c1', name: 'read_file', args: { file_path: 'a' } } },
          { functionCall: { id: 'c2', name: 'read_file', args: { file_path: 'b' } } },
        ],
      },
      {
        role: 'user',
        parts: [
          { functionResponse: { id: 'c1', name: 'read_file', response: { output: 'A' } } },
          { functionResponse: { id: 'c2', name: 'read_file', response: { error: 'ENOENT' } } },
        ],
      },
    ];
    expect(toOllamaMessages(history)).toEqual([
      { role: 'user', content: 'read both' },
      {
        role: 'assistant',
        content: 'Reading.',
        tool_calls: [
          { id: 'c1', function: { name: 'read_file', arguments: { file_path: 'a' } } },
          { id: 'c2', function: { name: 'read_file', arguments: { file_path: 'b' } } },
        ],
      },
      { role: 'tool', content: 'A', tool_name: 'read_file', tool_call_id: 'c1' },
      { role: 'tool', content: 'Error: ENOENT', tool_name: 'read_file', tool_call_id: 'c2' },
    ]);
  });

  it('JSON-encodes structured tool results without losing fields', () => {
    const [msg] = toOllamaMessages([
      { role: 'user', parts: [{ functionResponse: { name: 't', response: { a: 1, b: [2] } } }] },
    ]);
    expect(msg).toMatchObject({ role: 'tool', content: '{"a":1,"b":[2]}' });
  });

  it('drops prior thoughts by default and keeps them when asked', () => {
    const history: Content[] = [
      { role: 'model', parts: [{ text: 'secret plan', thought: true }, { text: 'answer' }] },
    ];
    expect(toOllamaMessages(history)).toEqual([{ role: 'assistant', content: 'answer' }]);
    expect(toOllamaMessages(history, undefined, { includeThinking: true })).toEqual([
      { role: 'assistant', content: 'answer', thinking: 'secret plan' },
    ]);
  });

  it('attaches images and marks unsupported media explicitly', () => {
    const [msg] = toOllamaMessages([
      {
        role: 'user',
        parts: [
          { text: 'look' },
          { inlineData: { mimeType: 'image/png', data: 'AAAA' } },
          { inlineData: { mimeType: 'application/pdf', data: 'BBBB' } },
        ],
      },
    ]);
    expect(msg.images).toEqual(['AAAA']);
    expect(msg.content).toContain('application/pdf omitted');
  });

  it('never echoes the internal malformed-args marker back to the model', () => {
    const [msg] = toOllamaMessages([
      {
        role: 'model',
        parts: [{ functionCall: { id: 'x', name: 'ls', args: { [MALFORMED_ARGS_MARKER]: 'bad' } } }],
      },
    ]);
    expect(msg.tool_calls?.[0].function.arguments).toEqual({});
  });
});

describe('toOllamaTools / geminiSchemaToJsonSchema', () => {
  it('prefers parametersJsonSchema and drops hosted Gemini tools', () => {
    const tools = toOllamaTools([
      {
        functionDeclarations: [
          {
            name: 'read_file',
            description: 'Read',
            parametersJsonSchema: { type: 'object', properties: { p: { type: 'string' } } },
          },
        ],
      },
      { googleSearch: {} },
    ]);
    expect(tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read',
          parameters: { type: 'object', properties: { p: { type: 'string' } } },
        },
      },
    ]);
  });

  it('converts upper-case Gemini Schema types and nullable', () => {
    expect(
      geminiSchemaToJsonSchema({
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, nullable: true },
          tags: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['name'],
        propertyOrdering: ['name', 'tags'],
      }),
    ).toEqual({
      type: 'object',
      properties: {
        name: { type: ['string', 'null'] },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['name'],
    });
  });

  it('gives parameterless tools an empty object schema', () => {
    expect(toOllamaTools([{ functionDeclarations: [{ name: 'now' }] }])[0].function.parameters)
      .toEqual({ type: 'object', properties: {} });
  });
});

describe('generation config mapping', () => {
  it('always sets num_ctx and maps sampling fields', () => {
    expect(
      toOllamaOptions({ temperature: 0.2, topP: 0.9, maxOutputTokens: 100, stopSequences: ['X'] }, 32768),
    ).toEqual({ num_ctx: 32768, temperature: 0.2, top_p: 0.9, num_predict: 100, stop: ['X'] });
  });

  it('maps JSON response schema to structured output format', () => {
    expect(
      toOllamaFormat({ responseMimeType: 'application/json', responseJsonSchema: { type: 'object' } }),
    ).toEqual({ type: 'object' });
    expect(toOllamaFormat({ responseMimeType: 'application/json' })).toBe('json');
    expect(toOllamaFormat({})).toBeUndefined();
  });
});

describe('response conversion', () => {
  it('builds text, thought and function-call parts with usage on the final frame', () => {
    const r = frameToResponse(
      {
        model: 'gemma4:12b',
        message: {
          content: 'Done.',
          thinking: 'hmm',
          tool_calls: [{ id: 'call_1', function: { name: 'ls', arguments: { dir: '.' } } }],
        },
        done: true,
        done_reason: 'stop',
        prompt_eval_count: 10,
        eval_count: 5,
      },
      createToolCallIdAllocator(),
    );
    expect(r.candidates?.[0].content?.parts).toEqual([
      { text: 'hmm', thought: true },
      { text: 'Done.' },
      { functionCall: { id: 'call_1', name: 'ls', args: { dir: '.' } } },
    ]);
    expect(r.candidates?.[0].finishReason).toBe(FinishReason.STOP);
    expect(r.usageMetadata).toEqual({ promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 });
    // The real SDK class, so upstream getters work.
    expect(r.functionCalls?.[0].name).toBe('ls');
  });

  it('omits finishReason and usage on intermediate frames', () => {
    const r = frameToResponse({ message: { content: 'par' }, done: false }, createToolCallIdAllocator());
    expect(r.candidates?.[0].finishReason).toBeUndefined();
    expect(r.usageMetadata).toBeUndefined();
  });

  it('maps length truncation to MAX_TOKENS', () => {
    const r = frameToResponse({ done: true, done_reason: 'length' }, createToolCallIdAllocator());
    expect(r.candidates?.[0].finishReason).toBe(FinishReason.MAX_TOKENS);
  });

  it('drops a tool call repeated across frames', () => {
    const ids = createToolCallIdAllocator();
    const seen = new Set<string>();
    const call = { id: 'dup', function: { name: 'ls', arguments: {} } };
    frameToResponse({ message: { content: '', tool_calls: [call] }, done: false }, ids, seen);
    const second = frameToResponse({ message: { content: '', tool_calls: [call] }, done: false }, ids, seen);
    expect(second.candidates?.[0].content?.parts).toEqual([]);
  });
});

describe('tool call validation (untrusted model output)', () => {
  const ids = createToolCallIdAllocator('t');

  it('accepts object arguments and assigns ids when missing', () => {
    const fc = toFunctionCall({ function: { name: 'ls', arguments: { a: 1 } } }, ids);
    expect(fc.name).toBe('ls');
    expect(fc.id).toMatch(/^t_/);
    expect(fc.args).toEqual({ a: 1 });
  });

  it('parses OpenAI-style JSON string arguments', () => {
    expect(normalizeArguments('{"path":"x"}')).toEqual({ path: 'x' });
  });

  it.each([
    ['not json', 'not valid JSON'],
    ['[1,2]', 'not an object'],
    [42, 'got number'],
    [[1], 'got array'],
  ])('marks malformed arguments %j', (raw, msg) => {
    const args = normalizeArguments(raw);
    expect(String(args[MALFORMED_ARGS_MARKER])).toContain(msg);
  });

  // Threat: a name crafted to look like a path or contain control characters.
  it('neutralizes syntactically invalid tool names', () => {
    const fc = toFunctionCall({ function: { name: '../../bin/sh; rm', arguments: {} } }, ids);
    expect(fc.name).toMatch(/^invalid_tool_name_/);
  });
});
