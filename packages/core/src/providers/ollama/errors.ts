/**
 * @license
 * Copyright 2026 Capricorn Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Normalized error taxonomy for the Ollama transport.
 *
 * Capricorn talks to exactly one inference backend (a local Ollama daemon), so
 * every failure the user can encounter while generating content ultimately
 * originates here. Raw `fetch` failures (`ECONNREFUSED`, `AbortError`, HTTP
 * 404 bodies, NDJSON `{"error": ...}` frames) are all translated into a single
 * {@link OllamaError} class carrying a machine-readable {@link OllamaErrorKind}.
 *
 * Why a closed enum instead of free-form messages:
 * - `capricorn doctor` and the interactive startup screen must *distinguish*
 *   "daemon not running" from "model missing" from "out of memory" to offer
 *   actionable advice (spec §4.1).
 * - The retry layer must decide retryability from the kind alone; message
 *   text from Ollama is not a stable API.
 */

/**
 * Stable categories of Ollama failure. Values are serialized into
 * `doctor --json` output, so treat them as a public contract.
 */
export enum OllamaErrorKind {
  /** TCP connection refused: the daemon is not running on the endpoint. */
  CONNECTION_REFUSED = 'connection_refused',
  /** The request exceeded its time budget before a response arrived. */
  TIMEOUT = 'timeout',
  /** The caller aborted the request (Ctrl+C, session shutdown). */
  CANCELLED = 'cancelled',
  /** The daemon answered with something that is not the documented shape. */
  INVALID_RESPONSE = 'invalid_response',
  /** The requested model tag is not installed locally. */
  MODEL_NOT_FOUND = 'model_not_found',
  /** The model exists but is not a verified local Gemma 4 model. */
  MODEL_NOT_ALLOWED = 'model_not_allowed',
  /** The model failed to load (corrupt blob, unsupported arch, runner crash). */
  MODEL_LOAD_FAILED = 'model_load_failed',
  /** Ollama reported insufficient RAM/VRAM to load or run the model. */
  RESOURCE_EXHAUSTED = 'resource_exhausted',
  /** The daemon is older than the minimum version Capricorn supports. */
  VERSION_UNSUPPORTED = 'version_unsupported',
  /** The configured endpoint violates the local-only network policy. */
  ENDPOINT_NOT_ALLOWED = 'endpoint_not_allowed',
  /** The stream ended without a terminal `done: true` frame. */
  STREAM_TRUNCATED = 'stream_truncated',
  /** Any other HTTP-level failure reported by Ollama. */
  HTTP_ERROR = 'http_error',
}

/**
 * Kinds that may succeed on an identical retry. Model generation is
 * side-effect free from the daemon's perspective, so retrying *inference* is
 * safe; this says nothing about retrying *tool execution*, which is never
 * automatic (spec §4.2).
 */
const RETRYABLE_KINDS: ReadonlySet<OllamaErrorKind> = new Set([
  OllamaErrorKind.TIMEOUT,
  OllamaErrorKind.STREAM_TRUNCATED,
  OllamaErrorKind.INVALID_RESPONSE,
]);

/** Short human remediation hints shown alongside the error message. */
const REMEDIATION: Record<OllamaErrorKind, string> = {
  [OllamaErrorKind.CONNECTION_REFUSED]:
    'Start Ollama (e.g. `ollama serve`, or launch the Ollama app) and retry. Run `capricorn doctor` for details.',
  [OllamaErrorKind.TIMEOUT]:
    'The model may still be loading or the machine is overloaded. Retry, or choose a smaller Gemma 4 model.',
  [OllamaErrorKind.CANCELLED]: 'The request was cancelled.',
  [OllamaErrorKind.INVALID_RESPONSE]:
    'Ollama returned an unexpected response. Check `ollama --version` and update Ollama if it is old.',
  [OllamaErrorKind.MODEL_NOT_FOUND]:
    'Install the model with `capricorn models pull <model>` or pick an installed one with `capricorn models list`.',
  [OllamaErrorKind.MODEL_NOT_ALLOWED]:
    'Capricorn only runs verified local Gemma 4 models. See `capricorn models list`.',
  [OllamaErrorKind.MODEL_LOAD_FAILED]:
    'Ollama could not load the model. Re-pull it, check the Ollama server log, or try another Gemma 4 variant.',
  [OllamaErrorKind.RESOURCE_EXHAUSTED]:
    'Not enough memory. Choose a smaller Gemma 4 model (e.g. gemma4:e4b) or reduce `ollama.numCtx`.',
  [OllamaErrorKind.VERSION_UNSUPPORTED]:
    'Update Ollama to a release that supports Gemma 4 and tool calling.',
  [OllamaErrorKind.ENDPOINT_NOT_ALLOWED]:
    'Capricorn only connects to a loopback Ollama endpoint unless `ollama.allowRemoteHost` is explicitly enabled.',
  [OllamaErrorKind.STREAM_TRUNCATED]:
    'The response stream ended early. This is usually transient; retry the request.',
  [OllamaErrorKind.HTTP_ERROR]:
    'Ollama reported an error. Check the Ollama server log for details.',
};

/**
 * The single error type raised by the Ollama transport and content generator.
 *
 * `message` is safe to display to the user: it never contains request bodies,
 * prompt text or file contents (which could be large or sensitive), only the
 * daemon's short error string and the endpoint/model involved.
 */
export class OllamaError extends Error {
  /** Machine-readable category; see {@link OllamaErrorKind}. */
  readonly kind: OllamaErrorKind;
  /** HTTP status when the failure came from an HTTP response. */
  readonly status?: number;
  /** One-line remediation advice suitable for CLI output. */
  readonly remediation: string;

  constructor(
    kind: OllamaErrorKind,
    message: string,
    options: { status?: number; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'OllamaError';
    this.kind = kind;
    this.status = options.status;
    this.remediation = REMEDIATION[kind];
  }

  /** Whether an identical inference request may reasonably succeed later. */
  get retryable(): boolean {
    return RETRYABLE_KINDS.has(this.kind);
  }
}

/** Type guard usable across module boundaries (e.g. from the CLI package). */
export function isOllamaError(e: unknown): e is OllamaError {
  return e instanceof OllamaError;
}

/**
 * Classifies an error message emitted by Ollama itself (either an HTTP error
 * body `{"error": "..."}` or an in-stream error frame).
 *
 * Ollama does not publish error codes, so this is a best-effort match against
 * message substrings observed across Ollama releases. Unknown messages fall
 * back to {@link OllamaErrorKind.HTTP_ERROR}, which is non-retryable: failing
 * loudly is preferable to retrying an unknown condition in a loop.
 */
export function classifyOllamaMessage(
  message: string,
  status?: number,
): OllamaErrorKind {
  const m = message.toLowerCase();
  if (
    status === 404 ||
    (m.includes('model') && m.includes('not found')) ||
    m.includes('try pulling it first')
  ) {
    return OllamaErrorKind.MODEL_NOT_FOUND;
  }
  if (
    m.includes('out of memory') ||
    m.includes('requires more system memory') ||
    m.includes('insufficient memory') ||
    m.includes('cudamalloc failed') ||
    m.includes('failed to allocate')
  ) {
    return OllamaErrorKind.RESOURCE_EXHAUSTED;
  }
  if (
    m.includes('failed to load') ||
    m.includes('llama runner process has terminated') ||
    m.includes('unable to load model') ||
    m.includes('unknown model architecture')
  ) {
    return OllamaErrorKind.MODEL_LOAD_FAILED;
  }
  if (m.includes('does not support tools')) {
    // A model without tool capability cannot drive the agent loop; treat it as
    // a disallowed model rather than a transient HTTP problem.
    return OllamaErrorKind.MODEL_NOT_ALLOWED;
  }
  return OllamaErrorKind.HTTP_ERROR;
}

/**
 * Converts any thrown value from `fetch`/stream reading into an
 * {@link OllamaError}. Already-normalized errors pass through unchanged so the
 * function is idempotent and can be applied at every layer boundary.
 *
 * @param e The raw thrown value.
 * @param context Endpoint (and optionally model) for the user-facing message.
 * @param signal The caller's abort signal, used to tell a user cancellation
 *   apart from an internal timeout (both surface as `AbortError` from fetch).
 */
export function normalizeTransportError(
  e: unknown,
  context: { endpoint: string; operation: string },
  signal?: AbortSignal,
): OllamaError {
  if (e instanceof OllamaError) {
    return e;
  }
  // The caller's signal fired: this is a deliberate cancellation, never retry.
  if (signal?.aborted) {
    return new OllamaError(
      OllamaErrorKind.CANCELLED,
      `${context.operation} cancelled.`,
      { cause: e },
    );
  }
  const err = e instanceof Error ? e : new Error(String(e));
  // AbortSignal.timeout() rejects with a DOMException named TimeoutError.
  if (err.name === 'TimeoutError' || err.name === 'AbortError') {
    return new OllamaError(
      OllamaErrorKind.TIMEOUT,
      `${context.operation} timed out waiting for Ollama at ${context.endpoint}.`,
      { cause: e },
    );
  }
  // Node's undici wraps socket errors: TypeError("fetch failed") with a
  // `cause` carrying the errno code.
  const code = findErrorCode(err);
  // The daemon accepted the connection and then dropped it (runner crash,
  // daemon restart, proxy reset). Classified as a truncated stream because
  // it is transient and an inference retry is safe.
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET' || code === 'EPIPE') {
    return new OllamaError(
      OllamaErrorKind.STREAM_TRUNCATED,
      `Ollama at ${context.endpoint} closed the connection unexpectedly.`,
      { cause: e },
    );
  }
  if (code === 'ECONNREFUSED' || code === 'EHOSTUNREACH' || code === 'ENOTFOUND') {
    return new OllamaError(
      OllamaErrorKind.CONNECTION_REFUSED,
      `Cannot connect to Ollama at ${context.endpoint} (${code}).`,
      { cause: e },
    );
  }
  if (code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT' || code === 'ETIMEDOUT') {
    return new OllamaError(
      OllamaErrorKind.TIMEOUT,
      `${context.operation} timed out waiting for Ollama at ${context.endpoint}.`,
      { cause: e },
    );
  }
  return new OllamaError(
    OllamaErrorKind.HTTP_ERROR,
    `${context.operation} failed: ${err.message}`,
    { cause: e },
  );
}

/** Walks the `cause` chain looking for a Node errno-style `code`. */
function findErrorCode(err: unknown, depth = 0): string | undefined {
  if (depth > 5 || typeof err !== 'object' || err === null) {
    return undefined;
  }
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string') {
    return code;
  }
  // AggregateError (happy-eyeballs IPv4+IPv6 attempts) keeps causes in `errors`.
  const errors = (err as { errors?: unknown }).errors;
  if (Array.isArray(errors)) {
    for (const inner of errors) {
      const c = findErrorCode(inner, depth + 1);
      if (c) return c;
    }
  }
  return findErrorCode((err as { cause?: unknown }).cause, depth + 1);
}
