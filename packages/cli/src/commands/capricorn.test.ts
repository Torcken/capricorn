/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  findSettingDefinition,
  flattenSettings,
  parseSettingValue,
  redact,
} from './capricorn.js';

describe('config helpers', () => {
  it('finds nested setting definitions', () => {
    expect(findSettingDefinition('ollama.numCtx')?.type).toBe('number');
    expect(findSettingDefinition('ollama.think')?.type).toBe('enum');
    expect(findSettingDefinition('ollama.nope')).toBeUndefined();
  });

  it('validates values against the schema type', () => {
    expect(
      parseSettingValue(findSettingDefinition('ollama.numCtx')!, '16384'),
    ).toBe(16384);
    expect(() =>
      parseSettingValue(findSettingDefinition('ollama.numCtx')!, 'big'),
    ).toThrow(/number/);
    expect(() =>
      parseSettingValue(findSettingDefinition('ollama.think')!, 'maybe'),
    ).toThrow(/one of/);
    expect(
      parseSettingValue(
        findSettingDefinition('ollama.allowRemoteHost')!,
        'false',
      ),
    ).toBe(false);
    expect(() =>
      parseSettingValue(
        findSettingDefinition('ollama.allowRemoteHost')!,
        'yes',
      ),
    ).toThrow();
    expect(
      parseSettingValue(
        findSettingDefinition('security.network.allowedHosts')!,
        '["a.example"]',
      ),
    ).toEqual(['a.example']);
  });

  it('flattens nested settings to dotted keys', () => {
    expect(flattenSettings({ a: { b: 1, c: { d: 'x' } }, e: [1] })).toEqual({
      'a.b': 1,
      'a.c.d': 'x',
      e: [1],
    });
  });

  // Threat: `config list` output pasted into a bug report leaking credentials.
  it('redacts secret-looking keys and MCP env/headers', () => {
    expect(redact('mcpServers.x.env.GITHUB_TOKEN', 'ghp_123')).toBe(
      '<redacted>',
    );
    expect(redact('mcpServers.x.headers.Authorization', 'Bearer z')).toBe(
      '<redacted>',
    );
    expect(redact('security.auth.apiKey', 'k')).toBe('<redacted>');
    expect(redact('ollama.numCtx', 32768)).toBe(32768);
  });
});
