/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Content } from '@google/genai';
import type { Config } from '../config/config.js';

/**
 * Capricorn: inert stand-in for the upstream LiteRT-LM client.
 *
 * Upstream used the `@google/genai` SDK client to send prompts to a local
 * LiteRT-LM server running a small non-Gemma-4 model (for the experimental
 * Gemma model router). Capricorn only runs verified Gemma 4 models through
 * Ollama, forces that router off (see `Config`), and does not bundle the SDK
 * client, so this class keeps the upstream shape and refuses every call.
 */
export class LocalLiteRtLmClient {
  constructor(_config: Config) {}

  /**
   * Always rejects: the LiteRT-LM back-end is not available in Capricorn.
   * Callers (the Gemma classifier strategy) treat a rejection as "no routing
   * decision" and fall through to the next strategy.
   */
  async generateJson(
    _contents: Content[],
    _systemInstruction: string,
    _reminder?: string,
    _abortSignal?: AbortSignal,
  ): Promise<object> {
    throw new Error(
      'The LiteRT-LM model router is not available in Capricorn; inference always uses Ollama.',
    );
  }
}
