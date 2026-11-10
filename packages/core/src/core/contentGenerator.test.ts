/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Capricorn modification (2026, Capricorn Contributors): the upstream suite
// tested Google GenAI / Vertex / Code Assist construction, which Capricorn
// removed. These tests pin the replacement contract: only the local Ollama
// back-end can be constructed, and Google credentials never change that.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AuthType,
  createContentGenerator,
  createContentGeneratorConfig,
  getAuthTypeFromEnv,
} from './contentGenerator.js';
import type { Config } from '../config/config.js';
import { LoggingContentGenerator } from './loggingContentGenerator.js';
import { RecordingContentGenerator } from './recordingContentGenerator.js';
import { FakeContentGenerator } from './fakeContentGenerator.js';
import { OllamaContentGenerator } from '../providers/ollama/ollamaContentGenerator.js';
import { resolveOllamaSettings } from '../providers/ollama/settings.js';
import { setActiveContextWindow, tokenLimit } from './tokenLimits.js';

vi.mock('./fakeContentGenerator.js');

function makeConfig(overrides: Partial<Record<string, unknown>> = {}): Config {
  return {
    getModel: () => 'gemma4:12b',
    getProxy: () => undefined,
    getOllamaSettings: () => resolveOllamaSettings({}),
    getUsageStatisticsEnabled: () => false,
    getClientName: () => undefined,
    fakeResponses: undefined,
    fakeResponsesNonStrict: undefined,
    recordResponses: undefined,
    ...overrides,
  } as unknown as Config;
}

/** Unwraps the logging decorator to reach the real generator. */
function inner(gen: unknown): unknown {
  return gen instanceof LoggingContentGenerator ? gen.getWrapped() : gen;
}

beforeEach(() => {
  vi.stubEnv('GEMINI_API_KEY', '');
  vi.stubEnv('GOOGLE_API_KEY', '');
  vi.stubEnv('GOOGLE_GENAI_USE_VERTEXAI', '');
  vi.stubEnv('GOOGLE_GENAI_USE_GCA', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  setActiveContextWindow(undefined);
});

describe('getAuthTypeFromEnv', () => {
  // Threat: a leftover cloud credential silently moving inference off-machine.
  it.each([
    ['GEMINI_API_KEY', 'key'],
    ['GOOGLE_GENAI_USE_VERTEXAI', 'true'],
    ['GOOGLE_GENAI_USE_GCA', 'true'],
    ['GOOGLE_GEMINI_BASE_URL', 'https://example.com'],
  ])('ignores %s and always returns OLLAMA', (name, value) => {
    vi.stubEnv(name, value);
    expect(getAuthTypeFromEnv()).toBe(AuthType.OLLAMA);
  });
});

describe('createContentGeneratorConfig', () => {
  it('drops API keys and base URLs passed by retained upstream callers', async () => {
    const cfg = await createContentGeneratorConfig(
      makeConfig(),
      AuthType.OLLAMA,
      'secret-key',
      'https://generativelanguage.googleapis.com',
    );
    expect(cfg).toEqual({ authType: AuthType.OLLAMA, proxy: undefined });
  });
});

describe('createContentGenerator', () => {
  it('builds the Ollama generator wrapped in logging', async () => {
    const gen = await createContentGenerator(
      { authType: AuthType.OLLAMA },
      makeConfig(),
    );
    expect(gen).toBeInstanceOf(LoggingContentGenerator);
    expect(inner(gen)).toBeInstanceOf(OllamaContentGenerator);
  });

  it('defaults to Ollama when no back-end is given', async () => {
    const gen = await createContentGenerator({}, makeConfig());
    expect(inner(gen)).toBeInstanceOf(OllamaContentGenerator);
  });

  it.each([
    AuthType.LOGIN_WITH_GOOGLE,
    AuthType.USE_GEMINI,
    AuthType.USE_VERTEX_AI,
    AuthType.COMPUTE_ADC,
    AuthType.GATEWAY,
    AuthType.LEGACY_CLOUD_SHELL,
  ])('refuses the hosted back-end %s', async (authType) => {
    await expect(
      createContentGenerator({ authType, apiKey: 'k' }, makeConfig()),
    ).rejects.toThrow(/only supports local inference through Ollama/);
  });

  it('refuses a remote endpoint without the user opt-in', async () => {
    const config = makeConfig({
      getOllamaSettings: () =>
        resolveOllamaSettings({ endpoint: 'http://198.51.100.7:11434' }),
    });
    await expect(
      createContentGenerator({ authType: AuthType.OLLAMA }, config),
    ).rejects.toMatchObject({
      kind: 'endpoint_not_allowed',
    });
  });

  it('registers the allocated context window for tokenLimit()', async () => {
    const config = makeConfig({
      getOllamaSettings: () => resolveOllamaSettings({ numCtx: 16384 }),
    });
    await createContentGenerator({ authType: AuthType.OLLAMA }, config);
    expect(tokenLimit('gemini-2.5-pro')).toBe(16384);
  });

  it('still supports fake responses for tests', async () => {
    const fake = {} as FakeContentGenerator;
    vi.mocked(FakeContentGenerator.fromFile).mockResolvedValue(fake);
    const gen = await createContentGenerator(
      {},
      makeConfig({ fakeResponses: '/tmp/x.jsonl' }),
    );
    expect(inner(gen)).toBe(fake);
  });

  it('wraps with the recorder when recording is requested', async () => {
    const gen = await createContentGenerator(
      {},
      makeConfig({ recordResponses: '/tmp/out.jsonl' }),
    );
    expect(gen).toBeInstanceOf(RecordingContentGenerator);
  });
});
