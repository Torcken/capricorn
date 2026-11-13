/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OllamaClient,
  resolveOllamaSettings,
  type Config,
} from '@google/gemini-cli-core';
import {
  DEFAULT_MOCK_MODELS,
  startMockOllama,
  type MockOllama,
} from '@google/gemini-cli-core/dist/src/providers/ollama/testing/mockOllamaServer.js';
import { runPreflight } from './preflight.js';
import type { HardwareProfile } from './hardware.js';

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

describe('runPreflight on first run (no Gemma 4 model installed)', () => {
  const GIB = 1024 ** 3;
  // 32 GiB RAM, 8 GiB GPU: the default 12B does not fit, E4B does.
  const smallGpu = async (): Promise<HardwareProfile> => ({
    totalMemoryBytes: 32 * GIB,
    platform: 'linux',
    arch: 'x64',
    cpus: 8,
    gpus: [
      {
        vendor: 'nvidia',
        name: 'RTX 3070',
        memoryBytes: 8 * GIB,
        unified: false,
      },
    ],
  });
  const e4b = DEFAULT_MOCK_MODELS.find((m) => m.name === 'gemma4:e4b')!;

  beforeEach(async () => {
    await mock.close();
    mock = await startMockOllama({ models: [], pullable: [e4b] });
  });

  it('headless: recommends a model for this machine, pulls nothing', async () => {
    const { config, setModel } = fakeConfig('gemma4:12b');
    const r = await runPreflight(config, {
      interactive: false,
      detectHardware: smallGpu,
    });
    expect(r.ok).toBe(false);
    const msg = r.ok === false ? r.message : '';
    expect(msg).toContain('This machine: 32 GiB RAM, RTX 3070 (8 GiB)');
    expect(msg).toContain('Recommended: gemma4:e4b (runs on the GPU)');
    expect(msg).toContain('capricorn models pull gemma4:e4b');
    expect(mock.requests.some((q) => q.path === '/api/pull')).toBe(false);
    expect(setModel).not.toHaveBeenCalled();
  });

  it('asks with a default of "no" and pulls nothing when declined', async () => {
    const { config, setModel } = fakeConfig('gemma4:12b');
    const confirm = vi.fn().mockResolvedValue(false);
    const r = await runPreflight(config, {
      interactive: true,
      confirm,
      detectHardware: smallGpu,
      log: () => {},
    });
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining('Download gemma4:e4b now?'),
      { defaultYes: false },
    );
    expect(r.ok).toBe(false);
    expect(mock.requests.some((q) => q.path === '/api/pull')).toBe(false);
    expect(setModel).not.toHaveBeenCalled();
  });

  it('pulls, verifies and uses the model after the user agrees', async () => {
    const { config, setModel } = fakeConfig('gemma4:12b');
    const lines: string[] = [];
    const r = await runPreflight(config, {
      interactive: true,
      confirm: async () => true,
      detectHardware: smallGpu,
      log: (l) => lines.push(l),
    });
    expect(r).toEqual({ ok: true, model: 'gemma4:e4b', switched: true });
    expect(setModel).toHaveBeenCalledWith('gemma4:e4b', true);
    const pull = mock.requests.find((q) => q.path === '/api/pull');
    expect(pull?.body).toMatchObject({ model: 'gemma4:e4b' });
    expect(lines.join('\n')).toContain('capricorn models use gemma4:e4b');
    // The model was loaded once, at the session's context size.
    const load = mock
      .chatRequests()
      .find((q) => (q.body as { model?: string }).model === 'gemma4:e4b');
    expect(load?.body).toMatchObject({
      messages: [],
      options: { num_ctx: 32768 },
    });
  });

  // Seen with gemma4:e4b on Ollama 0.30.11: download and verification pass,
  // but the daemon cannot load the model.
  it('reports a model Ollama cannot load and does not start with it', async () => {
    mock.enqueueChat({
      frames: [],
      status: 500,
      errorBody: {
        error:
          'llama-server process has terminated: llama_init_from_model: failed to initialize the context: Gemma4Assistant requires ctx_other to be set',
      },
    });
    const { config, setModel } = fakeConfig('gemma4:12b');
    const r = await runPreflight(config, {
      interactive: true,
      confirm: async () => true,
      detectHardware: smallGpu,
      log: () => {},
    });
    expect(r.ok).toBe(false);
    const msg = r.ok === false ? r.message : '';
    expect(msg).toContain(
      'Downloaded gemma4:e4b, but Ollama could not load it',
    );
    expect(msg).toContain('Gemma4Assistant requires ctx_other');
    expect(msg).toContain('Update Ollama');
    expect(setModel).not.toHaveBeenCalled();
  });

  it('refuses to use a pulled model that fails verification', async () => {
    await mock.close();
    mock = await startMockOllama({
      models: [],
      pullable: [{ ...e4b, family: 'llama', architecture: 'llama' }],
    });
    const { config, setModel } = fakeConfig('gemma4:12b');
    const r = await runPreflight(config, {
      interactive: true,
      confirm: async () => true,
      detectHardware: smallGpu,
      log: () => {},
    });
    expect(r.ok === false && r.message).toContain('NOT usable');
    expect(setModel).not.toHaveBeenCalled();
  });

  it('offers no download when nothing fits this machine', async () => {
    const { config } = fakeConfig('gemma4:12b');
    const confirm = vi.fn();
    const r = await runPreflight(config, {
      interactive: true,
      confirm,
      detectHardware: async () => ({
        ...(await smallGpu()),
        totalMemoryBytes: 4 * GIB,
        gpus: [],
      }),
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(r.ok === false && r.message).toContain('Not enough memory');
  });
});
