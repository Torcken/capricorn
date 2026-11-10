/**
 * @license
 * Copyright 2026 Capricorn Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Discovery of installed models and selection of the session
 * model. Shared by `capricorn models list`, `capricorn doctor`, interactive
 * startup and the in-session `/model` command so they can never disagree
 * about which models are usable.
 */

import type { OllamaClient } from './client.js';
import {
  DEFAULT_GEMMA4_MODEL,
  GEMMA4_PRESETS,
  prefilterTagModel,
  verifyGemma4Model,
  type ModelVerdict,
} from './modelPolicy.js';
import type { OllamaTagModel } from './wireTypes.js';

/** An installed model together with its verification verdict. */
export interface DiscoveredModel extends ModelVerdict {
  /** On-disk size in bytes (download size, *not* loaded memory). */
  sizeBytes?: number;
  digest?: string;
  modifiedAt?: string;
}

/**
 * Lists every installed model with a verdict. Non-Gemma and cloud models are
 * included (marked not allowed) so diagnostics can explain *why* a model the
 * user sees in `ollama list` is not offered.
 *
 * Gemma candidates are verified with `/api/show` concurrently; a failure to
 * fetch metadata for one model yields an `unverifiable` verdict for that model
 * rather than failing the whole listing.
 */
export async function discoverModels(
  client: OllamaClient,
  signal?: AbortSignal,
): Promise<DiscoveredModel[]> {
  const tags = await client.listModels(signal);
  return Promise.all(
    tags.map(async (tag): Promise<DiscoveredModel> => {
      const meta = tagMeta(tag);
      const pre = prefilterTagModel(tag);
      if (pre) return { ...pre, ...meta };
      try {
        const show = await client.showModel(tag.name, signal);
        return { ...verifyGemma4Model(tag.name, show, tag), ...meta };
      } catch (e) {
        return {
          model: tag.name,
          allowed: false,
          reason: 'unverifiable',
          detail: `Could not read model metadata: ${e instanceof Error ? e.message : String(e)}`,
          ...meta,
        };
      }
    }),
  );
}

/** Outcome of choosing the model for a session. */
export type ModelSelection =
  | { kind: 'selected'; model: DiscoveredModel }
  | {
      /** The configured/requested model is unusable; alternatives offered. */
      kind: 'unavailable';
      requested: string;
      reason: string;
      alternatives: DiscoveredModel[];
    };

/**
 * Chooses the session model. Never substitutes silently: if `requested` is
 * not installed or not allowed, the caller receives `unavailable` together
 * with the usable alternatives and must ask the user or fail with guidance
 * (spec §4.1 "Do not silently change models").
 *
 * @param requested The configured or `--model` tag; defaults to the
 *   candidate default `gemma4:12b`.
 */
export function selectModel(
  discovered: DiscoveredModel[],
  requested: string | undefined,
): ModelSelection {
  const target = normalizeTag(requested || DEFAULT_GEMMA4_MODEL);
  const allowed = discovered.filter((m) => m.allowed);
  const match = discovered.find((m) => normalizeTag(m.model) === target);
  if (match?.allowed) {
    return { kind: 'selected', model: match };
  }
  return {
    kind: 'unavailable',
    requested: target,
    reason: match
      ? match.detail
      : `Model "${target}" is not installed in Ollama.`,
    alternatives: sortByPreference(allowed),
  };
}

/**
 * Ollama treats `name` and `name:latest` as the same model; normalize so
 * `gemma4` matches an installed `gemma4:latest`.
 */
export function normalizeTag(tag: string): string {
  const t = tag.trim();
  const lastSegment = t.slice(t.lastIndexOf('/') + 1);
  return lastSegment.includes(':') ? t : `${t}:latest`;
}

/** Orders models by preset order, then by name, for stable display. */
function sortByPreference(models: DiscoveredModel[]): DiscoveredModel[] {
  const rank = (m: DiscoveredModel) => {
    const i = GEMMA4_PRESETS.findIndex((p) => p.tag === m.model);
    return i === -1 ? GEMMA4_PRESETS.length : i;
  };
  return [...models].sort(
    (a, b) => rank(a) - rank(b) || a.model.localeCompare(b.model),
  );
}

function tagMeta(tag: OllamaTagModel) {
  return {
    sizeBytes: tag.size,
    digest: tag.digest,
    modifiedAt: tag.modified_at,
    parameterSize: tag.details?.parameter_size,
    quantization: tag.details?.quantization_level,
  };
}
