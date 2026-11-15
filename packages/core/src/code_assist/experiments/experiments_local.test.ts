/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Capricorn: experiments are no longer fetched from the Code Assist server;
// these tests cover the only remaining source, a local GEMINI_EXP file.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: vi.fn(),
    },
  };
});

describe('experiments with GEMINI_EXP', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env['GEMINI_EXP'];
  });

  afterEach(() => {
    delete process.env['GEMINI_EXP'];
  });

  it('reads experiments from the file named by GEMINI_EXP', async () => {
    process.env['GEMINI_EXP'] = '/tmp/experiments.json';
    vi.mocked(fs.promises.readFile).mockResolvedValue(
      JSON.stringify({
        flags: [{ flagId: 111, boolValue: true }],
        experimentIds: [999],
      }),
    );

    const { getExperiments } = await import('./experiments.js');
    const experiments = await getExperiments();

    expect(fs.promises.readFile).toHaveBeenCalledWith(
      '/tmp/experiments.json',
      'utf8',
    );
    expect(experiments.flags[111]).toEqual({ flagId: 111, boolValue: true });
    expect(experiments.experimentIds).toEqual([999]);
  });

  it('returns no flags when GEMINI_EXP is not set', async () => {
    const { getExperiments } = await import('./experiments.js');
    const experiments = await getExperiments();
    expect(experiments).toEqual({ flags: {}, experimentIds: [] });
  });

  it('returns no flags when the file cannot be read', async () => {
    process.env['GEMINI_EXP'] = '/tmp/missing.json';
    vi.mocked(fs.promises.readFile).mockRejectedValue(new Error('missing'));

    const { getExperiments } = await import('./experiments.js');
    expect(await getExperiments()).toEqual({ flags: {}, experimentIds: [] });
  });

  it('returns no flags when the file has an invalid structure', async () => {
    process.env['GEMINI_EXP'] = '/tmp/invalid.json';
    vi.mocked(fs.promises.readFile).mockResolvedValue(
      JSON.stringify({ flags: 'not-an-array', experimentIds: 123 }),
    );

    const { getExperiments } = await import('./experiments.js');
    expect(await getExperiments()).toEqual({ flags: {}, experimentIds: [] });
  });
});
