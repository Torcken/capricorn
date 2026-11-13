/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  OllamaClient,
  resolveOllamaSettings,
  resolveOllamaEndpoint,
} from '@google/gemini-cli-core';
import {
  startMockOllama,
  type MockOllama,
} from '@google/gemini-cli-core/dist/src/providers/ollama/testing/mockOllamaServer.js';
import {
  compareVersions,
  renderReport,
  runDiagnostics,
} from './diagnostics.js';
import type { CapricornRuntime } from './runtime.js';

let mock: MockOllama;

const runtime = (model = 'gemma4:12b', numCtx = 32768): CapricornRuntime => ({
  settings: resolveOllamaSettings({ model, numCtx }),
  endpointSource: 'default',
  modelSource: 'default',
});

beforeEach(async () => {
  mock = await startMockOllama();
});
afterEach(async () => {
  await mock.close();
});

const byId = (r: Awaited<ReturnType<typeof runDiagnostics>>, id: string) =>
  r.checks.find((c) => c.id === id)!;

describe('runDiagnostics', () => {
  it('reports ready with a verified installed model', async () => {
    const report = await runDiagnostics({
      runtime: runtime(),
      client: new OllamaClient({ endpoint: mock.url }),
      version: 'test',
      cwd: process.cwd(),
    });
    expect(byId(report, 'ollama.daemon').status).toBe('pass');
    expect(byId(report, 'models.selected')).toMatchObject({ status: 'pass' });
    expect(byId(report, 'models.installed').message).toContain('gemma4:12b');
    // Decoys (qwen, misleading alias, cloud) are not offered.
    expect(byId(report, 'models.installed').message).not.toContain(
      'gemma4:fake',
    );
    expect(report.ok).toBe(true);
    expect(renderReport(report)).toContain('Result: ready.');
  });

  it('fails with alternatives when the configured model is missing', async () => {
    const report = await runDiagnostics({
      runtime: runtime('gemma4:31b'),
      client: new OllamaClient({ endpoint: mock.url }),
      version: 'test',
      cwd: process.cwd(),
    });
    const sel = byId(report, 'models.selected');
    expect(sel.status).toBe('fail');
    expect(sel.remediation).toContain('capricorn models use gemma4:12b');
    expect(report.ok).toBe(false);
  });

  it('rejects a non-Gemma model even if requested explicitly', async () => {
    const report = await runDiagnostics({
      runtime: runtime('gemma4:fake'),
      client: new OllamaClient({ endpoint: mock.url }),
      version: 'test',
      cwd: process.cwd(),
    });
    expect(byId(report, 'models.selected')).toMatchObject({ status: 'fail' });
    expect(byId(report, 'models.selected').message).toContain('not Gemma 4');
  });

  it('distinguishes a stopped daemon and skips model checks', async () => {
    await mock.close();
    const report = await runDiagnostics({
      runtime: runtime(),
      client: new OllamaClient({ endpoint: mock.url }),
      version: 'test',
      cwd: process.cwd(),
    });
    const daemon = byId(report, 'ollama.daemon');
    expect(daemon.status).toBe('fail');
    expect(daemon.data?.['kind']).toBe('connection_refused');
    expect(daemon.remediation).toMatch(/Start Ollama/);
    expect(byId(report, 'models.selected').status).toBe('skip');
  });

  it('reports an endpoint policy violation', async () => {
    let clientError: unknown;
    try {
      resolveOllamaEndpoint('http://203.0.113.9:11434');
    } catch (e) {
      clientError = e;
    }
    const report = await runDiagnostics({
      runtime: runtime(),
      client: undefined,
      clientError,
      version: 'test',
      cwd: process.cwd(),
    });
    expect(byId(report, 'ollama.endpoint').status).toBe('fail');
    expect(report.ok).toBe(false);
  });

  it('caps the context window at the model maximum and warns', async () => {
    const report = await runDiagnostics({
      runtime: runtime('gemma4:e4b', 1_000_000),
      client: new OllamaClient({ endpoint: mock.url }),
      version: 'test',
      cwd: process.cwd(),
    });
    expect(byId(report, 'models.context')).toMatchObject({
      status: 'warn',
      data: { effective: 131072 },
    });
  });
});

describe('runDiagnostics with loadModel (doctor --load)', () => {
  it('does not load the model unless asked', async () => {
    const report = await runDiagnostics({
      runtime: runtime(),
      client: new OllamaClient({ endpoint: mock.url }),
      version: 'test',
      cwd: process.cwd(),
    });
    expect(report.checks.some((c) => c.id === 'models.load')).toBe(false);
    expect(mock.chatRequests()).toHaveLength(0);
  });

  it('loads the model with no messages and the effective num_ctx', async () => {
    mock.enqueueChat({
      frames: [
        {
          message: { role: 'assistant', content: '' },
          done: true,
          done_reason: 'load',
        },
      ],
    });
    const report = await runDiagnostics({
      runtime: runtime('gemma4:e4b', 200_000),
      client: new OllamaClient({ endpoint: mock.url }),
      version: 'test',
      cwd: process.cwd(),
      loadModel: true,
    });
    const load = byId(report, 'models.load');
    expect(load.status).toBe('pass');
    expect(load.message).toMatch(/gemma4:e4b loaded with num_ctx 131072 in/);
    const [req] = mock.chatRequests();
    expect(req.body).toMatchObject({
      model: 'gemma4:e4b',
      messages: [],
      stream: false,
      options: { num_ctx: 131072 },
    });
    expect(report.ok).toBe(true);
  });

  it('fails with a remediation when Ollama cannot load the model', async () => {
    mock.enqueueChat({
      frames: [],
      status: 500,
      errorBody: {
        error:
          'llama runner process has terminated: Gemma4Assistant requires ctx_other',
      },
    });
    const report = await runDiagnostics({
      runtime: runtime(),
      client: new OllamaClient({ endpoint: mock.url }),
      version: 'test',
      cwd: process.cwd(),
      loadModel: true,
    });
    const load = byId(report, 'models.load');
    expect(load.status).toBe('fail');
    expect(load.message).toContain('could not load gemma4:12b');
    expect(load.message).toContain('Gemma4Assistant requires ctx_other');
    expect(load.remediation).toContain('Update Ollama');
    expect(report.ok).toBe(false);
  });

  it('skips the load when the selected model is unusable', async () => {
    const report = await runDiagnostics({
      runtime: runtime('gemma4:fake'),
      client: new OllamaClient({ endpoint: mock.url }),
      version: 'test',
      cwd: process.cwd(),
      loadModel: true,
    });
    expect(byId(report, 'models.load').status).toBe('skip');
    expect(mock.chatRequests()).toHaveLength(0);
  });

  it('skips the load when Ollama is not reachable', async () => {
    await mock.close();
    const report = await runDiagnostics({
      runtime: runtime(),
      client: new OllamaClient({ endpoint: mock.url, metadataTimeoutMs: 500 }),
      version: 'test',
      cwd: process.cwd(),
      loadModel: true,
    });
    expect(byId(report, 'models.load').status).toBe('skip');
    mock = await startMockOllama(); // afterEach closes it again
  });
});

describe('compareVersions', () => {
  it('compares dotted versions numerically', () => {
    expect(compareVersions('0.30.11', '0.12.0')).toBeGreaterThan(0);
    expect(compareVersions('0.9.9', '0.12.0')).toBeLessThan(0);
    expect(compareVersions('0.12.0-rc1', '0.12.0')).toBe(0);
  });
});

describe('runDiagnostics hardware check', () => {
  const GIB = 1024 ** 3;
  const hardware = {
    totalMemoryBytes: 32 * GIB,
    platform: 'linux' as const,
    arch: 'x64',
    cpus: 8,
    gpus: [
      {
        vendor: 'nvidia' as const,
        name: 'RTX 4070',
        memoryBytes: 12 * GIB,
        unified: false,
      },
    ],
  };

  it('recommends a model for this machine', async () => {
    const report = await runDiagnostics({
      runtime: runtime(),
      client: new OllamaClient({ endpoint: mock.url }),
      version: 'test',
      cwd: process.cwd(),
      hardware,
    });
    const hw = byId(report, 'runtime.hardware');
    expect(hw.status).toBe('pass');
    expect(hw.message).toBe(
      '32 GiB RAM, RTX 4070 (12 GiB); recommended model: gemma4:12b (GPU).',
    );
  });

  it('warns, without failing, when the selected model exceeds GPU memory', async () => {
    const report = await runDiagnostics({
      runtime: runtime('gemma4:31b'),
      client: new OllamaClient({ endpoint: mock.url }),
      version: 'test',
      cwd: process.cwd(),
      hardware,
    });
    const hw = byId(report, 'runtime.hardware');
    expect(hw.status).toBe('warn');
    expect(hw.remediation).toMatch(
      /gemma4:31b needs ≈24 GiB.*partly on the CPU/,
    );
  });
});
