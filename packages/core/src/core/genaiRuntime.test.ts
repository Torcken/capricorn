/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

// The real SDK is imported here on purpose: tests are not bundled, and this
// is what proves the local stand-ins behave like the SDK they replace.
import * as sdk from '@google/genai';
import { describe, expect, it, vi } from 'vitest';
import * as local from './genaiRuntime.js';

describe('genaiRuntime matches @google/genai', () => {
  const enums = {
    Type: [local.Type, sdk.Type],
    FinishReason: [local.FinishReason, sdk.FinishReason],
    ThinkingLevel: [local.ThinkingLevel, sdk.ThinkingLevel],
    Environment: [local.Environment, sdk.Environment],
    FunctionCallingConfigMode: [
      local.FunctionCallingConfigMode,
      sdk.FunctionCallingConfigMode,
    ],
  };
  it.each(Object.entries(enums))(
    'enum %s has the same members and values',
    (_name, [mine, theirs]) => {
      expect({ ...mine }).toEqual({ ...theirs });
    },
  );

  const contentInputs: Array<sdk.PartListUnion | string> = [
    'hello',
    { text: 'part' },
    ['a', { text: 'b' }, { functionResponse: { name: 'f', response: {} } }],
    [{ inlineData: { mimeType: 'image/png', data: 'AA==' } }],
  ];
  it.each(contentInputs)('createUserContent(%j) matches', (input) => {
    expect(local.createUserContent(input)).toEqual(
      sdk.createUserContent(input),
    );
  });

  it('createUserContent rejects the same invalid inputs', () => {
    for (const bad of [[], [42], 42, { notAPart: true }]) {
      const sdkError = (() => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          sdk.createUserContent(bad as any);
          return undefined;
        } catch (e) {
          return (e as Error).message;
        }
      })();
      expect(sdkError).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(() => local.createUserContent(bad as any)).toThrow(sdkError);
    }
  });

  const responses: Array<Partial<sdk.GenerateContentResponse>> = [
    { candidates: [] },
    { candidates: [{ content: { role: 'model', parts: [] } }] },
    {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [
              { text: 'thinking', thought: true },
              { text: 'Hello ' },
              { text: '' },
              { text: 'world' },
              { functionCall: { name: 'a', args: { x: 1 } } },
              { functionCall: { name: 'b', args: {} } },
              { executableCode: { code: 'print(1)' } },
              { codeExecutionResult: { output: '1' } },
              { inlineData: { mimeType: 'text/plain', data: btoa('hi') } },
            ],
          },
        },
      ],
    },
    {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ text: 'only thought', thought: true }],
          },
        },
      ],
    },
    { candidates: [{ content: { role: 'model', parts: [{ text: '' }] } }] },
  ];
  it.each(responses)('GenerateContentResponse getters match for %j', (data) => {
    const a = Object.assign(new local.GenerateContentResponse(), data);
    const b = Object.assign(new sdk.GenerateContentResponse(), data);
    // The SDK getters warn about non-text parts; keep test output clean.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(a.text).toEqual(b.text);
      expect(a.data).toEqual(b.data);
      expect(a.functionCalls).toEqual(b.functionCalls);
      expect(a.executableCode).toEqual(b.executableCode);
      expect(a.codeExecutionResult).toEqual(b.codeExecutionResult);
    } finally {
      warn.mockRestore();
    }
  });

  it('ApiError carries message, name and status', () => {
    const e = new local.ApiError({ message: 'boom', status: 503 });
    const s = new sdk.ApiError({ message: 'boom', status: 503 });
    expect(e).toBeInstanceOf(Error);
    expect([e.name, e.message, e.status]).toEqual([
      s.name,
      s.message,
      s.status,
    ]);
  });
});
