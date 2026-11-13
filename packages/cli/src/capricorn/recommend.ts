/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Hardware-aware Gemma 4 model recommendation (spec §4.1:
 * "start with gemma4:12b as a candidate default; if missing or unsuitable
 * for detected resources, offer … the smaller E4B").
 *
 * The memory figures are the presets' approximate resident sizes at a 32K
 * context; real usage depends on quantization, context and Ollama version,
 * so every message calls them approximate. A recommendation is only ever a
 * suggestion: nothing here pulls or selects a model.
 *
 * Rules, in order:
 * 1. The first of gemma4:12b → e4b → e2b that fits in GPU memory (largest
 *    single dedicated GPU, or ~75% of RAM for Apple's unified memory).
 * 2. Otherwise CPU inference: e4b, then e2b, if it fits in RAM minus a
 *    reserve for the OS and Capricorn. 12B on a CPU is usually too slow for
 *    agent work, so it is mentioned but not recommended.
 * 3. Otherwise no recommendation.
 * Larger presets (26B, 31B) are never recommended automatically: they have
 * not been evaluated with Capricorn yet. They are listed when they fit.
 */

import {
  DEFAULT_GEMMA4_MODEL,
  GEMMA4_PRESETS,
  type GemmaPreset,
} from '@google/gemini-cli-core';
import type { HardwareProfile } from './hardware.js';

const GIB = 1024 ** 3;

/**
 * RAM kept free for the OS, Ollama itself and Capricorn. Small on purpose:
 * the preset sizes are already generous (12B measured ≈9.2 GiB at 32K on
 * CUDA vs. its 11 GiB estimate), and a larger reserve left common 8 GB
 * laptops with no recommendation at all.
 */
export const RAM_RESERVE_GIB = 2;

/**
 * Share of unified memory a model may use on Apple Silicon (Metal's working
 * set limit is roughly two thirds to three quarters of RAM).
 */
export const UNIFIED_GPU_SHARE = 0.75;

/** Where a model would run. */
export type Placement = 'gpu' | 'cpu' | 'none';

/** The suggestion shown during onboarding and by `capricorn doctor`. */
export interface ModelRecommendation {
  /** Recommended preset tag; undefined when nothing fits. */
  tag?: string;
  approxMemoryGiB?: number;
  placement: Placement;
  /** One line describing the machine, e.g. "32 GiB RAM, NVIDIA RTX 4070 (12 GiB)". */
  hardware: string;
  /** Why this model, in one or two sentences. */
  reason: string;
  /** Larger presets that also fit on the GPU (not evaluated with Capricorn). */
  alsoFits: string[];
}

function preset(tag: string): GemmaPreset {
  const p = GEMMA4_PRESETS.find((x) => x.tag === tag);
  if (!p) throw new Error(`Unknown Gemma 4 preset ${tag}`);
  return p;
}

/** Preferred models, most capable first (only evaluated or smaller ones). */
const PREFERRED = [DEFAULT_GEMMA4_MODEL, 'gemma4:e4b', 'gemma4:e2b'].map(
  preset,
);
/** CPU-only order: 12B is too slow on a CPU for interactive agent work. */
const CPU_PREFERRED = ['gemma4:e4b', 'gemma4:e2b'].map(preset);

function gib(bytes: number): number {
  return bytes / GIB;
}

function round(n: number): string {
  return `${Math.round(n)} GiB`;
}

/** Memory (GiB) a model may use on the GPU; 0 without a usable GPU. */
export function gpuBudgetGiB(hw: HardwareProfile): number {
  let best = 0;
  for (const g of hw.gpus) {
    const budget = g.unified
      ? Math.min(
          gib(g.memoryBytes) * UNIFIED_GPU_SHARE,
          gib(g.memoryBytes) - RAM_RESERVE_GIB,
        )
      : gib(g.memoryBytes);
    best = Math.max(best, budget);
  }
  return best;
}

/** Memory (GiB) a model may use when it runs on the CPU. */
export function cpuBudgetGiB(hw: HardwareProfile): number {
  return Math.max(0, gib(hw.totalMemoryBytes) - RAM_RESERVE_GIB);
}

/** One-line machine summary. */
export function describeHardware(hw: HardwareProfile): string {
  const parts = [`${round(gib(hw.totalMemoryBytes))} RAM`];
  for (const g of hw.gpus) {
    parts.push(
      g.unified
        ? `${g.name} (unified memory)`
        : `${g.name} (${round(gib(g.memoryBytes))})`,
    );
  }
  if (hw.gpus.length === 0) parts.push('no supported GPU found');
  return parts.join(', ');
}

/**
 * Where a given preset would run on this machine; undefined for tags that
 * are not presets (custom tags have no known size).
 */
export function placementFor(
  hw: HardwareProfile,
  tag: string,
): { placement: Placement; approxMemoryGiB: number } | undefined {
  const p = GEMMA4_PRESETS.find((x) => x.tag === tag);
  if (!p) return undefined;
  const placement: Placement =
    p.approxMemoryGiB <= gpuBudgetGiB(hw)
      ? 'gpu'
      : p.approxMemoryGiB <= cpuBudgetGiB(hw)
        ? 'cpu'
        : 'none';
  return { placement, approxMemoryGiB: p.approxMemoryGiB };
}

/** Recommends a Gemma 4 preset for this machine. Pure; never throws. */
export function recommendModel(hw: HardwareProfile): ModelRecommendation {
  const hardware = describeHardware(hw);
  const gpu = gpuBudgetGiB(hw);
  const cpu = cpuBudgetGiB(hw);
  const def = preset(DEFAULT_GEMMA4_MODEL);
  const approx = (p: GemmaPreset) => `≈${p.approxMemoryGiB} GiB, approximate`;

  const onGpu = PREFERRED.find((p) => p.approxMemoryGiB <= gpu);
  if (onGpu) {
    const alsoFits = GEMMA4_PRESETS.filter(
      (p) =>
        p.approxMemoryGiB > def.approxMemoryGiB && p.approxMemoryGiB <= gpu,
    ).map((p) => p.tag);
    const reason =
      onGpu === def
        ? `It fits in GPU memory (${approx(onGpu)}).`
        : `The default ${def.tag} (${approx(def)}) does not fit in GPU memory; ${onGpu.tag} (${approx(onGpu)}) does.`;
    return {
      tag: onGpu.tag,
      approxMemoryGiB: onGpu.approxMemoryGiB,
      placement: 'gpu',
      hardware,
      reason: reason + experimentalNote(onGpu),
      alsoFits,
    };
  }

  const onCpu = CPU_PREFERRED.find((p) => p.approxMemoryGiB <= cpu);
  if (onCpu) {
    const bigger =
      def.approxMemoryGiB <= cpu
        ? ` ${def.tag} also fits in RAM but would answer much more slowly.`
        : '';
    return {
      tag: onCpu.tag,
      approxMemoryGiB: onCpu.approxMemoryGiB,
      placement: 'cpu',
      hardware,
      reason:
        `No GPU with enough memory was found, so the model runs on the CPU: expect slow answers. ${onCpu.tag} (${approx(onCpu)}) is the fastest usable choice.` +
        bigger +
        experimentalNote(onCpu),
      alsoFits: [],
    };
  }

  const smallest = PREFERRED[PREFERRED.length - 1];
  return {
    placement: 'none',
    hardware,
    reason: `Not enough memory: even ${smallest.tag} needs ${approx(smallest)} plus ${RAM_RESERVE_GIB} GiB for the system.`,
    alsoFits: [],
  };
}

function experimentalNote(p: GemmaPreset): string {
  return p.tier === 'experimental'
    ? ` ${p.tag} is experimental: expect less reliable tool use.`
    : '';
}
