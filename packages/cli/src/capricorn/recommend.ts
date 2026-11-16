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
 * Memory per preset comes, when available, from a profile measured on that
 * tag's own Ollama metadata (GEMMA4_PRESETS[].memoryProfile): the same
 * estimate `capricorn doctor` makes for installed models, evaluated at the
 * context window that would be suggested on this machine. Presets without a
 * profile fall back to a rough size at 32K, labelled approximate. A
 * recommendation is only ever a suggestion: nothing here pulls or selects a
 * model.
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
} from '@capricorn/core';
import type { HardwareProfile } from './hardware.js';
import { formatTokens, suggestContext } from './contextSize.js';

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
  /** Context window the memory figure is for (metadata-based presets). */
  numCtx?: number;
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

/** Where a preset runs on a machine, and how much memory it needs there. */
export interface PresetFit {
  placement: Placement;
  approxMemoryGiB: number;
  /** Suggested context window (only for presets with a memory profile). */
  numCtx?: number;
  /** `metadata`: from the preset's measured profile; else a rough size. */
  basis: 'metadata' | 'approximate';
}

/** Evaluates one preset on this machine. Pure. */
export function fitPreset(hw: HardwareProfile, p: GemmaPreset): PresetFit {
  if (p.memoryProfile) {
    const s = suggestContext(p.memoryProfile, hw);
    return {
      placement: s.placement,
      approxMemoryGiB: Math.round((s.estimateBytes / GIB) * 10) / 10,
      numCtx: s.numCtx,
      basis: 'metadata',
    };
  }
  const placement: Placement =
    p.approxMemoryGiB <= gpuBudgetGiB(hw)
      ? 'gpu'
      : p.approxMemoryGiB <= cpuBudgetGiB(hw)
        ? 'cpu'
        : 'none';
  return {
    placement,
    approxMemoryGiB: p.approxMemoryGiB,
    basis: 'approximate',
  };
}

/** "an 8K", "an 80K", "a 16K": the article for a spoken window size. */
function windowArticle(numCtx: number): string {
  return /^8/.test(formatTokens(numCtx)) ? 'an' : 'a';
}

/** "≈9.9 GiB at a 64K window, from model metadata" or "≈4 GiB, approximate". */
export function describeFit(f: PresetFit): string {
  return f.basis === 'metadata' && f.numCtx
    ? `≈${f.approxMemoryGiB} GiB at ${windowArticle(f.numCtx)} ${formatTokens(f.numCtx)} window, from model metadata`
    : `≈${f.approxMemoryGiB} GiB, approximate`;
}

/**
 * Where a given preset would run on this machine; undefined for tags that
 * are not presets (custom tags have no known size).
 */
export function placementFor(
  hw: HardwareProfile,
  tag: string,
): PresetFit | undefined {
  const p = GEMMA4_PRESETS.find((x) => x.tag === tag);
  return p ? fitPreset(hw, p) : undefined;
}

/** Recommends a Gemma 4 preset for this machine. Pure; never throws. */
export function recommendModel(hw: HardwareProfile): ModelRecommendation {
  const hardware = describeHardware(hw);
  const def = preset(DEFAULT_GEMMA4_MODEL);
  const fit = (p: GemmaPreset) => fitPreset(hw, p);
  const defIndex = GEMMA4_PRESETS.indexOf(def);

  const onGpu = PREFERRED.find((p) => fit(p).placement === 'gpu');
  if (onGpu) {
    const f = fit(onGpu);
    // Larger than the default (preset order is by size) and on the GPU too.
    const alsoFits = GEMMA4_PRESETS.filter(
      (p, i) => i > defIndex && fit(p).placement === 'gpu',
    ).map((p) => p.tag);
    const reason =
      onGpu === def
        ? `It fits in GPU memory (${describeFit(f)}).`
        : `The default ${def.tag} (${describeFit(fit(def))}) does not fit in GPU memory; ${onGpu.tag} (${describeFit(f)}) does.`;
    return {
      tag: onGpu.tag,
      approxMemoryGiB: f.approxMemoryGiB,
      numCtx: f.numCtx,
      placement: 'gpu',
      hardware,
      reason: reason + experimentalNote(onGpu),
      alsoFits,
    };
  }

  const onCpu = CPU_PREFERRED.find((p) => fit(p).placement !== 'none');
  if (onCpu) {
    const f = fit(onCpu);
    const bigger =
      fit(def).placement !== 'none'
        ? ` ${def.tag} also fits in RAM but would answer much more slowly.`
        : '';
    return {
      tag: onCpu.tag,
      approxMemoryGiB: f.approxMemoryGiB,
      numCtx: f.numCtx,
      placement: 'cpu',
      hardware,
      reason:
        `No GPU with enough memory was found, so the model runs on the CPU: expect slow answers. ${onCpu.tag} (${describeFit(f)}) is the fastest usable choice.` +
        bigger +
        experimentalNote(onCpu),
      alsoFits: [],
    };
  }

  const smallest = PREFERRED[PREFERRED.length - 1];
  return {
    placement: 'none',
    hardware,
    reason: `Not enough memory: even ${smallest.tag} needs ${describeFit(fit(smallest))} plus ${RAM_RESERVE_GIB} GiB for the system.`,
    alsoFits: [],
  };
}

function experimentalNote(p: GemmaPreset): string {
  return p.tier === 'experimental'
    ? ` ${p.tag} is experimental: expect less reliable tool use.`
    : '';
}
