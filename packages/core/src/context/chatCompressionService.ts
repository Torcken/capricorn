/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Content } from '@google/genai';
import type { Config } from '../config/config.js';
import type { GeminiChat } from '../core/geminiChat.js';
import { type ChatCompressionInfo, CompressionStatus } from '../core/turn.js';
import {
  getActiveContextWindow,
  tokenLimit,
  windowBudget,
} from '../core/tokenLimits.js';
import { getCompressionPrompt } from '../core/prompts.js';
import { getLocalCompressionPrompt } from '../prompts/capricornSnippets.js';
import { getResponseText } from '../utils/partUtils.js';
import { logChatCompression } from '../telemetry/loggers.js';
import { makeChatCompressionEvent, LlmRole } from '../telemetry/types.js';
import {
  saveTruncatedToolOutput,
  formatTruncatedToolOutput,
} from '../utils/fileUtils.js';
import { debugLogger } from '../utils/debugLogger.js';
import { getInitialChatHistory } from '../utils/environmentContext.js';
import {
  calculateRequestTokenCount,
  estimateTokenCountSync,
} from '../utils/tokenCalculation.js';
import {
  DEFAULT_GEMINI_FLASH_LITE_MODEL,
  DEFAULT_GEMINI_MODEL,
  PREVIEW_GEMINI_MODEL,
  PREVIEW_GEMINI_FLASH_MODEL,
  PREVIEW_GEMINI_3_1_MODEL,
  PREVIEW_GEMINI_FLASH_LITE_MODEL,
  BASE_GEMINI_FLASH_MODEL,
  LATEST_GEMINI_FLASH_MODEL,
  LEGACY_CCPA_FLASH_MODEL,
  BASE_GEMINI_FLASH_LITE_MODEL,
  LATEST_GEMINI_FLASH_LITE_MODEL,
} from '../config/models.js';
import { PreCompressTrigger } from '../hooks/types.js';

/**
 * Default threshold for compression token count as a fraction of the model's
 * token limit. If the chat history exceeds this threshold, it will be compressed.
 */
export const DEFAULT_COMPRESSION_TOKEN_THRESHOLD = 0.5;

/**
 * Number of recent tool response turns that must be preserved at full fidelity.
 */
export const RECENT_TURNS_PROTECTED = 3;

/**
 * Tools that retrieve file content, documentation, or search results whose outputs
 * are essential for multi-step reasoning and must be exempted from collapsing into snippets.
 */
export const RETRIEVAL_TOOL_NAMES_EXEMPT_FROM_COLLAPSE: ReadonlySet<string> =
  new Set([
    'read_file',
    'read_many_files',
    'get_internal_docs',
    'read_mcp_resource',
    'grep',
    'rip_grep',
    'glob',
    'search_file_content',
    'find_files',
  ]);

export function isExemptRetrievalTool(
  toolName?: string,
  exemptTools: ReadonlySet<string> = RETRIEVAL_TOOL_NAMES_EXEMPT_FROM_COLLAPSE,
): boolean {
  if (!toolName) {
    return false;
  }
  const normalized = toolName.toLowerCase();
  if (exemptTools.has(normalized)) {
    return true;
  }
  return (
    normalized.endsWith('read_file') ||
    normalized.endsWith('read_files') ||
    normalized.endsWith('read_many_files') ||
    normalized.endsWith('read_resource')
  );
}

export const COLLAPSED_FUNCTION_RESPONSE_MAX_BYTES = 2048; // 2 KB

/**
 * Computes the total byte size of text and payload content across all turns in history.
 */
export function calculateHistoryByteSize(history: readonly Content[]): number {
  let bytes = 0;
  for (const turn of history) {
    if (turn.parts) {
      for (const part of turn.parts) {
        if (part.text) {
          bytes += Buffer.byteLength(part.text, 'utf8');
        }
        if (part.functionResponse?.response) {
          const resp = part.functionResponse.response;
          if (typeof resp === 'string') {
            bytes += Buffer.byteLength(resp, 'utf8');
          } else if (typeof resp === 'object' && resp !== null) {
            try {
              bytes += Buffer.byteLength(JSON.stringify(resp), 'utf8');
            } catch {
              // ignore JSON errors
            }
          }
        }
        if (part.inlineData?.data) {
          bytes += Buffer.byteLength(part.inlineData.data, 'utf8');
        }
      }
    }
  }
  return bytes;
}

const defaultGraphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: 'grapheme',
});

/**
 * Collapses detailed logs in older functionResponse payloads from completed previous turns.
 * The most recent N tool response turns (default 3) and retrieval tools (read_file, etc.)
 * are preserved intact for immediate context fidelity and multi-step reasoning.
 */
export function collapseOlderFunctionResponses(
  history: Content[],
  maxBytesPerOldResponse: number = COLLAPSED_FUNCTION_RESPONSE_MAX_BYTES,
  segmenter: Intl.Segmenter = defaultGraphemeSegmenter,
  protectedTurns: number = RECENT_TURNS_PROTECTED,
  exemptTools: ReadonlySet<string> = RETRIEVAL_TOOL_NAMES_EXEMPT_FROM_COLLAPSE,
): Content[] {
  // Find all indices of user messages that contain functionResponse
  const toolIndices: number[] = [];
  for (let i = 0; i < history.length; i++) {
    if (
      history[i].role === 'user' &&
      history[i].parts?.some((p) => !!p.functionResponse)
    ) {
      toolIndices.push(i);
    }
  }

  if (toolIndices.length <= protectedTurns) {
    return history;
  }

  // The last N tool indices represent recent tool turns that must be protected.
  // Only prior tool indices are older completed turns eligible for collapsing.
  const cutoffToolIndex = toolIndices[toolIndices.length - protectedTurns];

  const collapseString = (str: string): string => {
    const totalBytes = Buffer.byteLength(str, 'utf8');
    if (totalBytes <= maxBytesPerOldResponse) {
      return str;
    }

    const previewBytes = maxBytesPerOldResponse;
    let preview = '';
    let currentBytes = 0;

    for (const { segment } of segmenter.segment(str)) {
      const segmentBytes = Buffer.byteLength(segment, 'utf8');
      if (currentBytes + segmentBytes > previewBytes) {
        break;
      }
      preview += segment;
      currentBytes += segmentBytes;
    }

    const omittedBytes = totalBytes - currentBytes;
    return `${preview}\n... [Tool output collapsed from previous turn: ${omittedBytes} bytes omitted to conserve memory] ...`;
  };

  const collapseValue = (val: unknown): unknown => {
    if (typeof val === 'string') {
      return collapseString(val);
    }

    if (Array.isArray(val)) {
      let arrayModified = false;
      const newVal = val.map((item) => {
        const collapsed = collapseValue(item);
        if (collapsed !== item) {
          arrayModified = true;
        }
        return collapsed;
      });
      return arrayModified ? newVal : val;
    }

    if (typeof val === 'object' && val !== null) {
      const proto: unknown = Object.getPrototypeOf(val);
      if (proto !== Object.prototype && proto !== null) {
        return val;
      }

      let objModified = false;
      const copy: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val)) {
        const collapsed = collapseValue(v);
        if (collapsed !== v) {
          objModified = true;
        }
        copy[k] = collapsed;
      }
      return objModified ? copy : val;
    }

    return val;
  };

  let modified = false;
  const newHistory = history.map((content, idx) => {
    // Only process older tool response turns before the protected recent window
    if (idx >= cutoffToolIndex || content.role !== 'user' || !content.parts) {
      return content;
    }

    let partsModified = false;
    const newParts = content.parts.map((part) => {
      if (!part.functionResponse?.response) {
        return part;
      }

      // Exempt retrieval and file reading tools from collapsing
      if (isExemptRetrievalTool(part.functionResponse.name, exemptTools)) {
        return part;
      }

      const resp: unknown = part.functionResponse.response;
      const newResp = collapseValue(resp);

      if (newResp !== resp) {
        partsModified = true;
        return {
          ...part,
          functionResponse: {
            // eslint-disable-next-line @typescript-eslint/no-misused-spread
            ...part.functionResponse,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
            response: newResp as Record<string, unknown>,
          },
        };
      }

      return part;
    });

    if (partsModified) {
      modified = true;
      return { ...content, parts: newParts };
    }
    return content;
  });

  return modified ? newHistory : history;
}

/**
 * The fraction of the latest chat history to keep. A value of 0.3
 * means that only the last 30% of the chat history will be kept after compression.
 */
const COMPRESSION_PRESERVE_THRESHOLD = 0.3;

/**
 * The budget for function response tokens in the preserved history.
 */
const COMPRESSION_FUNCTION_RESPONSE_TOKEN_BUDGET = 50_000;

/**
 * Capricorn: share of a local window that preserved tool output may use
 * before older large outputs are truncated (upstream's 50K exceeds a whole
 * 32K window, so truncation never happened locally).
 */
const LOCAL_FUNCTION_RESPONSE_SHARE = 0.3;

/**
 * Capricorn: tokens kept free for the summary itself when sizing the
 * summarizer's input against a local window, capped at this share of it.
 */
const SUMMARY_OUTPUT_RESERVE_TOKENS = 4096;
const SUMMARY_OUTPUT_RESERVE_SHARE = 0.2;

/**
 * Returns the index of the oldest item to keep when compressing. May return
 * contents.length which indicates that everything should be compressed.
 *
 * Exported for testing purposes.
 */
export function findCompressSplitPoint(
  contents: Content[],
  fraction: number,
  options: { allowToolExchangeBoundary?: boolean } = {},
): number {
  if (fraction <= 0 || fraction >= 1) {
    throw new Error('Fraction must be between 0 and 1');
  }

  const charCounts = contents.map((content) => JSON.stringify(content).length);
  const totalCharCount = charCounts.reduce((a, b) => a + b, 0);
  const targetCharCount = totalCharCount * fraction;

  let lastSplitPoint = 0; // 0 is always valid (compress nothing)
  let cumulativeCharCount = 0;
  for (let i = 0; i < contents.length; i++) {
    const content = contents[i];
    if (
      (content.role === 'user' &&
        !content.parts?.some((part) => !!part.functionResponse)) ||
      (options.allowToolExchangeBoundary && isToolExchangeBoundary(contents, i))
    ) {
      if (cumulativeCharCount >= targetCharCount) {
        return i;
      }
      lastSplitPoint = i;
    }
    cumulativeCharCount += charCounts[i];
  }

  // We found no split points after targetCharCount.
  // Check if it's safe to compress everything.
  const lastContent = contents[contents.length - 1];
  if (
    lastContent?.role === 'model' &&
    !lastContent?.parts?.some((part) => part.functionCall)
  ) {
    return contents.length;
  }

  // Can't compress everything so just compress at last splitpoint.
  return lastSplitPoint;
}

/**
 * Capricorn: whether `contents[i]` starts a new tool exchange, i.e. a model
 * turn right after the tool results of the previous one. Splitting there
 * keeps every function call together with its response.
 *
 * Why: upstream splits only before a plain user message. In one long agentic
 * task every later user message is a tool result, so the only split point is
 * the start and nothing can be compressed; at Gemini's 1M tokens a single
 * task never fills the window, but a 32K local window fills mid-task.
 */
function isToolExchangeBoundary(contents: Content[], i: number): boolean {
  const prev = contents[i - 1];
  return (
    i > 0 &&
    contents[i].role === 'model' &&
    prev?.role === 'user' &&
    (prev.parts?.some((part) => !!part.functionResponse) ?? false)
  );
}

export function modelStringToModelConfigAlias(model: string): string {
  switch (model) {
    case PREVIEW_GEMINI_MODEL:
    case PREVIEW_GEMINI_3_1_MODEL:
      return 'chat-compression-3-pro';
    case PREVIEW_GEMINI_FLASH_MODEL:
    case BASE_GEMINI_FLASH_MODEL:
    case LATEST_GEMINI_FLASH_MODEL:
    case LEGACY_CCPA_FLASH_MODEL:
      return 'chat-compression-3-flash';
    case PREVIEW_GEMINI_FLASH_LITE_MODEL:
    // fallthrough
    case BASE_GEMINI_FLASH_LITE_MODEL:
    case DEFAULT_GEMINI_FLASH_LITE_MODEL:
    case LATEST_GEMINI_FLASH_LITE_MODEL:
      return 'chat-compression-3.1-flash-lite';
    case 'gemini-2.5-flash-lite':
      return 'chat-compression-2.5-flash-lite';
    case DEFAULT_GEMINI_MODEL:
      return 'chat-compression-2.5-pro';
    case 'gemini-2.5-flash':
      return 'chat-compression-2.5-flash';
    default:
      return 'chat-compression-default';
  }
}

/**
 * Processes the chat history to ensure function responses don't exceed a specific token budget.
 *
 * This function implements a "Reverse Token Budget" strategy:
 * 1. It iterates through the history from the most recent turn to the oldest.
 * 2. It keeps a running tally of tokens used by function responses.
 * 3. Recent tool outputs are preserved in full to maintain high-fidelity context for the current turn.
 * 4. Once the budget (COMPRESSION_FUNCTION_RESPONSE_TOKEN_BUDGET) is exceeded, any older large
 *    tool responses are truncated to their last 30 lines and saved to a temporary file.
 *
 * This ensures that compression effectively reduces context size even when recent turns
 * contain massive tool outputs (like large grep results or logs).
 */
async function truncateHistoryToBudget(
  history: readonly Content[],
  config: Config,
): Promise<Content[]> {
  let functionResponseTokenCounter = 0;
  const truncatedHistory: Content[] = [];

  // Iterate backwards: newest messages first to prioritize their context.
  for (let i = history.length - 1; i >= 0; i--) {
    const content = history[i];
    const newParts = [];

    if (content.parts) {
      // Process parts of the message backwards as well.
      for (let j = content.parts.length - 1; j >= 0; j--) {
        const part = content.parts[j];

        if (part.functionResponse) {
          const responseObj = part.functionResponse.response;
          // Ensure we have a string representation to truncate.
          // If the response is an object, we try to extract a primary string field (output or content).
          let contentStr: string;
          if (typeof responseObj === 'string') {
            contentStr = responseObj;
          } else if (responseObj && typeof responseObj === 'object') {
            if (
              'output' in responseObj &&
              // eslint-disable-next-line no-restricted-syntax
              typeof responseObj['output'] === 'string'
            ) {
              contentStr = responseObj['output'];
            } else if (
              'content' in responseObj &&
              // eslint-disable-next-line no-restricted-syntax
              typeof responseObj['content'] === 'string'
            ) {
              contentStr = responseObj['content'];
            } else {
              contentStr = JSON.stringify(responseObj, null, 2);
            }
          } else {
            contentStr = JSON.stringify(responseObj, null, 2);
          }

          const tokens = estimateTokenCountSync([{ text: contentStr }]);

          if (
            functionResponseTokenCounter + tokens >
            windowBudget(
              COMPRESSION_FUNCTION_RESPONSE_TOKEN_BUDGET,
              LOCAL_FUNCTION_RESPONSE_SHARE,
            )
          ) {
            try {
              // Budget exceeded: Truncate this response.
              const { outputFile } = await saveTruncatedToolOutput(
                contentStr,
                part.functionResponse.name ?? 'unknown_tool',
                config.getNextCompressionTruncationId(),
                config.storage.getProjectTempDir(),
              );

              const truncatedMessage = formatTruncatedToolOutput(
                contentStr,
                outputFile,
                config.getTruncateToolOutputThreshold(),
              );

              newParts.unshift({
                functionResponse: {
                  // eslint-disable-next-line @typescript-eslint/no-misused-spread
                  ...part.functionResponse,
                  response: { output: truncatedMessage },
                },
              });

              // Count the small truncated placeholder towards the budget.
              functionResponseTokenCounter += estimateTokenCountSync([
                { text: truncatedMessage },
              ]);
            } catch (error) {
              // Fallback: if truncation fails, keep the original part to avoid data loss in the chat.
              debugLogger.debug('Failed to truncate history to budget:', error);
              newParts.unshift(part);
              functionResponseTokenCounter += tokens;
            }
          } else {
            // Within budget: keep the full response.
            functionResponseTokenCounter += tokens;
            newParts.unshift(part);
          }
        } else {
          // Non-tool response part: always keep.
          newParts.unshift(part);
        }
      }
    }

    // Reconstruct the message with processed (potentially truncated) parts.
    truncatedHistory.unshift({ ...content, parts: newParts });
  }

  return truncatedHistory;
}

export class ChatCompressionService {
  async compress(
    chat: GeminiChat,
    promptId: string,
    force: boolean,
    model: string,
    config: Config,
    hasFailedCompressionAttempt: boolean,
    abortSignal?: AbortSignal,
  ): Promise<{ newHistory: Content[] | null; info: ChatCompressionInfo }> {
    const curatedHistory = chat.getHistory(true);

    // Regardless of `force`, don't do anything if the history is empty.
    if (curatedHistory.length === 0) {
      return {
        newHistory: null,
        info: {
          originalTokenCount: 0,
          newTokenCount: 0,
          compressionStatus: CompressionStatus.NOOP,
        },
      };
    }

    // Fire PreCompress hook before compression
    // This fires for both manual and auto compression attempts
    const trigger = force ? PreCompressTrigger.Manual : PreCompressTrigger.Auto;
    await config.getHookSystem()?.firePreCompressEvent(trigger);

    const lastPromptTokenCount = chat.getLastPromptTokenCount();
    const originalTokenCount =
      lastPromptTokenCount > 0
        ? lastPromptTokenCount
        : estimateTokenCountSync(curatedHistory.flatMap((c) => c.parts || []));

    // Don't compress if not forced and we are under the limit.
    if (!force) {
      const threshold =
        (await config.getCompressionThreshold()) ??
        DEFAULT_COMPRESSION_TOKEN_THRESHOLD;
      const isOverModelThreshold =
        originalTokenCount >=
        compressionTriggerTokens(
          threshold,
          tokenLimit(model),
          originalTokenCount,
          curatedHistory,
        );

      if (!isOverModelThreshold) {
        return {
          newHistory: null,
          info: {
            originalTokenCount,
            newTokenCount: originalTokenCount,
            compressionStatus: CompressionStatus.NOOP,
          },
        };
      }
    }

    // Apply token-based truncation to the entire history before splitting.
    // This ensures that even the "to compress" portion is within safe limits for the summarization model.
    const truncatedHistory = await truncateHistoryToBudget(
      curatedHistory,
      config,
    );

    // If summarization previously failed (and not forced), we only rely on truncation.
    // We do NOT attempt to invoke the LLM for summarization again to avoid repeated failures/costs.
    if (hasFailedCompressionAttempt && !force) {
      const truncatedTokenCount = estimateTokenCountSync(
        truncatedHistory.flatMap((c) => c.parts || []),
      );

      // If truncation reduced the size, we consider it a successful "compression" (truncation only).
      if (truncatedTokenCount < originalTokenCount) {
        return {
          newHistory: truncatedHistory,
          info: {
            originalTokenCount,
            newTokenCount: truncatedTokenCount,
            compressionStatus: CompressionStatus.CONTENT_TRUNCATED,
          },
        };
      }

      return {
        newHistory: null,
        info: {
          originalTokenCount,
          newTokenCount: originalTokenCount,
          compressionStatus: CompressionStatus.NOOP,
        },
      };
    }

    const splitPoint = findCompressSplitPoint(
      truncatedHistory,
      1 - COMPRESSION_PRESERVE_THRESHOLD,
      // Capricorn: a local window can fill within one task (see
      // isToolExchangeBoundary).
      { allowToolExchangeBoundary: getActiveContextWindow() !== undefined },
    );

    const historyToCompressTruncated = truncatedHistory.slice(0, splitPoint);
    const historyToKeepTruncated = truncatedHistory.slice(splitPoint);

    if (historyToCompressTruncated.length === 0) {
      return {
        newHistory: null,
        info: {
          originalTokenCount,
          newTokenCount: originalTokenCount,
          compressionStatus: CompressionStatus.NOOP,
        },
      };
    }

    // High Fidelity Decision: Should we send the original or truncated history to the summarizer?
    const originalHistoryToCompress = curatedHistory.slice(0, splitPoint);
    const originalToCompressTokenCount = estimateTokenCountSync(
      originalHistoryToCompress.flatMap((c) => c.parts || []),
    );

    // Capricorn: against a local window the summarizer's input must leave
    // room for the compression prompt and the summary itself; otherwise
    // Ollama silently drops the oldest tokens of the request. Upstream
    // compared against the whole window, which on 1M tokens never mattered.
    const summarizerBudget = summarizerInputBudget(config, model);
    let historyForSummarizer =
      originalToCompressTokenCount < summarizerBudget
        ? originalHistoryToCompress
        : historyToCompressTruncated;
    if (getActiveContextWindow() !== undefined) {
      historyForSummarizer = fitToTokenBudget(
        historyForSummarizer,
        summarizerBudget,
      );
    }

    const hasPreviousSnapshot = historyForSummarizer.some((c) =>
      c.parts?.some((p) => p.text?.includes('<state_snapshot>')),
    );

    const anchorInstruction = hasPreviousSnapshot
      ? 'A previous <state_snapshot> exists in the history. You MUST integrate all still-relevant information from that snapshot into the new one, updating it with the more recent events. Do not lose established constraints or critical knowledge.'
      : 'Generate a new <state_snapshot> based on the provided history.';

    // Capricorn: locally the snapshot is written directly (no scratchpad)
    // and its length is capped; see getLocalCompressionPrompt.
    const local = getActiveContextWindow() !== undefined;
    const summaryResponse = await config.getBaseLlmClient().generateContent({
      modelConfigKey: { model: modelStringToModelConfigAlias(model) },
      contents: [
        ...historyForSummarizer,
        {
          role: 'user',
          parts: [
            {
              text: local
                ? `${anchorInstruction}\n\nWrite the <state_snapshot> now, and nothing else.`
                : `${anchorInstruction}\n\nFirst, reason in your scratchpad. Then, generate the updated <state_snapshot>.`,
            },
          ],
        },
      ],
      systemInstruction: { text: compressionPrompt(config) },
      promptId,
      // TODO(joshualitt): wire up a sensible abort signal,
      abortSignal: abortSignal ?? new AbortController().signal,
      role: LlmRole.UTILITY_COMPRESSOR,
      // Capricorn: no thinking either. The compression alias resolves to a
      // Gemini config that asks for thoughts; Gemma then spent most of the
      // capped output reasoning and the snapshot was cut off (seen at 8K:
      // the tax-exempt rule was lost and the task failed).
      ...(local && {
        maxOutputTokens: localSummaryMaxTokens(),
        disableThinking: true,
      }),
    });
    // Capricorn: keep only the snapshot. The prompt asks the model to reason
    // in a scratchpad first; storing that reasoning in history wastes the
    // very window compression is meant to free.
    const summary = extractStateSnapshot(
      getResponseText(summaryResponse) ?? '',
    );

    // Capricorn: skip the probe on a local model. It re-reads the whole
    // history to the model a second time, doubling the cost of compression
    // (minutes on a CPU). Evaluated with the eval suite under context
    // pressure (`--num-ctx 8192`, evals/capricorn/RESULTS.md).
    if (getActiveContextWindow() !== undefined) {
      return this.finishCompression(
        config,
        model,
        summary.trim(),
        historyToKeepTruncated,
        originalTokenCount,
      );
    }

    // Phase 3: The "Probe" Verification (Self-Correction)
    // We perform a second lightweight turn to ensure no critical information was lost.
    const verificationResponse = await config
      .getBaseLlmClient()
      .generateContent({
        modelConfigKey: { model: modelStringToModelConfigAlias(model) },
        contents: [
          ...historyForSummarizer,
          {
            role: 'model',
            parts: [{ text: summary }],
          },
          {
            role: 'user',
            parts: [
              {
                text: 'Critically evaluate the <state_snapshot> you just generated. Did you omit any specific technical details, file paths, tool results, or user constraints mentioned in the history? If anything is missing or could be more precise, generate a FINAL, improved <state_snapshot>. Otherwise, repeat the exact same <state_snapshot> again.',
              },
            ],
          },
        ],
        systemInstruction: { text: getCompressionPrompt(config) },
        promptId: `${promptId}-verify`,
        role: LlmRole.UTILITY_COMPRESSOR,
        abortSignal: abortSignal ?? new AbortController().signal,
      });

    const finalSummary = extractStateSnapshot(
      getResponseText(verificationResponse)?.trim() || summary,
    ).trim();

    return this.finishCompression(
      config,
      model,
      finalSummary,
      historyToKeepTruncated,
      originalTokenCount,
    );
  }

  /**
   * Builds the compressed history from a summary, or reports why it could
   * not be used. Capricorn: extracted from `compress` (unchanged logic) so the
   * local path, which skips the verification probe, shares it.
   */
  private async finishCompression(
    config: Config,
    model: string,
    finalSummary: string,
    historyToKeepTruncated: Content[],
    originalTokenCount: number,
  ): Promise<{ newHistory: Content[] | null; info: ChatCompressionInfo }> {
    if (!finalSummary) {
      logChatCompression(
        config,
        makeChatCompressionEvent({
          tokens_before: originalTokenCount,
          tokens_after: originalTokenCount, // No change since it failed
        }),
      );
      return {
        newHistory: null,
        info: {
          originalTokenCount,
          newTokenCount: originalTokenCount,
          compressionStatus: CompressionStatus.COMPRESSION_FAILED_EMPTY_SUMMARY,
        },
      };
    }

    const extraHistory: Content[] = [
      {
        role: 'user',
        // Capricorn: framed for local models. Without the framing, Gemma
        // took a bare snapshot (especially mid-task, where no model reply
        // follows it) for the message to answer and returned it as its
        // final answer (seen in the eval at 8K).
        parts: [
          {
            text:
              getActiveContextWindow() === undefined
                ? finalSummary
                : `${LOCAL_SUMMARY_PREAMBLE}\n\n${finalSummary}`,
          },
        ],
      },
      // Capricorn: after a mid-task split the kept history starts with a
      // model turn; an acknowledgement before it would put two model turns
      // in a row.
      ...(historyToKeepTruncated[0]?.role === 'model'
        ? []
        : [
            {
              role: 'model',
              parts: [{ text: 'Got it. Thanks for the additional context!' }],
            },
          ]),
      ...historyToKeepTruncated,
    ];

    // Use a shared utility to construct the initial history for an accurate token count.
    const fullNewHistory = await getInitialChatHistory(config, extraHistory);

    const newTokenCount = await calculateRequestTokenCount(
      fullNewHistory.flatMap(
        (c) => ('content' in c ? c.content.parts : c.parts) || [],
      ),
      config.getContentGenerator(),
      model,
    );

    logChatCompression(
      config,
      makeChatCompressionEvent({
        tokens_before: originalTokenCount,
        tokens_after: newTokenCount,
      }),
    );

    if (newTokenCount > originalTokenCount) {
      return {
        newHistory: null,
        info: {
          originalTokenCount,
          newTokenCount,
          compressionStatus:
            CompressionStatus.COMPRESSION_FAILED_INFLATED_TOKEN_COUNT,
        },
      };
    } else {
      return {
        newHistory: extraHistory,
        info: {
          originalTokenCount,
          newTokenCount,
          compressionStatus: CompressionStatus.COMPRESSED,
        },
      };
    }
  }
}

/**
 * Capricorn: tokens the summarizer's history may use: the window minus the
 * compression prompt and room for the summary. Outside a local session this
 * is the full token limit, as upstream compared against.
 */
function summarizerInputBudget(config: Config, model: string): number {
  const window = getActiveContextWindow();
  if (window === undefined) return tokenLimit(model);
  const promptTokens = estimateTokenCountSync([
    { text: compressionPrompt(config) },
  ]);
  const reserve = Math.min(
    SUMMARY_OUTPUT_RESERVE_TOKENS,
    Math.floor(window * SUMMARY_OUTPUT_RESERVE_SHARE),
  );
  return Math.max(0, window - promptTokens - reserve);
}

/**
 * Capricorn: drops the oldest messages until `contents` fits `budget`
 * tokens, so the summarizer request is never silently cut by Ollama.
 * Messages holding a previous `<state_snapshot>` are always kept (they carry
 * everything summarized before), the newest message is always kept, and a
 * tool result is never left without its call.
 *
 * Exported for testing purposes.
 */
export function fitToTokenBudget(
  contents: Content[],
  budget: number,
): Content[] {
  const sizes = contents.map((c) => estimateTokenCountSync(c.parts ?? []));
  let total = sizes.reduce((a, b) => a + b, 0);
  if (total <= budget) return contents;
  const isSnapshot = (c: Content) =>
    c.parts?.some((p) => p.text?.includes('<state_snapshot>')) ?? false;
  const isToolResult = (c: Content) =>
    c.parts?.some((p) => p.functionResponse) ?? false;
  const dropped = new Set<number>();
  let i = 0;
  for (; i < contents.length - 1 && total > budget; i++) {
    if (isSnapshot(contents[i])) continue;
    dropped.add(i);
    total -= sizes[i];
  }
  // A tool result whose call was dropped would be an orphan: drop it too.
  for (; i < contents.length - 1 && isToolResult(contents[i]); i++) {
    if (!dropped.has(i)) {
      dropped.add(i);
      total -= sizes[i];
    }
  }
  return contents.filter((_, k) => !dropped.has(k));
}

/**
 * Capricorn: the last `<state_snapshot>…</state_snapshot>` block of a
 * summarizer reply, without the scratchpad reasoning the prompt asks for
 * first. Replies without the tags are returned unchanged.
 *
 * Exported for testing purposes.
 */
export function extractStateSnapshot(text: string): string {
  const blocks = text.match(/<state_snapshot>[\s\S]*?<\/state_snapshot>/g);
  return blocks ? blocks[blocks.length - 1] : text;
}

/**
 * Capricorn: prompt size at which compression starts.
 *
 * Upstream: `threshold × window`. On a local window that ignores the fixed
 * part of every request (system prompt and tool declarations, ≈3K tokens),
 * which compression cannot shrink: at 8K the 50% trigger sits barely above
 * that fixed part, so a freshly compressed history was over it again and
 * every turn paid for another summarizer call. Locally the threshold applies
 * to the room history actually has: fixed part + threshold × (window −
 * fixed part). Outside a local session the upstream rule is unchanged.
 *
 * Exported for testing purposes.
 */
export function compressionTriggerTokens(
  threshold: number,
  limit: number,
  promptTokens: number,
  history: Content[],
): number {
  if (getActiveContextWindow() === undefined) return threshold * limit;
  const historyTokens = estimateTokenCountSync(
    history.flatMap((c) => c.parts ?? []),
  );
  const fixed = Math.min(limit, Math.max(0, promptTokens - historyTokens));
  // The history estimate (≈4 characters per token) undercounts code full of
  // numbers, which overstates the fixed part and pushed the trigger to the
  // brink of overflow (seen in the eval at 8K: no compression at 80% full).
  // Never wait past MAX_LOCAL_TRIGGER_SHARE of the window.
  return Math.min(
    fixed + threshold * (limit - fixed),
    MAX_LOCAL_TRIGGER_SHARE * limit,
  );
}

/**
 * Capricorn: introduces the summary that replaces compressed turns, so a
 * local model treats it as background instead of a message to answer.
 */
export const LOCAL_SUMMARY_PREAMBLE =
  '[Earlier turns of this conversation were compressed into the summary below to fit the context window. It is background, not a request: continue the current task from where it stopped, and do not repeat or reformat this summary.]';

/** Capricorn: latest point (share of the window) to start compressing. */
const MAX_LOCAL_TRIGGER_SHARE = 0.7;

/**
 * Capricorn: output cap for a local summary, as a share of the window and
 * clamped to [LOCAL_SUMMARY_MIN_TOKENS, LOCAL_SUMMARY_MAX_TOKENS]. A short
 * snapshot is cheaper to write (generation dominates the cost locally) and
 * leaves more room after compression, so compression runs less often.
 *
 * Exported for testing purposes.
 */
export function localSummaryMaxTokens(): number {
  const window = getActiveContextWindow() ?? 0;
  return Math.min(
    LOCAL_SUMMARY_MAX_TOKENS,
    Math.max(
      LOCAL_SUMMARY_MIN_TOKENS,
      Math.round(window * LOCAL_SUMMARY_WINDOW_SHARE),
    ),
  );
}
const LOCAL_SUMMARY_WINDOW_SHARE = 0.08;
const LOCAL_SUMMARY_MIN_TOKENS = 512;
const LOCAL_SUMMARY_MAX_TOKENS = 2048;
/** Words per token for the prompt's word budget (a token is ≈0.75 words;
 * kept lower so the model stays under the hard token cap). */
const WORDS_PER_TOKEN = 0.6;

/**
 * Capricorn: the compression system prompt. Locally a direct, length-bounded
 * prompt (see getLocalCompressionPrompt); otherwise upstream's.
 */
function compressionPrompt(config: Config): string {
  if (getActiveContextWindow() === undefined) {
    return getCompressionPrompt(config);
  }
  return getLocalCompressionPrompt(
    config.getApprovedPlanPath?.(),
    Math.round(localSummaryMaxTokens() * WORDS_PER_TOKEN),
  );
}
