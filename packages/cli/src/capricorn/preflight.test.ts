/**
 * @license
 * Copyright 2026 Capricorn Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OllamaClient,
  resolveOllamaSettings,
  type Config,
} from '@google/gemini-cli-core';
import {
  startMockOllama,
  type MockOllama,
} from '@google/gemini-cli-core/dist/src/providers/ollama/testing/mockOllamaServer.js';
import { runPreflight } from './preflight.js';

let mock: MockOllama;

function fakeConfig(model: string) {
  let current = model;
  const setModel = vi.fn((m: string) => {
    current = m;
  });
  const config = {
    getModel: () => current,
    setModel,
    getOllamaSettings: () => resolveOllamaSettings({ endpoint: mock.url }),
  } as unknown as Config;
  return { config, setModel };
}

beforeEach(async () => {
  mock = await startMockOllama();
});
afterEach(async () => {
  await mock.close();
});

describe('runPreflight', () => {
  it('passes for an installed Gemma 4 model without changing it', async () => {
    const { config, setModel } = fakeConfig('gemma4:12b');
    expect(await runPreflight(config, { interactive: false })).toEqual({
      ok: true,
      model: 'gemma4:12b',
      switched: false,
    });
    expect(setModel).not.toHaveBeenCalled();
  });

  // Spec §4.1: never silently change models.
  it('fails headless when the model is missing and lists alternatives', async () => {
    const { config, setModel } = fakeConfig('gemma4:31b');
    const r = await runPreflight(config, { interactive: false });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.message).toContain('gemma4:12b');
    expect(setModel).not.toHaveBeenCalled();
  });

  it('switches interactively only after the user agrees', async () => {
    const { config, setModel } = fakeConfig('gemma4:31b');
    const confirm = vi.fn().mockResolvedValue(true);
    const r = await runPreflight(config, { interactive: true, confirm });
    expect(confirm).toHaveBeenCalledOnce();
    expect(r).toEqual({ ok: true, model: 'gemma4:12b', switched: true });
    expect(setModel).toHaveBeenCalledWith('gemma4:12b', true);
  });

  it('does not switch when the user declines', async () => {
    const { config, setModel } = fakeConfig('gemma4:31b');
    const r = await runPreflight(config, {
      interactive: true,
      confirm: async () => false,
    });
    expect(r.ok).toBe(false);
    expect(setModel).not.toHaveBeenCalled();
  });

  it('refuses a non-Gemma model even if it is installed', async () => {
    const { config } = fakeConfig('qwen3:8b');
    const r = await runPreflight(config, { interactive: false });
    expect(r.ok === false && r.message).toContain('not Gemma 4');
  });

  it('gives actionable advice when Ollama is down', async () => {
    const { config } = fakeConfig('gemma4:12b');
    await mock.close();
    const r = await runPreflight(config, {
      interactive: false,
      client: new OllamaClient({ endpoint: mock.url }),
    });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.message).toMatch(
      /Cannot connect to Ollama[\s\S]*Start Ollama/,
    );
  });
});
