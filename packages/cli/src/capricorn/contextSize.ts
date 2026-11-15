/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Context-window (`ollama.numCtx`) suggestion for this machine.
 *
 * Memory model, from the installed model's own metadata:
 *
 *   memory ≈ weights + fixed + KV_OVERHEAD × kvBytesPerToken × numCtx
 *
 * - weights: the model file size (`/api/tags`).
 * - kvBytesPerToken: only *global* attention layers cache every token. Gemma
 *   4 interleaves sliding-window layers (which cache a fixed window) with
 *   a few global ones, so the per-token cost is small: for gemma4:12b, 8
 *   global layers × 1 KV head × (512 + 512) dims × 2 bytes = 16 KiB/token.
 * - fixed: the sliding-window caches plus compute buffers.
 *
 * Calibrated on gemma4:12b (Q4_K_M, Ollama 0.30.11, CUDA): measured GPU
 * memory 8.70 / 9.19 / 9.75 / 10.88 GiB at 4K / 32K / 64K / 128K; this model
 * predicts 8.85 / 9.36 / 9.93 / 11.08 GiB, about 0.17 GiB high on purpose
 * (the compute buffer is rounded up to 1 GiB) so other sizes stay safe.
 *
 * Why not suggest the largest window that fits: a full re-read of the
 * prompt (after a resume, or when Ollama's prompt cache is lost) grows with
 * the window. Measured on a TITAN V: 73K prompt tokens took 112 s to read,
 * and generation slowed from 52 to 36 tokens/s. So suggestions stop at
 * {@link MAX_SUGGESTED_GPU} on a GPU and {@link MAX_SUGGESTED_CPU} on a CPU,
 * where reading is far slower. Larger values remain a manual choice.
 */

import type { OllamaClient } from '@capricorn/core';
import type { HardwareProfile } from './hardware.js';
import { cpuBudgetGiB, gpuBudgetGiB } from './recommend.js';

const GIB = 1024 ** 3;

/** Candidate windows, smallest first. 8K is Capricorn's minimum. */
export const CONTEXT_CANDIDATES = [8_192, 16_384, 32_768, 65_536] as const;
/** Largest window suggested when the model runs on the GPU. */
export const MAX_SUGGESTED_GPU = 65_536;
/** Largest window suggested when the model runs on the CPU. */
export const MAX_SUGGESTED_CPU = 32_768;
/** KV cache plus the buffers that grow with it (measured 1.15 on 12B). */
export const KV_OVERHEAD = 1.15;
/** Compute buffers: at least 1 GiB, or 10% of the weights for big models. */
const MIN_COMPUTE_BUFFER_BYTES = GIB;
const COMPUTE_BUFFER_SHARE = 0.1;
/** GPU memory left free for the desktop and other processes. */
export const GPU_HEADROOM_GIB = 0.5;
/** KV cache element size: Ollama's default cache type is f16. */
const KV_ELEMENT_BYTES = 2;

/** What a model needs, derived from Ollama metadata. */
export interface ModelMemoryProfile {
  weightsBytes: number;
  /** Bytes cached per context token (global attention layers). */
  kvBytesPerToken: number;
  /** Bytes independent of the window (sliding caches, compute buffers). */
  fixedBytes: number;
}

/** A window suggestion for one model on this machine. */
export interface ContextSuggestion {
  numCtx: number;
  /** Where the model runs at that window. */
  placement: 'gpu' | 'cpu' | 'none';
  /** Estimated resident memory at `numCtx`. */
  estimateBytes: number;
  /** The memory budget it was checked against. */
  budgetBytes: number;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
}

/** Per-layer value: arrays as given, a scalar repeated for every layer. */
function perLayer(v: unknown, layers: number): number[] | undefined {
  if (Array.isArray(v)) {
    const out = v.map(num);
    return out.length === layers && out.every((x) => x !== undefined)
      ? out
      : undefined;
  }
  const n = num(v);
  return n === undefined ? undefined : Array<number>(layers).fill(n);
}

/**
 * Builds the memory profile from `/api/show` *verbose* metadata (the
 * per-layer arrays are omitted otherwise) and the model file size. Returns
 * undefined when the metadata lacks what the estimate needs; callers then
 * make no suggestion rather than guess.
 *
 * @param fileBytes Model size from `/api/tags`.
 * @param modelInfo `model_info` of a verbose `/api/show` response.
 */
export function memoryProfile(
  fileBytes: number | undefined,
  modelInfo: Record<string, unknown> | undefined,
): ModelMemoryProfile | undefined {
  if (!fileBytes || !modelInfo) return undefined;
  const arch = modelInfo['general.architecture'];
  if (typeof arch !== 'string') return undefined;
  const key = (k: string) => modelInfo[`${arch}.${k}`];
  const layers = num(key('block_count'));
  if (!layers) return undefined;
  const kvHeads = perLayer(key('attention.head_count_kv'), layers);
  const kLen = num(key('attention.key_length'));
  const vLen = num(key('attention.value_length'));
  if (!kvHeads || kLen === undefined || vLen === undefined) return undefined;

  // true = sliding-window layer. Without a pattern every layer is treated
  // as global, which overestimates (safe).
  const pattern = key('attention.sliding_window_pattern');
  const sliding: boolean[] = Array.isArray(pattern)
    ? pattern.map((p) => p === true)
    : Array<boolean>(layers).fill(false);
  const window = num(key('attention.sliding_window')) ?? 0;
  const kSwa = num(key('attention.key_length_swa')) ?? kLen;
  const vSwa = num(key('attention.value_length_swa')) ?? vLen;

  let kvBytesPerToken = 0;
  let slidingBytes = 0;
  for (let i = 0; i < layers; i++) {
    if (sliding[i] && window > 0) {
      slidingBytes += kvHeads[i] * (kSwa + vSwa) * KV_ELEMENT_BYTES * window;
    } else {
      kvBytesPerToken += kvHeads[i] * (kLen + vLen) * KV_ELEMENT_BYTES;
    }
  }
  if (kvBytesPerToken === 0) return undefined;
  return {
    weightsBytes: fileBytes,
    kvBytesPerToken,
    fixedBytes:
      slidingBytes +
      Math.max(MIN_COMPUTE_BUFFER_BYTES, fileBytes * COMPUTE_BUFFER_SHARE),
  };
}

/**
 * Fetches what {@link memoryProfile} needs for an installed tag: its file
 * size (`/api/tags`) and verbose metadata (`/api/show`, ~12 MB for Gemma 4).
 * Returns undefined when either is unavailable.
 */
export async function fetchMemoryProfile(
  client: OllamaClient,
  tag: string,
  signal?: AbortSignal,
): Promise<ModelMemoryProfile | undefined> {
  const [models, show] = await Promise.all([
    client.listModels(signal),
    client.showModel(tag, signal, { verbose: true }),
  ]);
  const size = models.find((m) => m.name === tag || m.model === tag)?.size;
  return memoryProfile(size, show.model_info);
}

/** Estimated resident memory for `numCtx` tokens. */
export function estimateMemoryBytes(
  profile: ModelMemoryProfile,
  numCtx: number,
): number {
  return (
    profile.weightsBytes +
    profile.fixedBytes +
    KV_OVERHEAD * profile.kvBytesPerToken * numCtx
  );
}

/** GPU budget in bytes, after headroom; 0 without a usable GPU. */
function gpuBudgetBytes(hw: HardwareProfile): number {
  const gib = gpuBudgetGiB(hw);
  // Unified memory budgets already keep RAM_RESERVE_GIB for the system.
  const unified = hw.gpus.some((g) => g.unified);
  return Math.max(0, (unified ? gib : gib - GPU_HEADROOM_GIB) * GIB);
}

/**
 * Suggests a window: the largest candidate that keeps the model on the GPU
 * (up to {@link MAX_SUGGESTED_GPU}), else the largest that fits in RAM for
 * CPU inference (up to {@link MAX_SUGGESTED_CPU}), never above the model's
 * maximum. Pure; never throws.
 *
 * @param maxContextLength The model's `context_length`, if known.
 */
export function suggestContext(
  profile: ModelMemoryProfile,
  hw: HardwareProfile,
  maxContextLength?: number,
): ContextSuggestion {
  const cap = (limit: number) =>
    CONTEXT_CANDIDATES.filter(
      (c) => c <= limit && (!maxContextLength || c <= maxContextLength),
    );
  const pick = (candidates: number[], budget: number) =>
    [...candidates]
      .reverse()
      .find((c) => estimateMemoryBytes(profile, c) <= budget);

  const gpu = gpuBudgetBytes(hw);
  const onGpu = pick(cap(MAX_SUGGESTED_GPU), gpu);
  if (onGpu !== undefined) {
    return {
      numCtx: onGpu,
      placement: 'gpu',
      estimateBytes: estimateMemoryBytes(profile, onGpu),
      budgetBytes: gpu,
    };
  }
  const cpu = cpuBudgetGiB(hw) * GIB;
  const onCpu = pick(cap(MAX_SUGGESTED_CPU), cpu);
  const numCtx = onCpu ?? CONTEXT_CANDIDATES[0];
  return {
    numCtx,
    placement: onCpu !== undefined ? 'cpu' : 'none',
    estimateBytes: estimateMemoryBytes(profile, numCtx),
    budgetBytes: cpu,
  };
}

/** "64K" for 65,536 tokens. */
export function formatTokens(n: number): string {
  return n % 1024 === 0 ? `${n / 1024}K` : n.toLocaleString('en-US');
}
