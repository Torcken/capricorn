/**
 * @license
 * Copyright 2026 Capricorn Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Resolves the effective Ollama runtime configuration from
 * loaded settings, for the CLI subcommands (`doctor`, `models`, `status`).
 *
 * This must apply *exactly* the same precedence and trust rules as
 * `loadCliConfig` (config.ts) so a diagnostic never reports a different
 * endpoint or model than the agent would actually use:
 *   endpoint: CAPRICORN_OLLAMA_HOST > OLLAMA_HOST > settings `ollama.endpoint`
 *   model:    --model > CAPRICORN_MODEL > settings `model.name` > gemma4:12b
 *   remote-host opt-in: *user* settings only.
 */

import {
  DEFAULT_GEMMA4_MODEL,
  OllamaClient,
  resolveOllamaSettings,
  type OllamaSettings,
} from '@google/gemini-cli-core';
import type { LoadedSettings } from '../config/settings.js';

/** Effective runtime values plus where each came from (for diagnostics). */
export interface CapricornRuntime {
  settings: OllamaSettings;
  endpointSource:
    | 'CAPRICORN_OLLAMA_HOST'
    | 'OLLAMA_HOST'
    | 'settings'
    | 'default';
  modelSource: '--model' | 'CAPRICORN_MODEL' | 'settings' | 'default';
}

/**
 * Computes the effective runtime configuration.
 *
 * @param loaded Loaded settings (all scopes).
 * @param modelFlag Value of `--model`, if given.
 */
export function resolveRuntime(
  loaded: LoadedSettings,
  modelFlag?: string,
): CapricornRuntime {
  const merged = loaded.merged;
  const envHost = process.env['CAPRICORN_OLLAMA_HOST'];
  const ollamaHost = process.env['OLLAMA_HOST'];
  const endpointSource: CapricornRuntime['endpointSource'] = envHost
    ? 'CAPRICORN_OLLAMA_HOST'
    : ollamaHost
      ? 'OLLAMA_HOST'
      : merged.ollama?.endpoint &&
          merged.ollama.endpoint !== 'http://127.0.0.1:11434'
        ? 'settings'
        : 'default';

  const envModel = process.env['CAPRICORN_MODEL'];
  const configured = merged.model?.name;
  const isUpstreamAlias = (m?: string) =>
    !m || m === 'auto' || /^(gemini-|auto-)/i.test(m);
  let model = DEFAULT_GEMMA4_MODEL;
  let modelSource: CapricornRuntime['modelSource'] = 'default';
  if (modelFlag) {
    model = modelFlag;
    modelSource = '--model';
  } else if (envModel) {
    model = envModel;
    modelSource = 'CAPRICORN_MODEL';
  } else if (!isUpstreamAlias(configured)) {
    model = configured!;
    modelSource = 'settings';
  }

  return {
    settings: resolveOllamaSettings({
      endpoint: envHost || ollamaHost || merged.ollama?.endpoint,
      allowRemoteHost: loaded.user.settings.ollama?.allowRemoteHost === true,
      model,
      numCtx: merged.ollama?.numCtx,
      think: merged.ollama?.think,
      keepAlive: merged.ollama?.keepAlive,
      requestTimeoutMs: merged.ollama?.requestTimeoutMs,
    }),
    endpointSource,
    modelSource,
  };
}

/**
 * Creates a client for the effective endpoint.
 * @throws {OllamaError} `ENDPOINT_NOT_ALLOWED` if the endpoint violates policy.
 */
export function createRuntimeClient(runtime: CapricornRuntime): OllamaClient {
  return new OllamaClient({
    endpoint: runtime.settings.endpoint,
    allowRemoteHost: runtime.settings.allowRemoteHost,
    chatTimeoutMs: runtime.settings.requestTimeoutMs,
  });
}

/** Formats a byte count as GiB with one decimal ("7.5 GiB"). */
export function formatGiB(bytes: number | undefined): string {
  if (bytes === undefined) return 'unknown';
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}
