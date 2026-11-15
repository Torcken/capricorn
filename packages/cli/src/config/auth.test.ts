/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Capricorn modification (2026, Guillaume S. Condamine & all awesome
// contributors): validateAuthMethod only accepts the local Ollama back-end; the
// upstream Google credential cases were replaced by these tests.

import { describe, expect, it, vi, afterEach } from 'vitest';
import { AuthType } from '@capricorn/core';
import { validateAuthMethod } from './auth.js';

afterEach(() => vi.unstubAllEnvs());

describe('validateAuthMethod', () => {
  it('accepts the local Ollama back-end', async () => {
    expect(await validateAuthMethod(AuthType.OLLAMA)).toBeNull();
  });

  it.each([
    AuthType.LOGIN_WITH_GOOGLE,
    AuthType.USE_GEMINI,
    AuthType.USE_VERTEX_AI,
    AuthType.COMPUTE_ADC,
    AuthType.GATEWAY,
    'something-else',
  ])('rejects %s with an explanation', async (method) => {
    expect(await validateAuthMethod(method)).toMatch(
      /only supports local inference through Ollama/,
    );
  });

  // Threat: a configured Google credential must not make a hosted method valid.
  it('rejects Gemini API key auth even when GEMINI_API_KEY is set', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'AIza-test');
    expect(await validateAuthMethod(AuthType.USE_GEMINI)).not.toBeNull();
  });
});
