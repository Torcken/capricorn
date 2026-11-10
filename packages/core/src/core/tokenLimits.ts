/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  DEFAULT_GEMINI_FLASH_LITE_MODEL,
  DEFAULT_GEMINI_FLASH_MODEL,
  DEFAULT_GEMINI_MODEL,
  PREVIEW_GEMINI_FLASH_MODEL,
  PREVIEW_GEMINI_MODEL,
  GEMMA_4_31B_IT_MODEL,
  GEMMA_4_26B_A4B_IT_MODEL,
} from '../config/models.js';

type Model = string;
type TokenCount = number;

export const DEFAULT_TOKEN_LIMIT = 1_048_576;
export const GEMMA_4_TOKEN_LIMIT = 256_000;

/**
 * Capricorn: the context window allocated on the local Ollama daemon
 * (`num_ctx`), or undefined when no Ollama session is active (unit tests).
 *
 * Module-level state is acceptable here because a Capricorn process serves
 * exactly one model with one configured window at a time; upstream callers
 * pass Gemini model names to `tokenLimit` that are all served by that model.
 */
let activeContextWindow: TokenCount | undefined;

/**
 * Sets (or clears, with `undefined`) the window returned by
 * {@link tokenLimit} for every model. Called when the Ollama content
 * generator is created.
 */
export function setActiveContextWindow(tokens: TokenCount | undefined): void {
  activeContextWindow =
    tokens !== undefined && tokens > 0 ? Math.floor(tokens) : undefined;
}

export function tokenLimit(model: Model): TokenCount {
  // Capricorn: the real allocated window always wins over the theoretical
  // model maximum — compressing late against a 1M budget would overflow a
  // 32K local context and Ollama would silently drop the oldest tokens.
  if (activeContextWindow !== undefined) {
    return activeContextWindow;
  }
  // Add other models as they become relevant or if specified by config
  // Pulled from https://ai.google.dev/gemini-api/docs/models
  switch (model) {
    case GEMMA_4_31B_IT_MODEL:
    case GEMMA_4_26B_A4B_IT_MODEL:
      return GEMMA_4_TOKEN_LIMIT;
    case PREVIEW_GEMINI_MODEL:
    case PREVIEW_GEMINI_FLASH_MODEL:
    case DEFAULT_GEMINI_MODEL:
    case DEFAULT_GEMINI_FLASH_MODEL:
    case DEFAULT_GEMINI_FLASH_LITE_MODEL:
      return 1_048_576;
    default:
      return DEFAULT_TOKEN_LIMIT;
  }
}
