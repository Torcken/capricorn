/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Capricorn modification (2026, Guillaume S. Condamine & all awesome
// contributors): the upstream factory constructed Google GenAI / Vertex AI /
// Code Assist generators. Capricorn performs inference exclusively through a
// local Ollama daemon, so every hosted branch has been removed and
// `createContentGenerator` now builds only the Ollama generator (plus the
// upstream fake/recording generators used by tests). See
// docs/adr/0001-foundation.md.

import type {
  CountTokensResponse,
  GenerateContentResponse,
  GenerateContentParameters,
  CountTokensParameters,
  EmbedContentResponse,
  EmbedContentParameters,
} from '@google/genai';
import type { Config } from '../config/config.js';
import type { UserTierId, GeminiUserTier } from '../code_assist/types.js';
import { LoggingContentGenerator } from './loggingContentGenerator.js';
import { FakeContentGenerator } from './fakeContentGenerator.js';
import { RecordingContentGenerator } from './recordingContentGenerator.js';
import type { LlmRole } from '../telemetry/llmRole.js';
import { OllamaClient } from '../providers/ollama/client.js';
import { OllamaContentGenerator } from '../providers/ollama/ollamaContentGenerator.js';
import { setActiveContextWindow } from './tokenLimits.js';

/**
 * Interface abstracting the core functionalities for generating content and counting tokens.
 */
export interface ContentGenerator {
  generateContent(
    request: GenerateContentParameters,
    userPromptId: string,
    role: LlmRole,
  ): Promise<GenerateContentResponse>;

  generateContentStream(
    request: GenerateContentParameters,
    userPromptId: string,
    role: LlmRole,
  ): Promise<AsyncGenerator<GenerateContentResponse>>;

  countTokens(request: CountTokensParameters): Promise<CountTokensResponse>;

  embedContent(request: EmbedContentParameters): Promise<EmbedContentResponse>;

  userTier?: UserTierId;

  userTierName?: string;

  paidTier?: GeminiUserTier;
}

/**
 * Authentication/back-end selector inherited from upstream.
 *
 * Capricorn only ever uses {@link AuthType.OLLAMA}. The Google values are kept
 * solely so persisted upstream-shaped settings and retained upstream code
 * paths still type-check; `createContentGenerator` rejects all of them, so
 * they can never route a request to a hosted service.
 */
export enum AuthType {
  /** Local Ollama daemon running a verified Gemma 4 model (Capricorn). */
  OLLAMA = 'ollama-local',
  LOGIN_WITH_GOOGLE = 'oauth-personal',
  USE_GEMINI = 'gemini-api-key',
  USE_VERTEX_AI = 'vertex-ai',
  LEGACY_CLOUD_SHELL = 'cloud-shell',
  COMPUTE_ADC = 'compute-default-credentials',
  GATEWAY = 'gateway',
}

/**
 * Upstream detected Google credentials from the environment here. Capricorn
 * deliberately ignores `GEMINI_API_KEY`, `GOOGLE_*` etc. — the presence of a
 * cloud credential must never switch inference off the machine.
 */
export function getAuthTypeFromEnv(): AuthType {
  return AuthType.OLLAMA;
}

export type ContentGeneratorConfig = {
  apiKey?: string;
  vertexai?: boolean;
  authType?: AuthType;
  proxy?: string;
  baseUrl?: string;
  customHeaders?: Record<string, string>;
  vertexAiRouting?: VertexAiRoutingConfig;
};

export type VertexAiRequestType = 'dedicated' | 'shared';
export type VertexAiSharedRequestType = 'priority' | 'flex';

export interface VertexAiRoutingConfig {
  requestType?: VertexAiRequestType;
  sharedRequestType?: VertexAiSharedRequestType;
}

/**
 * Builds the generator config. Capricorn needs no credentials, so this only
 * records the (always-Ollama) back-end; API keys, base URLs and custom headers
 * passed by retained upstream callers are ignored on purpose.
 */
export async function createContentGeneratorConfig(
  config: Config,
  authType: AuthType | undefined,
  _apiKey?: string,
  _baseUrl?: string,
  _customHeaders?: Record<string, string>,
  _vertexAiRouting?: VertexAiRoutingConfig,
): Promise<ContentGeneratorConfig> {
  return {
    authType: authType ?? AuthType.OLLAMA,
    proxy: config?.getProxy(),
  };
}

/**
 * Creates the session's content generator.
 *
 * @throws {Error} For any back-end other than {@link AuthType.OLLAMA}. This is
 *   a hard failure rather than a fallback: Capricorn must never silently use
 *   hosted inference.
 * @throws {OllamaError} If the configured Ollama endpoint violates the
 *   local-only policy.
 */
export async function createContentGenerator(
  config: ContentGeneratorConfig,
  gcConfig: Config,
  _sessionId?: string,
): Promise<ContentGenerator> {
  const generator = await (async () => {
    if (gcConfig.fakeResponsesNonStrict) {
      const fakeGenerator = await FakeContentGenerator.fromFile(
        gcConfig.fakeResponsesNonStrict,
        { nonStrict: true },
      );
      return new LoggingContentGenerator(fakeGenerator, gcConfig);
    }
    if (gcConfig.fakeResponses) {
      const fakeGenerator = await FakeContentGenerator.fromFile(
        gcConfig.fakeResponses,
      );
      return new LoggingContentGenerator(fakeGenerator, gcConfig);
    }

    const authType = config.authType ?? AuthType.OLLAMA;
    if (authType !== AuthType.OLLAMA) {
      throw new Error(
        `Capricorn only supports local inference through Ollama; the "${authType}" back-end is not available.`,
      );
    }

    const settings = gcConfig.getOllamaSettings();
    // Constructing the client validates the endpoint against the local-only
    // policy and throws before any network traffic if it is violated.
    const client = new OllamaClient({
      endpoint: settings.endpoint,
      allowRemoteHost: settings.allowRemoteHost,
      chatTimeoutMs: settings.requestTimeoutMs,
      streamIdleTimeoutMs: settings.streamIdleTimeoutMs,
    });
    // Compression and overflow checks call tokenLimit(model); make them use
    // the window actually allocated on the daemon, not Gemini's 1M default.
    setActiveContextWindow(settings.numCtx);
    return new LoggingContentGenerator(
      new OllamaContentGenerator(client, {
        // The active model is normally the verified Gemma tag chosen by the
        // user. If retained upstream logic (e.g. quota fallback) ever sets a
        // Gemini name, serve the configured Gemma model instead of failing.
        getActiveModel: () => {
          const active = gcConfig.getModel();
          return !active || /^(gemini-|auto)/i.test(active)
            ? settings.model
            : active;
        },
        numCtx: settings.numCtx,
        think: settings.think,
        keepAlive: settings.keepAlive,
      }),
      gcConfig,
    );
  })();

  if (gcConfig.recordResponses) {
    return new RecordingContentGenerator(generator, gcConfig.recordResponses);
  }

  return generator;
}
