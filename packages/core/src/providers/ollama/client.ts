/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Minimal HTTP client for Ollama's native REST API.
 *
 * This is the only module in Capricorn that performs inference I/O. It is a
 * thin, dependency-injected wrapper around `fetch` so it can be exercised
 * against a mock HTTP server in tests and so the egress policy (loopback only
 * by default) is enforced in exactly one place: the endpoint is validated in
 * the constructor and every request is built relative to it.
 *
 * Responsibilities:
 *  - endpoint validation (delegated to {@link resolveOllamaEndpoint});
 *  - request timeouts, user cancellation and stream idle detection;
 *  - NDJSON stream decoding and schema validation of every frame;
 *  - mapping all failures to {@link OllamaError}.
 *
 * Non-responsibilities: Gemini <-> Ollama protocol translation (see
 * `converter.ts`) and model policy (see `modelPolicy.ts`).
 */

import { z } from 'zod';
import {
  OllamaError,
  OllamaErrorKind,
  classifyOllamaMessage,
  normalizeTransportError,
} from './errors.js';
import { parseNdjsonStream } from './ndjson.js';
import { resolveOllamaEndpoint } from './endpoint.js';
import {
  ollamaChatResponseSchema,
  ollamaPsResponseSchema,
  ollamaPullProgressSchema,
  ollamaShowResponseSchema,
  ollamaTagsResponseSchema,
  ollamaVersionResponseSchema,
  type OllamaChatRequest,
  type OllamaChatResponse,
  type OllamaPsResponse,
  type OllamaPullProgress,
  type OllamaShowResponse,
  type OllamaTagModel,
} from './wireTypes.js';

/** Signature of the `fetch` implementation the client uses. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Construction options for {@link OllamaClient}. */
export interface OllamaClientOptions {
  /** Endpoint text (`OLLAMA_HOST` style). Defaults to `http://127.0.0.1:11434`. */
  endpoint?: string;
  /** Explicit opt-in to a non-loopback daemon. Defaults to false. */
  allowRemoteHost?: boolean;
  /** Timeout for short metadata calls (/api/tags, /api/show, ...). */
  metadataTimeoutMs?: number;
  /**
   * Time allowed until the *first byte* of a chat response. Generous by
   * default because the first request may have to load a multi-GB model.
   */
  chatTimeoutMs?: number;
  /**
   * Maximum silence between two stream frames once streaming has begun. A
   * stalled runner otherwise hangs the agent forever.
   */
  streamIdleTimeoutMs?: number;
  /** Injected fetch for tests; defaults to the global `fetch`. */
  fetch?: FetchLike;
}

/** Defaults chosen for consumer hardware loading 4–20 GB models. */
export const OLLAMA_CLIENT_DEFAULTS = {
  metadataTimeoutMs: 10_000,
  chatTimeoutMs: 300_000,
  streamIdleTimeoutMs: 120_000,
} as const;

/**
 * Client for one Ollama daemon. Instances are cheap and stateless apart from
 * configuration; share one per session.
 */
export class OllamaClient {
  /** Normalized origin, e.g. `http://127.0.0.1:11434`. */
  readonly baseUrl: string;
  /** False only when the user explicitly opted into a remote host. */
  readonly isLoopback: boolean;

  private readonly fetchImpl: FetchLike;
  private readonly metadataTimeoutMs: number;
  private readonly chatTimeoutMs: number;
  private readonly streamIdleTimeoutMs: number;

  /**
   * @throws {OllamaError} `ENDPOINT_NOT_ALLOWED` if the endpoint violates the
   *   local-only policy. Validation happens eagerly so a misconfiguration is
   *   reported at startup, not at the first prompt.
   */
  constructor(options: OllamaClientOptions = {}) {
    const resolved = resolveOllamaEndpoint(
      options.endpoint,
      options.allowRemoteHost ?? false,
    );
    this.baseUrl = resolved.baseUrl;
    this.isLoopback = resolved.isLoopback;
    this.fetchImpl =
      options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.metadataTimeoutMs =
      options.metadataTimeoutMs ?? OLLAMA_CLIENT_DEFAULTS.metadataTimeoutMs;
    this.chatTimeoutMs =
      options.chatTimeoutMs ?? OLLAMA_CLIENT_DEFAULTS.chatTimeoutMs;
    this.streamIdleTimeoutMs =
      options.streamIdleTimeoutMs ?? OLLAMA_CLIENT_DEFAULTS.streamIdleTimeoutMs;
  }

  /** `GET /api/version` — returns the daemon version string, e.g. "0.30.11". */
  async version(signal?: AbortSignal): Promise<string> {
    const body = await this.requestJson(
      'GET',
      '/api/version',
      undefined,
      ollamaVersionResponseSchema,
      signal,
    );
    return body.version;
  }

  /** `GET /api/tags` — every locally installed model, unfiltered. */
  async listModels(signal?: AbortSignal): Promise<OllamaTagModel[]> {
    const body = await this.requestJson(
      'GET',
      '/api/tags',
      undefined,
      ollamaTagsResponseSchema,
      signal,
    );
    return body.models;
  }

  /**
   * `POST /api/show` — model metadata including architecture and
   * capabilities. Used for Gemma 4 verification.
   *
   * @throws {OllamaError} `MODEL_NOT_FOUND` when the tag is not installed.
   */
  async showModel(
    model: string,
    signal?: AbortSignal,
    options: { verbose?: boolean } = {},
  ): Promise<OllamaShowResponse> {
    return this.requestJson(
      'POST',
      '/api/show',
      // `verbose` adds the per-layer metadata arrays context sizing needs
      // (and the tokenizer vocabulary: ~12 MB for Gemma 4), so it is only
      // requested by onboarding and diagnostics, never on session start.
      options.verbose ? { model, verbose: true } : { model },
      ollamaShowResponseSchema,
      signal,
    );
  }

  /** `GET /api/ps` — currently loaded models and their memory footprint. */
  async listRunning(signal?: AbortSignal): Promise<OllamaPsResponse> {
    return this.requestJson(
      'GET',
      '/api/ps',
      undefined,
      ollamaPsResponseSchema,
      signal,
    );
  }

  /**
   * Non-streamed `POST /api/chat`. The request's `stream` flag is forced to
   * false so the daemon returns a single JSON object.
   */
  async chat(
    request: OllamaChatRequest,
    signal?: AbortSignal,
  ): Promise<OllamaChatResponse> {
    const response = await this.requestJson(
      'POST',
      '/api/chat',
      { ...request, stream: false },
      ollamaChatResponseSchema,
      signal,
      this.chatTimeoutMs,
    );
    if (response.error) {
      throw new OllamaError(
        classifyOllamaMessage(response.error),
        `Ollama error: ${response.error}`,
      );
    }
    return response;
  }

  /**
   * Streamed `POST /api/chat`.
   *
   * Yields every validated frame in order. Guarantees for consumers:
   *  - the final yielded frame has `done: true`; if the connection closes
   *    before that, the generator throws `STREAM_TRUNCATED` instead of
   *    returning normally, so a cut-off answer is never mistaken for a
   *    complete one;
   *  - an in-band `{"error": ...}` frame becomes a thrown {@link OllamaError};
   *  - the generator stops (and the HTTP request is aborted) if the consumer
   *    stops iterating early, if `signal` aborts, or if no frame arrives for
   *    `streamIdleTimeoutMs`.
   */
  async *chatStream(
    request: OllamaChatRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<OllamaChatResponse, void, undefined> {
    // `internal` aborts the fetch for timeouts and early consumer exit while
    // keeping the caller's signal untouched.
    const internal = new AbortController();
    const combined = signal
      ? AbortSignal.any([signal, internal.signal])
      : internal.signal;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = true;
        internal.abort();
      }, ms);
    };

    const context = { endpoint: this.baseUrl, operation: 'Chat request' };
    try {
      arm(this.chatTimeoutMs);
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...request, stream: true }),
          signal: combined,
        });
      } catch (e) {
        throw this.wrapAbort(e, context, signal, timedOut);
      }
      await this.throwIfHttpError(response, request.model);
      if (!response.body) {
        throw new OllamaError(
          OllamaErrorKind.INVALID_RESPONSE,
          'Ollama returned an empty response body for a streamed chat.',
        );
      }

      let sawDone = false;
      arm(this.streamIdleTimeoutMs);
      try {
        for await (const raw of parseNdjsonStream(response.body)) {
          // Each frame resets the idle watchdog.
          arm(this.streamIdleTimeoutMs);
          const frame = parseOrThrow(
            ollamaChatResponseSchema,
            raw,
            'chat frame',
          );
          if (frame.error) {
            throw new OllamaError(
              classifyOllamaMessage(frame.error),
              `Ollama error during generation: ${frame.error}`,
            );
          }
          yield frame;
          if (frame.done) {
            sawDone = true;
            // Ignore anything after the terminal frame; there should be none.
            break;
          }
        }
      } catch (e) {
        throw this.wrapAbort(e, context, signal, timedOut);
      }
      if (!sawDone) {
        throw new OllamaError(
          OllamaErrorKind.STREAM_TRUNCATED,
          'Ollama closed the stream before the response was complete.',
        );
      }
    } finally {
      clearTimeout(timer);
      // Releases the socket if the consumer returned early (e.g. `break`).
      internal.abort();
    }
  }

  /**
   * Streamed `POST /api/pull` — downloads a model, yielding progress frames.
   * This is the only Capricorn operation that intentionally makes the daemon
   * contact the internet, and it only runs on an explicit user command.
   */
  async *pullModel(
    model: string,
    signal?: AbortSignal,
  ): AsyncGenerator<OllamaPullProgress, void, undefined> {
    const context = { endpoint: this.baseUrl, operation: 'Model pull' };
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/pull`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, stream: true }),
        signal,
      });
    } catch (e) {
      throw normalizeTransportError(e, context, signal);
    }
    await this.throwIfHttpError(response, model);
    if (!response.body) {
      throw new OllamaError(
        OllamaErrorKind.INVALID_RESPONSE,
        'Ollama returned an empty body for a model pull.',
      );
    }
    try {
      for await (const raw of parseNdjsonStream(response.body)) {
        const frame = parseOrThrow(ollamaPullProgressSchema, raw, 'pull frame');
        if (frame.error) {
          throw new OllamaError(
            classifyOllamaMessage(frame.error),
            `Model pull failed: ${frame.error}`,
          );
        }
        yield frame;
      }
    } catch (e) {
      throw normalizeTransportError(e, context, signal);
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Performs a JSON request with a timeout, validates the response against
   * `schema` and normalizes every failure.
   */
  private async requestJson<T>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    schema: ResponseSchema<T>,
    signal: AbortSignal | undefined,
    timeoutMs = this.metadataTimeoutMs,
  ): Promise<T> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const context = { endpoint: this.baseUrl, operation: `${method} ${path}` };
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers:
          body === undefined
            ? undefined
            : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: combined,
      });
    } catch (e) {
      throw normalizeTransportError(e, context, signal);
    }
    const model =
      typeof body === 'object' && body !== null && 'model' in body
        ? String((body as { model: unknown }).model)
        : undefined;
    await this.throwIfHttpError(response, model);
    let json: unknown;
    try {
      json = await response.json();
    } catch (e) {
      if (signal?.aborted || timeout.aborted) {
        throw normalizeTransportError(e, context, signal);
      }
      throw new OllamaError(
        OllamaErrorKind.INVALID_RESPONSE,
        `${context.operation} returned a non-JSON body.`,
        { cause: e },
      );
    }
    return parseOrThrow(schema, json, context.operation);
  }

  /**
   * Converts a non-2xx response into an {@link OllamaError}. Ollama error
   * bodies are `{"error": "..."}`; anything else is reported by status only.
   */
  private async throwIfHttpError(
    response: Response,
    model: string | undefined,
  ): Promise<void> {
    if (response.ok) {
      return;
    }
    let detail = '';
    try {
      const text = await response.text();
      try {
        const parsed = errorBodySchema.safeParse(JSON.parse(text));
        if (parsed.success) {
          detail = parsed.data.error;
        }
      } catch {
        // Bound the echoed body: a misbehaving proxy could return megabytes.
        detail = text.slice(0, 200);
      }
    } catch {
      // Body unreadable; fall through with status only.
    }
    const kind = classifyOllamaMessage(detail, response.status);
    const subject =
      kind === OllamaErrorKind.MODEL_NOT_FOUND && model
        ? `Model "${model}" is not installed in Ollama`
        : `Ollama returned HTTP ${response.status}`;
    throw new OllamaError(
      kind,
      detail ? `${subject}: ${detail}` : `${subject}.`,
      {
        status: response.status,
      },
    );
  }

  /** Distinguishes our idle/first-byte timeout from user cancellation. */
  private wrapAbort(
    e: unknown,
    context: { endpoint: string; operation: string },
    signal: AbortSignal | undefined,
    timedOut: boolean,
  ): OllamaError {
    if (e instanceof OllamaError) {
      return e;
    }
    if (timedOut && !signal?.aborted) {
      return new OllamaError(
        OllamaErrorKind.TIMEOUT,
        `${context.operation} timed out: no data from Ollama at ${context.endpoint}.`,
        { cause: e },
      );
    }
    return normalizeTransportError(e, context, signal);
  }
}

/**
 * A zod schema producing `T` from arbitrary input. The input type is
 * `unknown` on purpose: responses are untrusted until validated.
 */
type ResponseSchema<T> = z.ZodType<T, unknown>;

/** Shape of Ollama's HTTP error bodies: `{"error": "..."}`. */
const errorBodySchema = z.object({ error: z.string() });

/** Validates `value` with `schema`, mapping failure to `INVALID_RESPONSE`. */
function parseOrThrow<T>(
  schema: ResponseSchema<T>,
  value: unknown,
  what: string,
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new OllamaError(
      OllamaErrorKind.INVALID_RESPONSE,
      `Unexpected ${what} shape from Ollama: ${result.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
        .join('; ')}`,
    );
  }
  return result.data;
}
