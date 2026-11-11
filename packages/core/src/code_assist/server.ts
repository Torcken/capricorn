/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Capricorn: inert replacement for upstream's Google Code Assist
 * server client.
 *
 * Upstream's `CodeAssistServer` was a `ContentGenerator` that talked to
 * `cloudcode-pa.googleapis.com` with the user's Google credentials. Capricorn's
 * only content generator is the local Ollama provider, so a `CodeAssistServer`
 * is never created and `getCodeAssistServer()` always returns `undefined`. The
 * class keeps its public shape (types, field names, method signatures) so the
 * upstream call sites that guard on it still compile unchanged; every network
 * method rejects with {@link CodeAssistNotSupportedError}. The Google endpoint,
 * HTTP/stream plumbing and credit accounting were removed.
 */

import type {
  UserTierId,
  CodeAssistGlobalUserSettingResponse,
  LoadCodeAssistRequest,
  LoadCodeAssistResponse,
  LongRunningOperationResponse,
  OnboardUserRequest,
  SetCodeAssistGlobalUserSettingRequest,
  ClientMetadata,
  RetrieveUserQuotaRequest,
  RetrieveUserQuotaResponse,
  FetchAdminControlsRequest,
  FetchAdminControlsResponse,
  ConversationOffered,
  ConversationInteraction,
  RecordCodeAssistMetricsRequest,
  GeminiUserTier,
} from './types.js';
import type { ListExperimentsResponse } from './experiments/types.js';
import type {
  CountTokensParameters,
  CountTokensResponse,
  EmbedContentParameters,
  EmbedContentResponse,
  GenerateContentParameters,
  GenerateContentResponse,
} from '@google/genai';
import type { ContentGenerator } from '../core/contentGenerator.js';
import type { Config } from '../config/config.js';
import type { LlmRole } from '../telemetry/types.js';

/** HTTP options to be used in each of the requests. */
export interface HttpOptions {
  /** Additional HTTP headers to be sent with the request. */
  headers?: Record<string, string>;
}

/** Thrown by every network method: Capricorn has no Google back-end. */
export class CodeAssistNotSupportedError extends Error {
  constructor() {
    super(
      'Google Code Assist is not supported by Capricorn; inference runs on a local Ollama daemon.',
    );
    this.name = 'CodeAssistNotSupportedError';
  }
}

function notSupported(): Promise<never> {
  return Promise.reject(new CodeAssistNotSupportedError());
}

/** Capricorn: inert stand-in; see the file overview. */
export class CodeAssistServer implements ContentGenerator {
  constructor(
    readonly client: unknown,
    readonly projectId?: string,
    readonly httpOptions: HttpOptions = {},
    readonly sessionId?: string,
    readonly userTier?: UserTierId,
    readonly userTierName?: string,
    readonly paidTier?: GeminiUserTier,
    readonly config?: Config,
  ) {}

  getEffectiveSessionId(): string | undefined {
    return this.config?.getSessionId() ?? this.sessionId;
  }

  generateContentStream(
    _req: GenerateContentParameters,
    _userPromptId: string,
    _role: LlmRole,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    return notSupported();
  }

  generateContent(
    _req: GenerateContentParameters,
    _userPromptId: string,
    _role: LlmRole,
  ): Promise<GenerateContentResponse> {
    return notSupported();
  }

  onboardUser(_req: OnboardUserRequest): Promise<LongRunningOperationResponse> {
    return notSupported();
  }

  getOperation(_name: string): Promise<LongRunningOperationResponse> {
    return notSupported();
  }

  loadCodeAssist(_req: LoadCodeAssistRequest): Promise<LoadCodeAssistResponse> {
    return notSupported();
  }

  refreshAvailableCredits(): Promise<void> {
    return notSupported();
  }

  fetchAdminControls(
    _req: FetchAdminControlsRequest,
  ): Promise<FetchAdminControlsResponse> {
    return notSupported();
  }

  getCodeAssistGlobalUserSetting(): Promise<CodeAssistGlobalUserSettingResponse> {
    return notSupported();
  }

  setCodeAssistGlobalUserSetting(
    _req: SetCodeAssistGlobalUserSettingRequest,
  ): Promise<CodeAssistGlobalUserSettingResponse> {
    return notSupported();
  }

  countTokens(_req: CountTokensParameters): Promise<CountTokensResponse> {
    return notSupported();
  }

  embedContent(_req: EmbedContentParameters): Promise<EmbedContentResponse> {
    return notSupported();
  }

  listExperiments(_metadata: ClientMetadata): Promise<ListExperimentsResponse> {
    return notSupported();
  }

  retrieveUserQuota(
    _req: RetrieveUserQuotaRequest,
  ): Promise<RetrieveUserQuotaResponse> {
    return notSupported();
  }

  recordConversationOffered(
    _conversationOffered: ConversationOffered,
  ): Promise<void> {
    return notSupported();
  }

  recordConversationInteraction(
    _interaction: ConversationInteraction,
  ): Promise<void> {
    return notSupported();
  }

  recordCodeAssistMetrics(
    _request: RecordCodeAssistMetricsRequest,
  ): Promise<void> {
    return notSupported();
  }

  /** Kept for `LoggingContentGenerator`'s (unreachable) server branch. */
  getMethodUrl(method: string): string {
    return `capricorn-unsupported:${method}`;
  }
}
