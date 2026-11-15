/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  estimateMemoryBytes,
  formatTokens,
  memoryProfile,
  suggestContext,
} from './contextSize.js';
import type { HardwareProfile } from './hardware.js';

const GIB = 1024 ** 3;

/**
 * gemma4:12b (Q4_K_M) as reported by Ollama 0.30.11 (`/api/show` verbose;
 * only the keys the estimate reads). 5 sliding-window layers, then 1 global
 * layer with a single KV head, repeated 8 times.
 */
const GEMMA4_12B_INFO: Record<string, unknown> = {
  'general.architecture': 'gemma4',
  'gemma4.block_count': 48,
  'gemma4.context_length': 262144,
  'gemma4.attention.key_length': 512,
  'gemma4.attention.value_length': 512,
  'gemma4.attention.key_length_swa': 256,
  'gemma4.attention.value_length_swa': 256,
  'gemma4.attention.sliding_window': 1024,
  'gemma4.attention.head_count_kv': Array.from({ length: 48 }, (_, i) =>
    i % 6 === 5 ? 1 : 8,
  ),
  'gemma4.attention.sliding_window_pattern': Array.from(
    { length: 48 },
    (_, i) => i % 6 !== 5,
  ),
};
const GEMMA4_12B_FILE = 8_021_618_941;

/** GPU memory measured with nvidia-smi (TITAN V, CUDA), in GiB. */
const MEASURED_12B: Array<[number, number]> = [
  [4096, 8.7],
  [32768, 9.19],
  [65536, 9.75],
  [131072, 10.88],
];

function hw(gpuGiB: number | undefined, ramGiB = 32): HardwareProfile {
  return {
    totalMemoryBytes: ramGiB * GIB,
    gpus:
      gpuGiB === undefined
        ? []
        : [
            {
              name: 'Test GPU',
              vendor: 'nvidia',
              memoryBytes: gpuGiB * GIB,
              unified: false,
            },
          ],
  } as HardwareProfile;
}

const profile = memoryProfile(GEMMA4_12B_FILE, GEMMA4_12B_INFO)!;

describe('memoryProfile', () => {
  it('counts only global layers per token (16 KiB for gemma4:12b)', () => {
    expect(profile.kvBytesPerToken).toBe(8 * 1 * (512 + 512) * 2);
    // 40 sliding layers × 8 heads × (256 + 256) × 2 bytes × 1024 tokens,
    // plus the 1 GiB minimum compute buffer.
    expect(profile.fixedBytes).toBe(40 * 8 * 512 * 2 * 1024 + GIB);
  });

  it('needs the per-layer arrays of a verbose /api/show', () => {
    const { ['gemma4.attention.head_count_kv']: _omit, ...plain } =
      GEMMA4_12B_INFO;
    expect(memoryProfile(GEMMA4_12B_FILE, plain)).toBeUndefined();
    expect(memoryProfile(undefined, GEMMA4_12B_INFO)).toBeUndefined();
    expect(memoryProfile(GEMMA4_12B_FILE, undefined)).toBeUndefined();
  });

  it('treats every layer as global without a sliding pattern (safe)', () => {
    const { ['gemma4.attention.sliding_window_pattern']: _omit, ...noPattern } =
      GEMMA4_12B_INFO;
    const p = memoryProfile(GEMMA4_12B_FILE, noPattern)!;
    expect(p.kvBytesPerToken).toBeGreaterThan(profile.kvBytesPerToken);
  });
});

describe('estimateMemoryBytes', () => {
  it.each(MEASURED_12B)(
    'is slightly above the measured footprint at %d tokens',
    (numCtx, measuredGiB) => {
      const estimate = estimateMemoryBytes(profile, numCtx) / GIB;
      expect(estimate).toBeGreaterThanOrEqual(measuredGiB);
      expect(estimate - measuredGiB).toBeLessThan(0.3);
    },
  );
});

describe('suggestContext', () => {
  it('suggests 64K on a 12 GiB GPU (measured to fit 128K)', () => {
    expect(suggestContext(profile, hw(12), 262144)).toMatchObject({
      numCtx: 65536,
      placement: 'gpu',
    });
  });

  it('never suggests more than 64K, however large the GPU', () => {
    expect(suggestContext(profile, hw(80), 262144).numCtx).toBe(65536);
  });

  it('lowers the window to keep the model on a tight GPU', () => {
    expect(suggestContext(profile, hw(9.5), 262144)).toMatchObject({
      numCtx: 8192,
      placement: 'gpu',
    });
  });

  it('falls back to CPU sizes, at most 32K, when no window fits the GPU', () => {
    expect(suggestContext(profile, hw(8, 32), 262144)).toMatchObject({
      numCtx: 32768,
      placement: 'cpu',
    });
    expect(suggestContext(profile, hw(undefined, 64), 262144).numCtx).toBe(
      32768,
    );
  });

  it('respects the model maximum', () => {
    expect(suggestContext(profile, hw(24), 16384).numCtx).toBe(16384);
  });

  it('reports when nothing fits', () => {
    expect(suggestContext(profile, hw(undefined, 8), 262144)).toMatchObject({
      numCtx: 8192,
      placement: 'none',
    });
  });
});

describe('formatTokens', () => {
  it('shows whole multiples of 1024 as K', () => {
    expect(formatTokens(65536)).toBe('64K');
    expect(formatTokens(10000)).toBe('10,000');
  });
});
