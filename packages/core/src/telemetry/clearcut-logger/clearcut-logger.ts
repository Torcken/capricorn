/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EventMetadataKey } from './event-metadata-key.js';

/**
 * @fileoverview Capricorn: no-op replacement for upstream's Clearcut logger.
 *
 * Upstream sent usage statistics to Google (play.googleapis.com/log) through
 * this class. Capricorn sends no usage statistics, so the network client and
 * event builders are gone. The class keeps its public surface so the ~50
 * existing call sites (`ClearcutLogger.getInstance(config)?.logXxx(...)`)
 * stay unchanged and upstream merges stay small: `getInstance` always returns
 * `undefined`, so none of those calls do anything. The event name enum and
 * data types are kept because other telemetry code still refers to them.
 */

export enum EventNames {
  START_SESSION = 'start_session',
  NEW_PROMPT = 'new_prompt',
  TOOL_CALL = 'tool_call',
  FILE_OPERATION = 'file_operation',
  API_REQUEST = 'api_request',
  API_RESPONSE = 'api_response',
  API_ERROR = 'api_error',
  END_SESSION = 'end_session',
  FLASH_FALLBACK = 'flash_fallback',
  RIPGREP_FALLBACK = 'ripgrep_fallback',
  LOOP_DETECTED = 'loop_detected',
  LOOP_DETECTION_DISABLED = 'loop_detection_disabled',
  NEXT_SPEAKER_CHECK = 'next_speaker_check',
  SLASH_COMMAND = 'slash_command',
  REWIND = 'rewind',
  MALFORMED_JSON_RESPONSE = 'malformed_json_response',
  IDE_CONNECTION = 'ide_connection',
  KITTY_SEQUENCE_OVERFLOW = 'kitty_sequence_overflow',
  CHAT_COMPRESSION = 'chat_compression',
  CONVERSATION_FINISHED = 'conversation_finished',
  INVALID_CHUNK = 'invalid_chunk',
  CONTENT_RETRY = 'content_retry',
  CONTENT_RETRY_FAILURE = 'content_retry_failure',
  RETRY_ATTEMPT = 'retry_attempt',
  EXTENSION_ENABLE = 'extension_enable',
  EXTENSION_DISABLE = 'extension_disable',
  EXTENSION_INSTALL = 'extension_install',
  EXTENSION_UNINSTALL = 'extension_uninstall',
  EXTENSION_UPDATE = 'extension_update',
  TOOL_OUTPUT_TRUNCATED = 'tool_output_truncated',
  MODEL_ROUTING = 'model_routing',
  MODEL_SLASH_COMMAND = 'model_slash_command',
  EDIT_STRATEGY = 'edit_strategy',
  EDIT_CORRECTION = 'edit_correction',
  AGENT_START = 'agent_start',
  AGENT_FINISH = 'agent_finish',
  RECOVERY_ATTEMPT = 'recovery_attempt',
  WEB_FETCH_FALLBACK_ATTEMPT = 'web_fetch_fallback_attempt',
  LLM_LOOP_CHECK = 'llm_loop_check',
  HOOK_CALL = 'hook_call',
  APPROVAL_MODE_SWITCH = 'approval_mode_switch',
  APPROVAL_MODE_DURATION = 'approval_mode_duration',
  PLAN_EXECUTION = 'plan_execution',
  TOOL_OUTPUT_MASKING = 'tool_output_masking',
  KEYCHAIN_AVAILABILITY = 'keychain_availability',
  TOKEN_STORAGE_INITIALIZATION = 'token_storage_initialization',
  ONBOARDING_START = 'onboarding_start',
  ONBOARDING_SUCCESS = 'onboarding_success',
  CONSECA_POLICY_GENERATION = 'conseca_policy_generation',
  CONSECA_VERDICT = 'conseca_verdict',
  STARTUP_STATS = 'startup_stats',
  CREDITS_USED = 'credits_used',
  OVERAGE_OPTION_SELECTED = 'overage_option_selected',
  EMPTY_WALLET_MENU_SHOWN = 'empty_wallet_menu_shown',
  CREDIT_PURCHASE_CLICK = 'credit_purchase_click',
  BROWSER_AGENT_CONNECTION = 'browser_agent_connection',
  BROWSER_AGENT_VISION_STATUS = 'browser_agent_vision_status',
  BROWSER_AGENT_TASK_OUTCOME = 'browser_agent_task_outcome',
  BROWSER_AGENT_CLEANUP = 'browser_agent_cleanup',
}

export interface LogResponse {
  nextRequestWaitMs?: number;
}

export interface LogEventEntry {
  event_time_ms: number;
  source_extension_json: string;
  exp?: {
    gws_experiment: number[];
  };
}

export interface EventValue {
  gemini_cli_key: EventMetadataKey;
  value: string;
}

export interface LogEvent {
  console_type: 'GEMINI_CLI';
  application: number;
  event_name: string;
  event_metadata: EventValue[][];
  client_email?: string;
  client_install_id?: string;
}

export interface LogRequest {
  log_source_name: 'CONCORD';
  request_time_ms: number;
  log_event: LogEventEntry[][];
}

/** Capricorn: inert stand-in; see the file overview. */
export class ClearcutLogger {
  /** Always `undefined`: Capricorn never creates a usage-statistics logger. */
  static getInstance(_config?: unknown): ClearcutLogger | undefined {
    return undefined;
  }

  /** No-op (kept for tests and callers that reset the singleton). */
  static clearInstance(): void {}

  /** Builds an event object; nothing is ever sent. */
  createLogEvent(eventName: EventNames, data: EventValue[] = []): LogEvent {
    return {
      console_type: 'GEMINI_CLI',
      application: 0,
      event_name: eventName,
      event_metadata: [data],
    };
  }

  enqueueHelper(..._args: unknown[]): void {}
  enqueueLogEvent(..._args: unknown[]): void {}
  async enqueueLogEventAfterExperimentsLoadAsync(
    ..._args: unknown[]
  ): Promise<void> {}
  createBasicLogEvent(..._args: unknown[]): void {}
  flushIfNeeded(..._args: unknown[]): void {}
  async flushToClearcut(..._args: unknown[]): Promise<void> {}
  async logStartSessionEvent(..._args: unknown[]): Promise<void> {}
  logNewPromptEvent(..._args: unknown[]): void {}
  logToolCallEvent(..._args: unknown[]): void {}
  logFileOperationEvent(..._args: unknown[]): void {}
  logApiRequestEvent(..._args: unknown[]): void {}
  logApiResponseEvent(..._args: unknown[]): void {}
  logApiErrorEvent(..._args: unknown[]): void {}
  logChatCompressionEvent(..._args: unknown[]): void {}
  logFlashFallbackEvent(..._args: unknown[]): void {}
  logRipgrepFallbackEvent(..._args: unknown[]): void {}
  logLoopDetectedEvent(..._args: unknown[]): void {}
  logLoopDetectionDisabledEvent(..._args: unknown[]): void {}
  logNextSpeakerCheck(..._args: unknown[]): void {}
  logSlashCommandEvent(..._args: unknown[]): void {}
  logRewindEvent(..._args: unknown[]): void {}
  logMalformedJsonResponseEvent(..._args: unknown[]): void {}
  logIdeConnectionEvent(..._args: unknown[]): void {}
  logConversationFinishedEvent(..._args: unknown[]): void {}
  logEndSessionEvent(..._args: unknown[]): void {}
  logInvalidChunkEvent(..._args: unknown[]): void {}
  logContentRetryEvent(..._args: unknown[]): void {}
  logContentRetryFailureEvent(..._args: unknown[]): void {}
  logNetworkRetryAttemptEvent(..._args: unknown[]): void {}
  async logExtensionInstallEvent(..._args: unknown[]): Promise<void> {}
  async logExtensionUninstallEvent(..._args: unknown[]): Promise<void> {}
  async logExtensionUpdateEvent(..._args: unknown[]): Promise<void> {}
  logToolOutputTruncatedEvent(..._args: unknown[]): void {}
  logToolOutputMaskingEvent(..._args: unknown[]): void {}
  logModelRoutingEvent(..._args: unknown[]): void {}
  async logExtensionEnableEvent(..._args: unknown[]): Promise<void> {}
  logModelSlashCommandEvent(..._args: unknown[]): void {}
  async logExtensionDisableEvent(..._args: unknown[]): Promise<void> {}
  logEditStrategyEvent(..._args: unknown[]): void {}
  logEditCorrectionEvent(..._args: unknown[]): void {}
  logAgentStartEvent(..._args: unknown[]): void {}
  logAgentFinishEvent(..._args: unknown[]): void {}
  logRecoveryAttemptEvent(..._args: unknown[]): void {}
  logWebFetchFallbackAttemptEvent(..._args: unknown[]): void {}
  logLlmLoopCheckEvent(..._args: unknown[]): void {}
  logHookCallEvent(..._args: unknown[]): void {}
  logApprovalModeSwitchEvent(..._args: unknown[]): void {}
  logApprovalModeDurationEvent(..._args: unknown[]): void {}
  logPlanExecutionEvent(..._args: unknown[]): void {}
  logKeychainAvailabilityEvent(..._args: unknown[]): void {}
  logTokenStorageInitializationEvent(..._args: unknown[]): void {}
  logOnboardingStartEvent(..._args: unknown[]): void {}
  logOnboardingSuccessEvent(..._args: unknown[]): void {}
  logStartupStatsEvent(..._args: unknown[]): void {}
  logCreditsUsedEvent(..._args: unknown[]): void {}
  logOverageOptionSelectedEvent(..._args: unknown[]): void {}
  logEmptyWalletMenuShownEvent(..._args: unknown[]): void {}
  logCreditPurchaseClickEvent(..._args: unknown[]): void {}
  logBrowserAgentConnectionEvent(..._args: unknown[]): void {}
  logBrowserAgentVisionStatusEvent(..._args: unknown[]): void {}
  logBrowserAgentTaskOutcomeEvent(..._args: unknown[]): void {}
  logBrowserAgentCleanupEvent(..._args: unknown[]): void {}
  addDefaultFields(..._args: unknown[]): void {}
  getProxyAgent(..._args: unknown[]): void {}
  getConfigJson(..._args: unknown[]): void {}
  shutdown(..._args: unknown[]): void {}
}
