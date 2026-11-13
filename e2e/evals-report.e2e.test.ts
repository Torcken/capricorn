/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

/** Unit tests for the eval report aggregation (evals/capricorn/report.ts). */

import { describe, expect, it } from 'vitest';
import {
  renderMarkdown,
  summarize,
  type ReportMeta,
} from '../evals/capricorn/report.js';
import {
  isInfrastructureError,
  type TaskRunResult,
} from '../evals/capricorn/runner.js';

function run(
  taskId: string,
  category: TaskRunResult['category'],
  pass: boolean,
  durationMs: number,
  failures: string[] = [],
  model = 'gemma4:12b',
): TaskRunResult {
  return {
    taskId,
    category,
    model,
    attempt: 1,
    pass,
    failures,
    outcome: {
      exitCode: 0,
      timedOut: false,
      durationMs,
      answer: '',
      finalAnswer: '',
      toolCalls: [
        { name: 'read_file', parameters: {}, status: 'success' },
        { name: 'replace', parameters: {}, status: pass ? 'success' : 'error' },
      ],
      stderrTail: '',
    },
  };
}

const meta: ReportMeta = {
  startedAt: '2026-11-11T00:00:00Z',
  finishedAt: '2026-11-11T00:10:00Z',
  capricornVersion: '0.1.0-alpha.0',
  gitCommit: 'abc1234',
  repeat: 3,
  host: { platform: 'linux', arch: 'x64', cpus: 8, totalMemGiB: 32 },
  ollamaVersion: '0.30.11',
  models: { 'gemma4:12b': { parameterSize: '11.9B', quantization: 'Q4_K_M' } },
};

describe('eval report', () => {
  const results = [
    run('a', 'edit', true, 10_000),
    run('a', 'edit', false, 20_000, ['tests fail:\nlong output']),
    run('a', 'edit', false, 30_000, ['tests fail:\nother output']),
    run('b', 'safety', true, 5_000),
  ];

  it('aggregates pass rates, medians, tool calls and failure reasons', () => {
    const [s] = summarize(results);
    expect(s.passes).toBe(2);
    expect(s.runs).toBe(4);
    expect(s.byCategory).toEqual({
      edit: { passes: 1, runs: 3 },
      safety: { passes: 1, runs: 1 },
    });
    const a = s.tasks.find((t) => t.taskId === 'a')!;
    expect(a.medianSeconds).toBe(20);
    expect(a.meanToolCalls).toBe(2);
    expect(a.toolErrors).toBe(2);
    // Reasons are grouped by their first line.
    expect(a.failures).toEqual([{ reason: 'tests fail:', count: 2 }]);
  });

  it('keeps models separate', () => {
    const s = summarize([
      ...results,
      run('a', 'edit', true, 1, [], 'gemma4:e4b'),
    ]);
    expect(s.map((m) => m.model)).toEqual(['gemma4:12b', 'gemma4:e4b']);
    expect(s[1].runs).toBe(1);
  });

  it('excludes errored runs from pass rates and reports them separately', () => {
    const errored = {
      ...run('a', 'edit', false, 21_000, ['x']),
      errored: true,
    };
    const [s] = summarize([...results, errored, errored]);
    expect(s.runs).toBe(4);
    expect(s.errored).toBe(2);
    const a = s.tasks.find((t) => t.taskId === 'a')!;
    expect(a.runs).toBe(3);
    expect(a.errored).toBe(2);
    // Only one model-attributable failure reason group (the errored 'x' is out).
    expect(a.failures.map((f) => f.reason)).toEqual(['tests fail:']);
    const allErrored = summarize([errored]);
    expect(renderMarkdown(meta, allErrored)).toContain('| a | edit | – |');
    expect(renderMarkdown(meta, allErrored)).toContain(
      'excluded from pass rates',
    );
  });

  it('renders a Markdown summary with the facts needed to reproduce it', () => {
    const md = renderMarkdown(meta, summarize(results));
    expect(md).toContain('gemma4:12b (11.9B, Q4_K_M) | 50% (2/4)');
    expect(md).toContain('| a | edit | 1/3 | 20 | 2 | 2 | 0 |');
    expect(md).toContain('`a` (×2): tests fail:');
    expect(md).toContain('Ollama 0.30.11');
    expect(md).toContain('abc1234');
  });
});

describe('isInfrastructureError', () => {
  const base = {
    exitCode: 1,
    timedOut: false,
    durationMs: 1,
    answer: '',
    finalAnswer: '',
    toolCalls: [],
    stderrTail: '',
  };

  it('flags a daemon failure that produced nothing (as seen with gemma4:latest)', () => {
    expect(
      isInfrastructureError({
        ...base,
        error:
          'Ollama returned HTTP 500: llama-server process has terminated: failed to initialize the context',
      }),
    ).toBe(true);
    expect(
      isInfrastructureError({
        ...base,
        error:
          'Capricorn: Cannot connect to Ollama at http://127.0.0.1:11434 (ECONNREFUSED).',
      }),
    ).toBe(true);
  });

  it('does not excuse runs where the model did something', () => {
    const err = 'Ollama returned HTTP 500: boom';
    expect(
      isInfrastructureError({ ...base, error: err, answer: 'partial' }),
    ).toBe(false);
    expect(
      isInfrastructureError({
        ...base,
        error: err,
        toolCalls: [{ name: 'read_file', parameters: {} }],
      }),
    ).toBe(false);
    expect(isInfrastructureError({ ...base, exitCode: 0, error: err })).toBe(
      false,
    );
    expect(isInfrastructureError({ ...base, error: 'model said no' })).toBe(
      false,
    );
  });
});
