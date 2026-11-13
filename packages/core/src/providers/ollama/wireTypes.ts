/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Wire-level types and runtime schemas for Ollama's native API.
 *
 * Request types are plain TypeScript (we construct them). Response types are
 * zod schemas because responses cross a process boundary: the daemon could be
 * an unexpected version, a misconfigured proxy, or — with an opted-in remote
 * host — an untrusted server. Every response is parsed through these schemas
 * before any field is read.
 *
 * Schemas use `.passthrough()` so newer Ollama releases that add fields keep
 * working; only the fields Capricorn depends on are validated.
 *
 * Reference: https://docs.ollama.com/api/chat, /api/tags, /api/show
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** A tool definition in Ollama's (OpenAI-like) function format. */
export interface OllamaToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    /** A JSON Schema object describing the arguments. */
    parameters: Record<string, unknown>;
  };
}

/** A tool call as sent back to Ollama in assistant history. */
export interface OllamaRequestToolCall {
  id?: string;
  function: {
    name: string;
    /** Ollama expects an *object*, not a JSON string as OpenAI does. */
    arguments: Record<string, unknown>;
  };
}

/** One message in an `/api/chat` request. */
export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Model reasoning from a previous turn (assistant only). */
  thinking?: string;
  /** Base64 images (no data: prefix). */
  images?: string[];
  tool_calls?: OllamaRequestToolCall[];
  /** For role `tool`: name of the tool whose result this is. */
  tool_name?: string;
  /** For role `tool`: correlates with `OllamaRequestToolCall.id`. */
  tool_call_id?: string;
}

/** Subset of Ollama runtime options Capricorn sets. */
export interface OllamaChatOptions {
  num_ctx?: number;
  num_predict?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  seed?: number;
  stop?: string[];
  presence_penalty?: number;
  frequency_penalty?: number;
}

/** Body of `POST /api/chat`. */
export interface OllamaChatRequest {
  model: string;
  messages: OllamaChatMessage[];
  tools?: OllamaToolDefinition[];
  stream: boolean;
  /** Enables/disables the model's thinking channel when supported. */
  think?: boolean;
  /** `"json"` or a JSON Schema for structured output. */
  format?: 'json' | Record<string, unknown>;
  options?: OllamaChatOptions;
  /** How long the model stays loaded after the request, e.g. "5m". */
  keep_alive?: string | number;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/**
 * A tool call emitted by the model. `arguments` is `unknown` on purpose:
 * Ollama normally returns an object, but model output is untrusted and some
 * builds have returned JSON strings. Normalization happens in the converter.
 */
export const ollamaResponseToolCallSchema = z
  .object({
    id: z.string().optional(),
    function: z
      .object({
        index: z.number().optional(),
        name: z.string(),
        arguments: z.unknown().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type OllamaResponseToolCall = z.infer<
  typeof ollamaResponseToolCallSchema
>;

/** One frame of a streamed (or the single body of a non-streamed) chat reply. */
export const ollamaChatResponseSchema = z
  .object({
    model: z.string().optional(),
    created_at: z.string().optional(),
    message: z
      .object({
        role: z.string().optional(),
        content: z.string().optional().default(''),
        thinking: z.string().optional(),
        tool_calls: z.array(ollamaResponseToolCallSchema).optional(),
      })
      .passthrough()
      .optional(),
    done: z.boolean().optional().default(false),
    done_reason: z.string().optional(),
    total_duration: z.number().optional(),
    load_duration: z.number().optional(),
    prompt_eval_count: z.number().optional(),
    prompt_eval_duration: z.number().optional(),
    eval_count: z.number().optional(),
    eval_duration: z.number().optional(),
    /** In-band error frame (e.g. runner crash mid-stream). */
    error: z.string().optional(),
  })
  .passthrough();

export type OllamaChatResponse = z.infer<typeof ollamaChatResponseSchema>;

/** `details` block shared by /api/tags and /api/show. */
export const ollamaModelDetailsSchema = z
  .object({
    parent_model: z.string().optional(),
    format: z.string().optional(),
    family: z.string().optional(),
    families: z.array(z.string()).nullable().optional(),
    parameter_size: z.string().optional(),
    quantization_level: z.string().optional(),
  })
  .passthrough();

/** One entry of `GET /api/tags`. */
export const ollamaTagModelSchema = z
  .object({
    name: z.string(),
    model: z.string().optional(),
    modified_at: z.string().optional(),
    size: z.number().optional(),
    digest: z.string().optional(),
    details: ollamaModelDetailsSchema.optional(),
    /** Present for Ollama cloud-backed models; such models are never allowed. */
    remote_model: z.string().optional(),
    remote_host: z.string().optional(),
  })
  .passthrough();

export type OllamaTagModel = z.infer<typeof ollamaTagModelSchema>;

export const ollamaTagsResponseSchema = z
  .object({ models: z.array(ollamaTagModelSchema).default([]) })
  .passthrough();

/** `POST /api/show` response (fields Capricorn relies on). */
export const ollamaShowResponseSchema = z
  .object({
    details: ollamaModelDetailsSchema.optional(),
    model_info: z.record(z.unknown()).optional(),
    capabilities: z.array(z.string()).optional(),
    parameters: z.string().optional(),
    template: z.string().optional(),
    modified_at: z.string().optional(),
    remote_model: z.string().optional(),
    remote_host: z.string().optional(),
  })
  .passthrough();

export type OllamaShowResponse = z.infer<typeof ollamaShowResponseSchema>;

export const ollamaVersionResponseSchema = z
  .object({ version: z.string() })
  .passthrough();

/** One progress frame of `POST /api/pull`. */
export const ollamaPullProgressSchema = z
  .object({
    status: z.string().optional(),
    digest: z.string().optional(),
    total: z.number().optional(),
    completed: z.number().optional(),
    error: z.string().optional(),
  })
  .passthrough();

export type OllamaPullProgress = z.infer<typeof ollamaPullProgressSchema>;

/** One entry of `GET /api/ps` (currently loaded models). */
export const ollamaPsResponseSchema = z
  .object({
    models: z
      .array(
        z
          .object({
            name: z.string(),
            size: z.number().optional(),
            size_vram: z.number().optional(),
            context_length: z.number().optional(),
            expires_at: z.string().optional(),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();

export type OllamaPsResponse = z.infer<typeof ollamaPsResponseSchema>;
