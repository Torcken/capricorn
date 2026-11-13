/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { GpuInfo, HardwareProfile } from './hardware.js';
import { describeHardware, placementFor, recommendModel } from './recommend.js';

const GIB = 1024 ** 3;

function machine(ramGiB: number, gpus: GpuInfo[] = []): HardwareProfile {
  return {
    totalMemoryBytes: ramGiB * GIB,
    platform: 'linux',
    arch: 'x64',
    cpus: 8,
    gpus,
  };
}
const nvidia = (name: string, gib: number): GpuInfo => ({
  vendor: 'nvidia',
  name,
  memoryBytes: gib * GIB,
  unified: false,
});
const apple = (gib: number): GpuInfo => ({
  vendor: 'apple',
  name: 'Apple Silicon GPU',
  memoryBytes: gib * GIB,
  unified: true,
});

describe('recommendModel', () => {
  it('recommends the default 12B when it fits in VRAM', () => {
    const r = recommendModel(machine(32, [nvidia('RTX 4070', 12)]));
    expect(r).toMatchObject({ tag: 'gemma4:12b', placement: 'gpu' });
    expect(r.hardware).toBe('32 GiB RAM, RTX 4070 (12 GiB)');
    expect(r.reason).toContain('approximate');
  });

  it('falls back to E4B on a GPU too small for 12B (spec §4.1)', () => {
    const r = recommendModel(machine(32, [nvidia('RTX 3060 Ti', 8)]));
    expect(r).toMatchObject({ tag: 'gemma4:e4b', placement: 'gpu' });
    expect(r.reason).toContain('gemma4:12b');
  });

  it('uses the largest single GPU, not the sum', () => {
    const r = recommendModel(
      machine(64, [nvidia('GTX 1070', 8), nvidia('GTX 1070', 8)]),
    );
    expect(r.tag).toBe('gemma4:e4b');
  });

  it('never auto-recommends the unevaluated 26B/31B, but lists them', () => {
    const r = recommendModel(machine(128, [nvidia('A100', 80)]));
    expect(r.tag).toBe('gemma4:12b');
    expect(r.alsoFits).toEqual(['gemma4:26b', 'gemma4:31b']);
  });

  it('counts only part of unified memory on Apple Silicon', () => {
    // 16 GiB Mac: 12 GiB usable by the GPU, enough for 12B (≈11 GiB).
    expect(recommendModel(machine(16, [apple(16)])).tag).toBe('gemma4:12b');
    // 8 GiB Mac: 6 GiB usable by the GPU, so only E2B (≈4 GiB) fits.
    const small = recommendModel(machine(8, [apple(8)]));
    expect(small).toMatchObject({ tag: 'gemma4:e2b', placement: 'gpu' });
    expect(small.reason).toContain('experimental');
  });

  it('prefers E4B on CPU-only machines and says it will be slow', () => {
    const r = recommendModel(machine(32));
    expect(r).toMatchObject({ tag: 'gemma4:e4b', placement: 'cpu' });
    expect(r.reason).toMatch(/slow/);
    expect(r.reason).toContain('gemma4:12b also fits in RAM');
    expect(r.hardware).toBe('32 GiB RAM, no supported GPU found');
  });

  it('falls back to E2B on a common 8 GB CPU-only laptop', () => {
    expect(recommendModel(machine(8)).tag).toBe('gemma4:e2b');
  });

  it('recommends nothing when even E2B does not fit', () => {
    const r = recommendModel(machine(5));
    expect(r.tag).toBeUndefined();
    expect(r.placement).toBe('none');
    expect(r.reason).toContain('gemma4:e2b');
  });
});

describe('placementFor', () => {
  const hw = machine(32, [nvidia('RTX 4070', 12)]);
  it('places presets on GPU, CPU or nowhere', () => {
    expect(placementFor(hw, 'gemma4:12b')?.placement).toBe('gpu');
    expect(placementFor(hw, 'gemma4:26b')?.placement).toBe('cpu');
    expect(placementFor(machine(16), 'gemma4:31b')?.placement).toBe('none');
  });
  it('has no opinion on custom tags', () => {
    expect(placementFor(hw, 'gemma4:12b-it-q8_0')).toBeUndefined();
  });
});

describe('describeHardware', () => {
  it('labels unified memory', () => {
    expect(describeHardware(machine(36, [apple(36)]))).toBe(
      '36 GiB RAM, Apple Silicon GPU (unified memory)',
    );
  });
});
