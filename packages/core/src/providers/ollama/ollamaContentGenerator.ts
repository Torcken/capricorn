/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview `ContentGenerator` implementation backed by a local Ollama
 * daemon running a verified Gemma 4 model.
 *
 * This is the seam where Capricorn replaces Google-hosted inference. The
 * upstream agent engine (`GeminiClient` -> `GeminiChat` -> `Turn`) calls
 * `generateContent`/`generateContentStream` with `@google/genai` request
 * objects; we translate them (see `converter.ts`), call `/api/chat`, and
 * translate the reply back.
 *
 * Model resolution — the core safety property:
 *   Upstream code asks for models by *Gemini* names in many places (router
 *   classifiers, compression, loop detection, "flash-lite" utility calls).
 *   Capricorn has exactly one active model per session. Any request naming a
 *   Gemini model/alias is served by the active Gemma 4 model; any request
 *   naming an Ollama tag is served by *that* tag only after it passes
 *   {@link verifyGemma4Model}. There is no path by which a non-Gemma or
 *   cloud model receives a prompt, and no path to a hosted API.
 *
 * Retry policy:
 *   Inference is side-effect free, so a failed request is retried (bounded,
 *   with backoff) — but only when nothing has been yielded yet. Once a stream
 *   has produced output, retrying here would duplicate text in the transcript,
 *   so the error is surfaced and upstream's own stream-retry logic decides.
 *   Tool execution is never retried by this layer (it never executes tools).
 */

// Capricorn: type-only, so the SDK is not bundled (see genaiRuntime.ts).
import type {
  CountTokensParameters,
  CountTokensResponse,
  EmbedContentParameters,
  EmbedContentResponse,
  GenerateContentParameters,
  GenerateContentResponse,
  Part,
} from '@google/genai';
import type { ContentGenerator } from '../../core/contentGenerator.js';
import { LlmRole } from '../../telemetry/llmRole.js';
import { estimateTokenCountSync } from '../../utils/tokenCalculation.js';
import { debugLogger } from '../../utils/debugLogger.js';
import { coreEvents } from '../../utils/events.js';
import type { OllamaClient } from './client.js';
import {
  createToolCallIdAllocator,
  createContentChannelSplitter,
  createThinkingSanitizer,
  frameToResponse,
  normalizeContents,
  systemInstructionToText,
  toOllamaFormat,
  toOllamaMessages,
  toOllamaOptions,
  toOllamaTools,
} from './converter.js';
import { OllamaError, OllamaErrorKind } from './errors.js';
import {
  prefilterTagModel,
  verifyGemma4Model,
  type ModelVerdict,
} from './modelPolicy.js';
import type { OllamaChatRequest } from './wireTypes.js';

/** How the model's thinking channel is controlled. */
export type OllamaThinkMode = 'auto' | 'on' | 'off';

/** Runtime settings for the generator (from `ollama.*` settings). */
export interface OllamaGeneratorSettings {
  /**
   * Returns the session's active model tag. A function (not a value) so
   * in-session `/model` switches take effect on the next request.
   */
  getActiveModel: () => string;
  /** Context window to allocate (`num_ctx`). */
  numCtx: number;
  /**
   * `auto` follows the request's `thinkingConfig` on main-agent and subagent
   * turns and turns thinking off for utility calls; `on`/`off` force it. Ignored for models that do not
   * report the `thinking` capability.
   */
  think: OllamaThinkMode;
  /** Ollama `keep_alive`, e.g. "10m". Undefined uses the daemon default. */
  keepAlive?: string;
  /** Maximum attempts for a retryable failure before any output (>= 1). */
  maxAttempts?: number;
  /** Base backoff in ms; doubled per attempt. */
  retryBaseDelayMs?: number;
}

/** Prefixes upstream uses for internal model ids and aliases. */
const UPSTREAM_MODEL_ALIAS =
  /^(gemini-|auto|pro$|flash|flash-lite$|gemma-|models\/)/i;

/** Clamp for the learned estimate->actual token ratio. */
const CALIBRATION_MIN = 0.5;
const CALIBRATION_MAX = 3;

/**
 * Gemma 4 vision encoders produce a fixed token budget per image; 1120 is
 * the upper bound of the documented range, used so estimates err high.
 */
const IMAGE_TOKEN_ESTIMATE = 1120;

/**
 * The Ollama-backed {@link ContentGenerator}.
 */
export class OllamaContentGenerator implements ContentGenerator {
  /** Cache of verification results per tag for the session's lifetime. */
  private readonly verdicts = new Map<string, Promise<ModelVerdict>>();
  /** Ratio actual/estimated prompt tokens, learned from real usage. */
  private calibration = 1;
  /** Whether the context-overflow warning was already shown this session. */
  private overflowWarned = false;

  constructor(
    private readonly client: OllamaClient,
    private readonly settings: OllamaGeneratorSettings,
  ) {}

  /** The underlying transport (used by diagnostics and model commands). */
  get ollama(): OllamaClient {
    return this.client;
  }

  /** {@inheritDoc ContentGenerator.generateContent} */
  async generateContent(
    request: GenerateContentParameters,
    _userPromptId: string,
    role: LlmRole,
  ): Promise<GenerateContentResponse> {
    const { body, verdict, estimate } = await this.buildRequest(request, role);
    const signal = request.config?.abortSignal;
    const frame = await this.withRetry(signal, () =>
      this.client.chat(body, signal),
    );
    this.calibrate(estimate, frame.prompt_eval_count);
    // Capricorn: recover thinking that arrived as content (see converter).
    const whole = { ...frame, done: true };
    const response = frameToResponse(
      body.think === true ? createContentChannelSplitter()(whole) : whole,
      createToolCallIdAllocator(),
      new Set(),
      createThinkingSanitizer(),
    );
    response.modelVersion = verdict.model;
    return response;
  }

  /** {@inheritDoc ContentGenerator.generateContentStream} */
  async generateContentStream(
    request: GenerateContentParameters,
    _userPromptId: string,
    role: LlmRole,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    // Build (and verify the model) eagerly so configuration errors surface as
    // a rejected promise, matching upstream generators' behavior.
    const { body, verdict, estimate } = await this.buildRequest(request, role);
    const signal = request.config?.abortSignal;
    return this.streamResponses(body, verdict.model, estimate, signal);
  }

  /**
   * Streams converted chunks, retrying the *connection* only while nothing
   * has been yielded.
   */
  private async *streamResponses(
    body: OllamaChatRequest,
    model: string,
    estimate: number,
    signal: AbortSignal | undefined,
  ): AsyncGenerator<GenerateContentResponse> {
    const maxAttempts = Math.max(1, this.settings.maxAttempts ?? 3);
    for (let attempt = 1; ; attempt++) {
      // A fresh allocator/dedupe set per attempt: a retried attempt is a
      // completely new response.
      const ids = createToolCallIdAllocator();
      const seen = new Set<string>();
      // Gemma 4 channel markers can leak into thinking deltas; see converter.
      const sanitizeThinking = createThinkingSanitizer();
      // ...and whole thinking passages can arrive as content when Ollama
      // misses the opening marker; only possible when thinking is on.
      const splitChannels =
        body.think === true ? createContentChannelSplitter() : undefined;
      let yielded = false;
      try {
        for await (const frame of this.client.chatStream(body, signal)) {
          if (frame.done) {
            this.calibrate(estimate, frame.prompt_eval_count);
          }
          const chunk = frameToResponse(
            splitChannels ? splitChannels(frame) : frame,
            ids,
            seen,
            sanitizeThinking,
          );
          chunk.modelVersion = model;
          // Skip empty intermediate frames (keep-alives) so upstream does not
          // see zero-part chunks mid-stream; always emit the terminal frame,
          // which carries finishReason and usage.
          if (
            !frame.done &&
            (chunk.candidates?.[0]?.content?.parts ?? []).length === 0
          ) {
            continue;
          }
          yielded = true;
          yield chunk;
        }
        return;
      } catch (e) {
        if (
          yielded ||
          !(e instanceof OllamaError) ||
          !e.retryable ||
          attempt >= maxAttempts ||
          signal?.aborted
        ) {
          throw e;
        }
        debugLogger.debug(
          `[Ollama] attempt ${attempt} failed (${e.kind}); retrying before any output.`,
        );
        await this.backoff(attempt, signal);
      }
    }
  }

  /**
   * Token counting. Ollama has no tokenize endpoint, so this is an
   * *estimate*: upstream's character heuristic, plus a conservative per-image
   * cost, scaled by the ratio learned from real `prompt_eval_count` values.
   * Never calls a hosted tokenizer.
   */
  async countTokens(
    request: CountTokensParameters,
  ): Promise<CountTokensResponse> {
    const contents = normalizeContents(request.contents);
    const parts: Part[] = contents.flatMap((c) => c.parts ?? []);
    const system = systemInstructionToText(request.config?.systemInstruction);
    if (system) parts.push({ text: system });
    return {
      totalTokens: Math.ceil(this.estimateParts(parts) * this.calibration),
    };
  }

  /**
   * Embeddings are intentionally unavailable: Capricorn is Gemma-4-only and
   * Gemma 4 generation models are not embedding models. We refuse rather than
   * fabricate vectors; callers fall back to lexical (ripgrep) search.
   */
  async embedContent(
    _request: EmbedContentParameters,
  ): Promise<EmbedContentResponse> {
    throw new OllamaError(
      OllamaErrorKind.MODEL_NOT_ALLOWED,
      'Embeddings are not available in Capricorn (Gemma 4 generation models only). Lexical search is used instead.',
    );
  }

  // -------------------------------------------------------------------------
  // Request construction
  // -------------------------------------------------------------------------

  /**
   * Resolves and verifies the model, then converts the request.
   * @throws {OllamaError} If the resolved model is missing or not allowed.
   */
  private async buildRequest(
    request: GenerateContentParameters,
    role: LlmRole,
  ): Promise<{
    body: OllamaChatRequest;
    verdict: ModelVerdict;
    estimate: number;
  }> {
    const model = this.resolveModelName(request.model);
    const verdict = await this.verify(model, request.config?.abortSignal);
    const config = request.config;
    const messages = toOllamaMessages(
      request.contents,
      config?.systemInstruction,
    );
    const tools = toOllamaTools(config?.tools);
    const body: OllamaChatRequest = {
      model: verdict.model,
      messages,
      stream: true,
      options: toOllamaOptions(config, this.effectiveNumCtx(verdict)),
    };
    if (tools.length > 0) body.tools = tools;
    const format = toOllamaFormat(config);
    if (format) body.format = format;
    const think = this.resolveThink(config?.thinkingConfig, verdict, role);
    if (think !== undefined) body.think = think;
    if (this.settings.keepAlive) body.keep_alive = this.settings.keepAlive;

    const contents = normalizeContents(request.contents);
    const estimate = this.estimateParts([
      { text: systemInstructionToText(config?.systemInstruction) },
      { text: JSON.stringify(tools) },
      ...contents.flatMap((c) => c.parts ?? []),
    ]);
    this.warnIfOverflowing(estimate, this.effectiveNumCtx(verdict));
    return { body, verdict, estimate };
  }

  /**
   * Warns (once per session) when a request will not fit the allocated
   * window. Ollama does not fail such a request: it silently drops the
   * oldest part of the prompt, so the model loses instructions or earlier
   * work without anyone noticing. The upstream agent loop already compresses
   * and checks before main turns; this catches whatever still gets through.
   */
  private warnIfOverflowing(estimate: number, numCtx: number): void {
    const projected = Math.ceil(estimate * this.calibration);
    if (projected <= numCtx || this.overflowWarned) return;
    this.overflowWarned = true;
    coreEvents.emitFeedback(
      'warning',
      `A request of about ${projected.toLocaleString('en-US')} tokens (estimated) exceeds the ${numCtx.toLocaleString('en-US')}-token context window; Ollama drops the oldest part of such prompts. Raise \`ollama.numCtx\` if memory allows, or start a fresh session with /clear.`,
    );
  }

  /**
   * Maps the requested model name onto an Ollama tag (see file overview).
   */
  resolveModelName(requested: string | undefined): string {
    const name = (requested ?? '').trim();
    if (!name || UPSTREAM_MODEL_ALIAS.test(name)) {
      return this.settings.getActiveModel();
    }
    return name;
  }

  /**
   * Verifies a tag once per session (cached). Failed verifications are not
   * cached, so installing a missing model mid-session works without restart.
   */
  private async verify(
    model: string,
    signal?: AbortSignal,
  ): Promise<ModelVerdict> {
    let pending = this.verdicts.get(model);
    if (!pending) {
      pending = this.fetchVerdict(model, signal);
      this.verdicts.set(model, pending);
      pending.catch(() => this.verdicts.delete(model));
    }
    const verdict = await pending;
    if (!verdict.allowed) {
      this.verdicts.delete(model);
      throw new OllamaError(
        OllamaErrorKind.MODEL_NOT_ALLOWED,
        `Model "${model}" cannot be used: ${verdict.detail}`,
      );
    }
    return verdict;
  }

  private async fetchVerdict(
    model: string,
    signal?: AbortSignal,
  ): Promise<ModelVerdict> {
    // Cheap rejection for cloud tags without touching the daemon.
    const pre = prefilterTagModel({ name: model });
    if (pre) return pre;
    const show = await this.client.showModel(model, signal);
    return verifyGemma4Model(model, show);
  }

  /** Never ask for more context than the weights support. */
  private effectiveNumCtx(verdict: ModelVerdict): number {
    const max = verdict.maxContextLength;
    return max ? Math.min(this.settings.numCtx, max) : this.settings.numCtx;
  }

  /**
   * Decides the `think` flag. Returns undefined to omit it, which matters:
   * sending `think` to a model without the capability is an Ollama error.
   */
  private resolveThink(
    thinkingConfig:
      | { includeThoughts?: boolean; thinkingBudget?: number }
      | undefined,
    verdict: ModelVerdict,
    role: LlmRole,
  ): boolean | undefined {
    if (verdict.capabilities && !verdict.capabilities.includes('thinking')) {
      return undefined;
    }
    switch (this.settings.think) {
      case 'on':
        return true;
      case 'off':
        return false;
      default:
        // Utility calls (compression, loop detection, next-speaker and edit
        // checks...) never think in `auto`. Upstream configs are keyed by
        // Gemini model names and several of them ask for thoughts, which
        // Gemini writes quickly; on local hardware a utility call then spent
        // most of its time, and its output cap, reasoning (seen at an 8K
        // window: compression summaries cut off mid-snapshot).
        if (role !== LlmRole.MAIN && role !== LlmRole.SUBAGENT) return false;
        if (!thinkingConfig) return false;
        if (thinkingConfig.thinkingBudget === 0) return false;
        return thinkingConfig.includeThoughts === true;
    }
  }

  private estimateParts(parts: Part[]): number {
    let images = 0;
    const textual: Part[] = [];
    for (const p of parts) {
      if (p.inlineData?.mimeType?.startsWith('image/')) images++;
      else textual.push(p);
    }
    return estimateTokenCountSync(textual) + images * IMAGE_TOKEN_ESTIMATE;
  }

  /** Updates the estimate->actual ratio from a real prompt token count. */
  private calibrate(estimate: number, actual: number | undefined): void {
    if (!actual || estimate <= 0) return;
    const ratio = actual / estimate;
    // Exponential smoothing so one odd request does not swing budgets.
    const next = 0.7 * this.calibration + 0.3 * ratio;
    this.calibration = Math.min(
      CALIBRATION_MAX,
      Math.max(CALIBRATION_MIN, next),
    );
  }

  private async withRetry<T>(
    signal: AbortSignal | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    const maxAttempts = Math.max(1, this.settings.maxAttempts ?? 3);
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn();
      } catch (e) {
        if (
          !(e instanceof OllamaError) ||
          !e.retryable ||
          attempt >= maxAttempts ||
          signal?.aborted
        ) {
          throw e;
        }
        await this.backoff(attempt, signal);
      }
    }
  }

  private backoff(
    attempt: number,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const delay = (this.settings.retryBaseDelayMs ?? 500) * 2 ** (attempt - 1);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, delay);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(
            new OllamaError(OllamaErrorKind.CANCELLED, 'Request cancelled.'),
          );
        },
        { once: true },
      );
    });
  }
}
