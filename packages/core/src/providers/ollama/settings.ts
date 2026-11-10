/**
 * @license
 * Copyright 2026 Capricorn Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Resolved Ollama provider settings and their defaults.
 *
 * Settings arrive from the CLI layer already merged (CLI flags > environment
 * > project > user > defaults). The one exception to "project settings may
 * override user settings" is `allowRemoteHost`, which the CLI only reads from
 * *user*-scope settings: a cloned repository must not be able to redirect
 * inference off the machine (see `endpoint.ts`).
 */

import { DEFAULT_GEMMA4_MODEL } from './modelPolicy.js';
import { DEFAULT_OLLAMA_ENDPOINT } from './endpoint.js';
import type { OllamaThinkMode } from './ollamaContentGenerator.js';

/** Provider configuration consumed by `createOllamaContentGenerator`. */
export interface OllamaSettings {
  /** Daemon endpoint, `OLLAMA_HOST` style. */
  endpoint: string;
  /** User-scope opt-in to a non-loopback daemon. */
  allowRemoteHost: boolean;
  /** Default model tag for new sessions. */
  model: string;
  /**
   * Context window (`num_ctx`) to allocate. Conservative by default: KV-cache
   * memory grows linearly with this value, and the theoretical 128K/256K
   * maximum would exhaust memory on most machines.
   */
  numCtx: number;
  /** Thinking channel control; see {@link OllamaThinkMode}. */
  think: OllamaThinkMode;
  /** Ollama `keep_alive` duration, e.g. "10m". */
  keepAlive?: string;
  /** Milliseconds allowed until the first byte of a chat response. */
  requestTimeoutMs: number;
  /** Milliseconds of silence tolerated mid-stream. */
  streamIdleTimeoutMs: number;
}

/** Documented defaults (docs/CONFIGURATION.md). */
export const DEFAULT_OLLAMA_SETTINGS: OllamaSettings = {
  endpoint: DEFAULT_OLLAMA_ENDPOINT,
  allowRemoteHost: false,
  model: DEFAULT_GEMMA4_MODEL,
  numCtx: 32_768,
  think: 'auto',
  keepAlive: '10m',
  requestTimeoutMs: 300_000,
  streamIdleTimeoutMs: 120_000,
};

/** Lower bound for `numCtx`: below this the system prompt plus tool schemas do not fit. */
export const MIN_NUM_CTX = 8_192;

/**
 * Fills defaults and clamps numeric fields to sane ranges.
 */
export function resolveOllamaSettings(
  partial: Partial<OllamaSettings> | undefined,
): OllamaSettings {
  const p = partial ?? {};
  const d = DEFAULT_OLLAMA_SETTINGS;
  // Field-by-field so an explicit `undefined` (an unset setting) never
  // overwrites a default.
  return {
    endpoint: p.endpoint ?? d.endpoint,
    allowRemoteHost: p.allowRemoteHost ?? d.allowRemoteHost,
    model: p.model ?? d.model,
    numCtx: Math.max(MIN_NUM_CTX, Math.floor(p.numCtx ?? d.numCtx)),
    think: p.think ?? d.think,
    keepAlive: p.keepAlive ?? d.keepAlive,
    requestTimeoutMs: Math.max(1_000, p.requestTimeoutMs ?? d.requestTimeoutMs),
    streamIdleTimeoutMs: Math.max(
      1_000,
      p.streamIdleTimeoutMs ?? d.streamIdleTimeoutMs,
    ),
  };
}
