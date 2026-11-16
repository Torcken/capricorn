/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Gemma 4 model verification — the enforcement point of
 * Capricorn's "Gemma 4 only, local only" product contract.
 *
 * Why metadata instead of name matching: Ollama tags are user-assignable
 * (`ollama cp qwen3:8b gemma4:fake` is one command), so a name prefix proves
 * nothing. Conversely, a legitimately re-tagged Gemma 4 GGUF (`my-coder:latest`)
 * should be accepted. We therefore decide from the GGUF metadata Ollama reports
 * through `/api/show`:
 *
 *   1. `model_info["general.architecture"] === "gemma4"` — strongest signal,
 *      read from the weights file itself.
 *   2. Otherwise `details.family`/`details.families` contains `gemma4` — used
 *      only when `model_info` is absent (older daemons).
 *   3. Otherwise the model is *unverifiable* and rejected.
 *
 * Independently of architecture, cloud-backed models (Ollama `:cloud` tags or
 * any `remote_host`/`remote_model` metadata) are always rejected: running them
 * would send the user's code to a hosted service, which Capricorn promises
 * never to do.
 */

import type { OllamaShowResponse, OllamaTagModel } from './wireTypes.js';

/** The GGUF architecture / Ollama family identifier for Gemma 4. */
export const GEMMA4_ARCHITECTURE = 'gemma4';

/** Release classification of a preset, from the product roadmap (§5.2). */
export type GemmaPresetTier =
  | 'experimental'
  | 'lightweight'
  | 'standard'
  | 'advanced'
  | 'high-capability';

/** A documented Gemma 4 preset tag users can pull. */
export interface GemmaPreset {
  tag: string;
  label: string;
  tier: GemmaPresetTier;
  /**
   * Rough resident memory for the default Q4 quantization at a 32K context,
   * in GiB. Used only for *recommendations*; real usage is reported by
   * `/api/ps` once loaded. Marked approximate everywhere it is shown.
   */
  approxMemoryGiB: number;
  /**
   * Capricorn: memory profile computed from this tag's own Ollama metadata
   * (verbose `/api/show` + file size, via the CLI's `memoryProfile()`), so a
   * recommendation can estimate memory per context window *before* the
   * model is downloaded. Absent when no copy was available to measure; the
   * rough {@link approxMemoryGiB} is used then. `measuredDigest` is the model
   * digest the numbers were taken from (default Q4_K_M quantization).
   */
  memoryProfile?: GemmaPresetMemoryProfile;
}

/** Same shape as the CLI's ModelMemoryProfile, plus where it came from. */
export interface GemmaPresetMemoryProfile {
  weightsBytes: number;
  /** Bytes cached per context token (global attention layers). */
  kvBytesPerToken: number;
  /** Bytes independent of the window (sliding caches, compute buffers). */
  fixedBytes: number;
  measuredDigest: string;
}

/**
 * Public presets. Availability in the Ollama registry is not assumed: `models
 * pull` reports the registry's answer verbatim.
 */
export const GEMMA4_PRESETS: readonly GemmaPreset[] = [
  {
    tag: 'gemma4:e2b',
    label: 'Gemma 4 E2B',
    tier: 'experimental',
    approxMemoryGiB: 4,
  },
  {
    tag: 'gemma4:e4b',
    label: 'Gemma 4 E4B',
    tier: 'lightweight',
    approxMemoryGiB: 7,
    memoryProfile: {
      weightsBytes: 6583656505,
      kvBytesPerToken: 28672,
      fixedBytes: 1110441984,
      measuredDigest: 'dc35e8d9c606',
    },
  },
  {
    tag: 'gemma4:12b',
    label: 'Gemma 4 12B',
    tier: 'standard',
    approxMemoryGiB: 11,
    memoryProfile: {
      weightsBytes: 8021618941,
      kvBytesPerToken: 16384,
      fixedBytes: 1409286144,
      measuredDigest: '6114515d63c1',
    },
  },
  {
    tag: 'gemma4:26b',
    label: 'Gemma 4 26B A4B',
    tier: 'advanced',
    approxMemoryGiB: 20,
    memoryProfile: {
      weightsBytes: 18731025629,
      kvBytesPerToken: 20480,
      fixedBytes: 2082817763,
      measuredDigest: '001e5dafc3c7',
    },
  },
  {
    tag: 'gemma4:31b',
    label: 'Gemma 4 31B',
    tier: 'high-capability',
    approxMemoryGiB: 24,
    memoryProfile: {
      weightsBytes: 20385458234,
      kvBytesPerToken: 81920,
      fixedBytes: 2877406623,
      measuredDigest: '17ba34c06c80',
    },
  },
];

/**
 * Candidate default. Never applied silently: if it is not installed the user
 * is told and offered installed alternatives (spec §4.1).
 */
export const DEFAULT_GEMMA4_MODEL = 'gemma4:12b';

/** Why a model was accepted or rejected. */
export type ModelVerdictReason =
  | 'verified-architecture'
  | 'verified-family'
  | 'cloud-model'
  | 'wrong-architecture'
  | 'unverifiable'
  | 'no-tool-support';

/** Outcome of verifying one model. */
export interface ModelVerdict {
  /** The tag as installed, e.g. `gemma4:12b`. */
  model: string;
  allowed: boolean;
  reason: ModelVerdictReason;
  /** Human-readable explanation, safe to print. */
  detail: string;
  /** Architecture reported by metadata, if any. */
  architecture?: string;
  /** Maximum context the weights support (`<arch>.context_length`). */
  maxContextLength?: number;
  /** Capabilities reported by Ollama (`tools`, `thinking`, `vision`, ...). */
  capabilities?: string[];
  parameterSize?: string;
  quantization?: string;
}

/**
 * Cheap pre-filter on a `/api/tags` entry. Returns a rejection verdict for
 * models that can be excluded without a `/api/show` round trip (cloud models
 * and non-Gemma families), or `undefined` when full verification is needed.
 *
 * This never *accepts* a model: acceptance always requires
 * {@link verifyGemma4Model} on `/api/show` metadata.
 */
export function prefilterTagModel(
  tag: OllamaTagModel,
): ModelVerdict | undefined {
  if (isCloudModel(tag.name, tag)) {
    return {
      model: tag.name,
      allowed: false,
      reason: 'cloud-model',
      detail: 'Cloud-backed Ollama model; Capricorn only runs local inference.',
    };
  }
  const families = [tag.details?.family, ...(tag.details?.families ?? [])]
    // Capricorn: Ollama 0.40 reports `family: ""` in /api/tags for some
    // Gemma 4 builds; an empty string is "unknown", not a family, so it
    // must fall through to the /api/show architecture check.
    .filter((f): f is string => typeof f === 'string' && f.trim() !== '')
    .map((f) => f.toLowerCase());
  if (families.length > 0 && !families.includes(GEMMA4_ARCHITECTURE)) {
    return {
      model: tag.name,
      allowed: false,
      reason: 'wrong-architecture',
      detail: `Model family "${families[0]}" is not Gemma 4.`,
      architecture: families[0],
    };
  }
  return undefined;
}

/**
 * Decides whether `model` may be used by Capricorn, from its `/api/show`
 * metadata. Pure function: no I/O, fully unit-testable.
 *
 * @param model The installed tag.
 * @param show The `/api/show` response for that tag.
 * @param tag Optional `/api/tags` entry, consulted for cloud markers.
 */
export function verifyGemma4Model(
  model: string,
  show: OllamaShowResponse,
  tag?: OllamaTagModel,
): ModelVerdict {
  const base = {
    model,
    capabilities: show.capabilities,
    parameterSize: show.details?.parameter_size,
    quantization: show.details?.quantization_level,
  };

  // Cloud check first: architecture metadata for a cloud model may well say
  // "gemma4", but inference would still leave the machine.
  if (isCloudModel(model, show) || (tag && isCloudModel(model, tag))) {
    return {
      ...base,
      allowed: false,
      reason: 'cloud-model',
      detail: 'Cloud-backed Ollama model; Capricorn only runs local inference.',
    };
  }

  const info = show.model_info ?? {};
  const archValue = info['general.architecture'];
  const architecture =
    typeof archValue === 'string' ? archValue.toLowerCase() : undefined;
  const ctxValue = architecture
    ? info[`${architecture}.context_length`]
    : undefined;
  const maxContextLength =
    typeof ctxValue === 'number' && ctxValue > 0 ? ctxValue : undefined;

  let reason: ModelVerdictReason;
  if (architecture !== undefined) {
    if (architecture !== GEMMA4_ARCHITECTURE) {
      return {
        ...base,
        allowed: false,
        reason: 'wrong-architecture',
        detail: `Model architecture "${architecture}" is not Gemma 4.`,
        architecture,
        maxContextLength,
      };
    }
    reason = 'verified-architecture';
  } else {
    // Older daemons: fall back to the family fields, still metadata-derived.
    const families = [show.details?.family, ...(show.details?.families ?? [])]
      .filter((f): f is string => typeof f === 'string' && f.trim() !== '')
      .map((f) => f.toLowerCase());
    if (families.length === 0) {
      return {
        ...base,
        allowed: false,
        reason: 'unverifiable',
        detail:
          'Ollama did not report architecture metadata, so the model cannot be verified as Gemma 4.',
      };
    }
    if (!families.includes(GEMMA4_ARCHITECTURE)) {
      return {
        ...base,
        allowed: false,
        reason: 'wrong-architecture',
        detail: `Model family "${families[0]}" is not Gemma 4.`,
        architecture: families[0],
      };
    }
    reason = 'verified-family';
  }

  // The agent loop is built on function calling; a model without the `tools`
  // capability cannot complete any coding task. Old daemons omit the
  // capabilities array entirely — then we allow it and let the first request
  // surface a precise error rather than guessing.
  if (show.capabilities && !show.capabilities.includes('tools')) {
    return {
      ...base,
      allowed: false,
      reason: 'no-tool-support',
      detail: 'Ollama reports this model does not support tool calling.',
      architecture: GEMMA4_ARCHITECTURE,
      maxContextLength,
    };
  }

  return {
    ...base,
    allowed: true,
    reason,
    detail:
      reason === 'verified-architecture'
        ? 'Verified Gemma 4 (GGUF architecture metadata).'
        : 'Verified Gemma 4 (Ollama family metadata).',
    architecture: GEMMA4_ARCHITECTURE,
    maxContextLength,
  };
}

/**
 * True when the model would run on Ollama's hosted service rather than
 * locally. Ollama marks such models with a `:cloud`/`-cloud` tag suffix and/or
 * `remote_host`/`remote_model` metadata; any one marker is sufficient.
 */
export function isCloudModel(
  name: string,
  meta: { remote_host?: string; remote_model?: string },
): boolean {
  const tagPart = name.includes(':')
    ? name.slice(name.lastIndexOf(':') + 1)
    : '';
  const lowered = tagPart.toLowerCase();
  return (
    lowered === 'cloud' ||
    lowered.endsWith('-cloud') ||
    Boolean(meta.remote_host) ||
    Boolean(meta.remote_model)
  );
}
